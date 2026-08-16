import "server-only";

import { getTursoClient } from "@/lib/turso";
import { reconcileInventoryAlerts } from "@/lib/repository";

type PendingOrder = {
  id: string;
  source: "shopify" | "tiktok";
  orderNumber: string;
  fulfillment: string;
};

export async function reconcileInventoryOperations() {
  const db = await getTursoClient();
  const baseline = await db.execute({ sql: "SELECT value FROM inventory_settings WHERE key = 'inventory-order-baseline' LIMIT 1", args: [] });
  if (!baseline.rows[0]) {
    const now = new Date().toISOString();
    const existingOrders = await db.execute("SELECT id FROM orders");
    await db.execute({
      sql: `INSERT OR IGNORE INTO inventory_order_applications (order_id, stock_recorded_at, packaging_applied_at, state, notes, created_at, updated_at)
            SELECT id, ?, ?, 'baseline', 'Observed before the operational ledger was enabled', ?, ? FROM orders`,
      args: [now, now, now, now],
    });
    await db.execute({ sql: "INSERT INTO inventory_settings (key, value, updated_at) VALUES ('inventory-order-baseline', ?, ?)", args: [now, now] });
    const alerts = await reconcileInventoryAlerts();
    return { baselineOrders: existingOrders.rows.length, stockMovements: 0, packagingMovements: 0, alerts };
  }

  const pending = await db.execute(`
    SELECT o.id, o.source, o.order_number, o.fulfillment_status
    FROM orders o
    LEFT JOIN inventory_order_applications a ON a.order_id = o.id
    WHERE a.order_id IS NULL OR (a.state <> 'baseline' AND (a.stock_recorded_at IS NULL OR (o.fulfillment_status = 'fulfilled' AND a.packaging_applied_at IS NULL)))
    ORDER BY o.source_created_at ASC
  `);
  let stockMovements = 0;
  let packagingMovements = 0;
  for (const row of pending.rows) {
    const order: PendingOrder = {
      id: String(row.id),
      source: String(row.source) === "tiktok" ? "tiktok" : "shopify",
      orderNumber: String(row.order_number),
      fulfillment: String(row.fulfillment_status),
    };
    const application = await db.execute({ sql: "SELECT stock_recorded_at, packaging_applied_at FROM inventory_order_applications WHERE order_id = ? LIMIT 1", args: [order.id] });
    const current = application.rows[0];
    const now = new Date().toISOString();
    if (!current) {
      await db.execute({ sql: "INSERT INTO inventory_order_applications (order_id, state, created_at, updated_at) VALUES (?, 'pending', ?, ?)", args: [order.id, now, now] });
    }
    const lines = await db.execute({
      sql: `SELECT oi.id, oi.variant_id, oi.quantity, v.packaging_type, v.product_id
            FROM order_items oi LEFT JOIN variants v ON v.id = oi.variant_id WHERE oi.order_id = ?`,
      args: [order.id],
    });
    let unresolved = false;
    if (!current?.stock_recorded_at) {
      for (const line of lines.rows) {
        const variantId = line.variant_id ? String(line.variant_id) : "";
        if (!variantId) {
          unresolved = true;
          continue;
        }
        await db.execute({
          sql: `INSERT INTO stock_movements (id, variant_id, quantity_delta, reason, actor_name, source, reference_id, created_at)
                VALUES (?, ?, ?, 'order_observed', 'Channel reconciliation', ?, ?, ?)`,
          args: [crypto.randomUUID(), variantId, -Math.abs(Number(line.quantity ?? 0)), order.source, order.orderNumber, now],
        });
        stockMovements += 1;
        if (order.source === "shopify") {
          const components = await db.execute({
            sql: `SELECT component_variant_id, quantity_per_sale FROM bundle_components
                  WHERE bundle_type = 'shopify' AND bundle_product_id = ? AND component_variant_id IS NOT NULL`,
            args: [String(line.product_id ?? "")],
          });
          for (const component of components.rows) {
            await db.execute({
              sql: `INSERT INTO stock_movements (id, variant_id, quantity_delta, reason, actor_name, source, reference_id, created_at)
                    VALUES (?, ?, ?, 'bundle_component_observed', 'Channel reconciliation', ?, ?, ?)`,
              args: [crypto.randomUUID(), String(component.component_variant_id), -Math.abs(Number(line.quantity ?? 0)) * Math.max(1, Number(component.quantity_per_sale ?? 1)), order.source, order.orderNumber, now],
            });
            stockMovements += 1;
          }
        }
      }
      await db.execute({
        sql: "UPDATE inventory_order_applications SET stock_recorded_at = ?, state = ?, notes = ?, updated_at = ? WHERE order_id = ?",
        args: [now, unresolved ? "needs_mapping" : "pending", unresolved ? "One or more order lines have no confirmed inventory variant" : null, now, order.id],
      });
    }

    if (order.fulfillment === "fulfilled" && !current?.packaging_applied_at) {
      for (const line of lines.rows) {
        const packagingType = String(line.packaging_type ?? "");
        if (!packagingType) continue;
        const material = await db.execute({ sql: "SELECT id, quantity FROM packaging_materials WHERE title = ? LIMIT 1", args: [packagingType] });
        const materialRow = material.rows[0];
        if (!materialRow) continue;
        const available = Number(materialRow.quantity ?? 0);
        const requested = Math.abs(Number(line.quantity ?? 0));
        const applied = Math.min(available, requested);
        await db.batch([
          { sql: "UPDATE packaging_materials SET quantity = ?, updated_at = ? WHERE id = ?", args: [Math.max(0, available - requested), now, String(materialRow.id)] },
          { sql: `INSERT INTO stock_movements (id, packaging_material_id, quantity_delta, reason, actor_name, source, reference_id, created_at)
                  VALUES (?, ?, ?, 'fulfillment_packaging', 'Channel reconciliation', ?, ?, ?)`, args: [crypto.randomUUID(), String(materialRow.id), -applied, order.source, order.orderNumber, now] },
        ], "write");
        packagingMovements += 1;
      }
      await db.execute({ sql: "UPDATE inventory_order_applications SET packaging_applied_at = ?, state = CASE WHEN state = 'needs_mapping' THEN 'needs_mapping' ELSE 'applied' END, updated_at = ? WHERE order_id = ?", args: [now, now, order.id] });
    }
  }
  const alerts = await reconcileInventoryAlerts();
  return { baselineOrders: 0, stockMovements, packagingMovements, alerts };
}
