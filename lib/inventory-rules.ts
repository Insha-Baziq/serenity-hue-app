import "server-only";

import type { Transaction } from "@libsql/client";
import { ensurePhysicalChannelListings } from "@/lib/repository";
import { getTursoClient } from "@/lib/turso";

type Row = Record<string, unknown>;

function text(row: Row | undefined, key: string) {
  const value = row?.[key];
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function number(row: Row | undefined, key: string) {
  const value = row?.[key];
  return typeof value === "number" ? value : Number(value ?? 0);
}

async function refreshItemTotal(transaction: Transaction, itemId: string, now: string) {
  await transaction.execute({
    sql: `UPDATE physical_inventory_items
          SET quantity = COALESCE((SELECT SUM(quantity) FROM physical_inventory_variants WHERE physical_item_id = ?), 0),
              quantity_known = CASE WHEN EXISTS (
                SELECT 1 FROM physical_inventory_variants WHERE physical_item_id = ? AND quantity_known = 0
              ) THEN 0 ELSE 1 END,
              updated_at = ?
          WHERE id = ?`,
    args: [itemId, itemId, now, itemId],
  });
}

async function applyPhysicalRestoration(input: {
  source: "shopify" | "tiktok";
  eventType: "refund" | "cancel";
  eventId: string;
  orderId: string;
  orderLineItemId: string;
  physicalVariantId: string;
  physicalItemId: string;
  quantity: number;
  actor: string;
  reference: string;
}) {
  if (!Number.isInteger(input.quantity) || input.quantity === 0) return false;
  const db = await getTursoClient();
  const now = new Date().toISOString();
  const transaction = await db.transaction("write");
  try {
    const physical = await transaction.execute({
      sql: "SELECT quantity FROM physical_inventory_variants WHERE id = ?",
      args: [input.physicalVariantId],
    });
    const before = number(physical.rows[0] as Row | undefined, "quantity");
    const inserted = await transaction.execute({
      sql: `INSERT OR IGNORE INTO physical_inventory_applications
            (id, source, event_type, source_event_id, order_id, order_line_item_id, physical_variant_id, quantity_delta, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [crypto.randomUUID(), input.source, input.eventType, input.eventId, input.orderId, input.orderLineItemId, input.physicalVariantId, input.quantity, now],
    });
    if (inserted.rowsAffected === 0) {
      await transaction.commit();
      return false;
    }
    await transaction.execute({
      sql: "UPDATE physical_inventory_variants SET quantity = quantity + ?, quantity_known = 1, updated_at = ? WHERE id = ?",
      args: [input.quantity, now, input.physicalVariantId],
    });
    await transaction.execute({
      sql: `INSERT INTO physical_inventory_ledger
            (id, physical_item_id, change_type, actor, quantity_before, quantity_after, quantity_delta, reference, created_at)
            VALUES (?, ?, 'reconcile_fix', ?, ?, ?, ?, ?, ?)`,
      args: [crypto.randomUUID(), input.physicalItemId, input.actor, before, before + input.quantity, input.quantity, input.reference, now],
    });
    await refreshItemTotal(transaction, input.physicalItemId, now);
    await transaction.commit();
    return true;
  } catch (error) {
    await transaction.rollback();
    throw error;
  } finally {
    transaction.close();
  }
}

/**
 * Applies Shopify and TikTok sales and after-sales events to canonical
 * physical variants. Historical orders are baselined once per channel; later
 * order lines expand through their saved listing recipes and immutable
 * application rows prevent duplicate or out-of-order sync effects.
 */
export async function reconcileInventoryOperations() {
  await ensurePhysicalChannelListings();
  const db = await getTursoClient();
  const now = new Date().toISOString();
  const [shopifyBaseline, tiktokBaseline] = await Promise.all([
    db.execute({ sql: "SELECT value FROM inventory_settings WHERE key = 'physical-inventory-order-baseline' LIMIT 1", args: [] }),
    db.execute({ sql: "SELECT value FROM inventory_settings WHERE key = 'physical-inventory-tiktok-order-baseline' LIMIT 1", args: [] }),
  ]);
  const baselineStatements: { sql: string; args: (string | number | null)[] }[] = [];
  let baselineOrders = 0;
  if (!shopifyBaseline.rows[0]) {
    const existing = await db.execute({ sql: "SELECT COUNT(*) AS count FROM orders WHERE source = 'shopify'", args: [] });
    baselineOrders += number(existing.rows[0], "count");
    baselineStatements.push(
      {
        sql: `INSERT OR IGNORE INTO physical_inventory_order_state (order_id, sale_state, created_at, updated_at)
              SELECT id, 'baseline', ?, ? FROM orders WHERE source = 'shopify'`,
        args: [now, now],
      },
      {
        sql: `INSERT INTO inventory_settings (key, value, updated_at) VALUES ('physical-inventory-order-baseline', ?, ?)
              ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
        args: [now, now],
      },
    );
  }
  if (!tiktokBaseline.rows[0]) {
    const existing = await db.execute({ sql: "SELECT COUNT(*) AS count FROM orders WHERE source = 'tiktok'", args: [] });
    baselineOrders += number(existing.rows[0], "count");
    baselineStatements.push(
      {
        sql: `INSERT OR IGNORE INTO physical_inventory_order_state (order_id, sale_state, created_at, updated_at)
              SELECT id, 'baseline', ?, ? FROM orders WHERE source = 'tiktok'`,
        args: [now, now],
      },
      {
        sql: `INSERT INTO inventory_settings (key, value, updated_at) VALUES ('physical-inventory-tiktok-order-baseline', ?, ?)
              ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
        args: [now, now],
      },
    );
  }
  if (baselineStatements.length > 0) await db.batch(baselineStatements, "write");

  const pending = await db.execute({
    sql: `SELECT o.id FROM orders o
          LEFT JOIN physical_inventory_order_state s ON s.order_id = o.id
          WHERE o.source IN ('shopify', 'tiktok') AND (s.order_id IS NULL OR s.sale_state = 'needs_mapping')
          ORDER BY o.source_created_at ASC`,
    args: [],
  });
  let stockMovements = 0;

  for (const pendingOrder of pending.rows) {
    const orderId = text(pendingOrder as Row, "id");
    const mapped = await db.execute({
      sql: `SELECT oi.id AS order_line_item_id, oi.quantity AS line_quantity, o.source,
                    c.physical_variant_id, c.quantity_per_sale,
                    piv.physical_item_id, piv.quantity AS physical_quantity
             FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
             LEFT JOIN physical_channel_listings l
               ON l.active = 1 AND l.channel = o.source
              AND ((o.source = 'shopify' AND l.external_variant_id = oi.source_variant_id)
                OR (o.source = 'tiktok' AND l.external_product_id = oi.source_product_id
                  AND (l.external_variant_id = oi.source_variant_id
                    OR (l.external_variant_id IS NULL AND NOT EXISTS (
                      SELECT 1 FROM physical_channel_listings exact_listing
                      WHERE exact_listing.channel = 'tiktok' AND exact_listing.active = 1
                        AND exact_listing.external_product_id = oi.source_product_id
                        AND exact_listing.external_variant_id = oi.source_variant_id
                    )))))
             LEFT JOIN physical_listing_components c ON c.listing_id = l.id
             LEFT JOIN physical_inventory_variants piv ON piv.id = c.physical_variant_id
             WHERE oi.order_id = ?
             ORDER BY oi.id, c.id`,
      args: [orderId],
    });
    const orderLines = await db.execute({ sql: "SELECT id FROM order_items WHERE order_id = ?", args: [orderId] });
    const mappedLineIds = new Set(mapped.rows.map((row) => text(row as Row, "order_line_item_id")));
    const complete = orderLines.rows.length > 0 && mappedLineIds.size === orderLines.rows.length
      && mapped.rows.every((row) => Boolean(text(row as Row, "physical_variant_id")));
    if (!complete) {
      await db.execute({
        sql: `INSERT INTO physical_inventory_order_state (order_id, sale_state, created_at, updated_at)
              VALUES (?, 'needs_mapping', ?, ?)
              ON CONFLICT(order_id) DO UPDATE SET sale_state='needs_mapping', updated_at=excluded.updated_at`,
        args: [orderId, now, now],
      });
      continue;
    }

    const transaction = await db.transaction("write");
    try {
      const itemIds = new Set<string>();
      for (const rawRow of mapped.rows) {
        const row = rawRow as Row;
        const lineId = text(row, "order_line_item_id");
        const physicalVariantId = text(row, "physical_variant_id");
        const quantity = Math.abs(number(row, "line_quantity")) * Math.max(1, number(row, "quantity_per_sale"));
        const before = number(row, "physical_quantity");
        const delta = -quantity;
        const eventId = `${orderId}:${lineId}`;
        const source = text(row, "source") === "tiktok" ? "tiktok" : "shopify";
        const inserted = await transaction.execute({
          sql: `INSERT OR IGNORE INTO physical_inventory_applications
                (id, source, event_type, source_event_id, order_id, order_line_item_id, physical_variant_id, quantity_delta, created_at)
                VALUES (?, ?, 'sale', ?, ?, ?, ?, ?, ?)`,
          args: [crypto.randomUUID(), source, `${source}:${eventId}`, orderId, lineId, physicalVariantId, delta, now],
        });
        if (inserted.rowsAffected === 0) continue;
        await transaction.execute({
          sql: "UPDATE physical_inventory_variants SET quantity = quantity + ?, quantity_known = 1, updated_at = ? WHERE id = ?",
          args: [delta, now, physicalVariantId],
        });
        await transaction.execute({
          sql: `INSERT INTO physical_inventory_ledger
                (id, physical_item_id, change_type, actor, quantity_before, quantity_after, quantity_delta, reference, created_at)
              VALUES (?, ?, 'sale', ?, ?, ?, ?, ?, ?)`,
          args: [crypto.randomUUID(), text(row, "physical_item_id"), `${source === "tiktok" ? "TikTok" : "Shopify"} order sync`, before, before + delta, delta, `${source}-order:${eventId}`, now],
        });
        itemIds.add(text(row, "physical_item_id"));
        stockMovements += 1;
      }
      for (const itemId of itemIds) await refreshItemTotal(transaction, itemId, now);
      await transaction.execute({
        sql: `INSERT INTO physical_inventory_order_state (order_id, sale_state, created_at, updated_at)
              VALUES (?, 'applied', ?, ?)
              ON CONFLICT(order_id) DO UPDATE SET sale_state='applied', updated_at=excluded.updated_at`,
        args: [orderId, now, now],
      });
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    } finally {
      transaction.close();
    }
  }

  const refunds = await db.execute({
    sql: `SELECT r.refund_id, r.order_id, r.source_line_item_id, r.quantity AS refund_quantity,
                 oi.quantity AS line_quantity, a.physical_variant_id, a.quantity_delta AS sale_delta,
                 piv.physical_item_id, piv.quantity AS physical_quantity
          FROM shopify_refund_line_items r
          JOIN physical_inventory_order_state s ON s.order_id = r.order_id AND s.sale_state = 'applied'
          JOIN order_items oi ON oi.order_id = r.order_id AND oi.source_line_item_id = r.source_line_item_id
          JOIN physical_inventory_applications a
            ON a.source = 'shopify' AND a.event_type = 'sale'
            AND a.order_id = r.order_id AND a.order_line_item_id = oi.id
          JOIN physical_inventory_variants piv ON piv.id = a.physical_variant_id
          LEFT JOIN physical_inventory_applications already
            ON already.source = 'shopify' AND already.event_type = 'refund'
            AND already.source_event_id = r.refund_id || ':' || r.source_line_item_id
            AND already.physical_variant_id = a.physical_variant_id
          WHERE already.id IS NULL`,
    args: [],
  });
  for (const rawRow of refunds.rows) {
    const row = rawRow as Row;
    const lineQuantity = number(row, "line_quantity");
    const restored = lineQuantity > 0
      ? Math.abs(number(row, "sale_delta")) / lineQuantity * number(row, "refund_quantity")
      : 0;
    if (!Number.isInteger(restored) || restored <= 0) continue;
    const transaction = await db.transaction("write");
    try {
      const before = number(row, "physical_quantity");
      const eventId = `${text(row, "refund_id")}:${text(row, "source_line_item_id")}`;
      await transaction.execute({
        sql: `INSERT INTO physical_inventory_applications
              (id, source, event_type, source_event_id, order_id, order_line_item_id, physical_variant_id, quantity_delta, created_at)
              VALUES (?, 'shopify', 'refund', ?, ?, ?, ?, ?, ?)`,
        args: [crypto.randomUUID(), eventId, text(row, "order_id"), text(row, "source_line_item_id"), text(row, "physical_variant_id"), restored, now],
      });
      await transaction.execute({
        sql: "UPDATE physical_inventory_variants SET quantity = quantity + ?, quantity_known = 1, updated_at = ? WHERE id = ?",
        args: [restored, now, text(row, "physical_variant_id")],
      });
      await transaction.execute({
        sql: `INSERT INTO physical_inventory_ledger
              (id, physical_item_id, change_type, actor, quantity_before, quantity_after, quantity_delta, reference, created_at)
              VALUES (?, ?, 'reconcile_fix', 'Shopify refund sync', ?, ?, ?, ?, ?)`,
        args: [crypto.randomUUID(), text(row, "physical_item_id"), before, before + restored, restored, `shopify-refund:${eventId}`, now],
      });
      await refreshItemTotal(transaction, text(row, "physical_item_id"), now);
      await transaction.commit();
      stockMovements += 1;
    } catch (error) {
      await transaction.rollback();
      throw error;
    } finally {
      transaction.close();
    }
  }

  const cancellations = await db.execute({
    sql: `SELECT o.id AS order_id, a.order_line_item_id, a.physical_variant_id,
                 a.quantity_delta AS sale_delta, piv.physical_item_id, piv.quantity AS physical_quantity,
                 COALESCE(SUM(refund.quantity_delta), 0) AS refunded_quantity
          FROM orders o
          JOIN physical_inventory_order_state s ON s.order_id = o.id AND s.sale_state = 'applied'
          JOIN physical_inventory_applications a
            ON a.order_id = o.id AND a.source = 'shopify' AND a.event_type = 'sale'
          JOIN physical_inventory_variants piv ON piv.id = a.physical_variant_id
          LEFT JOIN physical_inventory_applications refund
            ON refund.order_id = o.id AND refund.source = 'shopify' AND refund.event_type = 'refund'
            AND refund.order_line_item_id = a.order_line_item_id AND refund.physical_variant_id = a.physical_variant_id
          LEFT JOIN physical_inventory_applications already
            ON already.order_id = o.id AND already.source = 'shopify' AND already.event_type = 'cancel'
            AND already.source_event_id = o.id || ':' || a.order_line_item_id
            AND already.physical_variant_id = a.physical_variant_id
          WHERE o.source = 'shopify' AND o.cancelled_at IS NOT NULL AND already.id IS NULL
          GROUP BY o.id, a.order_line_item_id, a.physical_variant_id, a.quantity_delta, piv.physical_item_id, piv.quantity`,
    args: [],
  });
  for (const rawRow of cancellations.rows) {
    const row = rawRow as Row;
    const restored = Math.abs(number(row, "sale_delta")) - number(row, "refunded_quantity");
    if (restored <= 0) continue;
    const transaction = await db.transaction("write");
    try {
      const before = number(row, "physical_quantity");
      const orderId = text(row, "order_id");
      const eventId = `${orderId}:${text(row, "order_line_item_id")}`;
      await transaction.execute({
        sql: `INSERT INTO physical_inventory_applications
              (id, source, event_type, source_event_id, order_id, order_line_item_id, physical_variant_id, quantity_delta, created_at)
              VALUES (?, 'shopify', 'cancel', ?, ?, ?, ?, ?, ?)`,
        args: [crypto.randomUUID(), eventId, orderId, text(row, "order_line_item_id"), text(row, "physical_variant_id"), restored, now],
      });
      await transaction.execute({
        sql: "UPDATE physical_inventory_variants SET quantity = quantity + ?, quantity_known = 1, updated_at = ? WHERE id = ?",
        args: [restored, now, text(row, "physical_variant_id")],
      });
      await transaction.execute({
        sql: `INSERT INTO physical_inventory_ledger
              (id, physical_item_id, change_type, actor, quantity_before, quantity_after, quantity_delta, reference, created_at)
              VALUES (?, ?, 'reconcile_fix', 'Shopify cancellation sync', ?, ?, ?, ?, ?)`,
        args: [crypto.randomUUID(), text(row, "physical_item_id"), before, before + restored, restored, `shopify-cancel:${eventId}`, now],
      });
      await refreshItemTotal(transaction, text(row, "physical_item_id"), now);
      await transaction.commit();
      stockMovements += 1;
    } catch (error) {
      await transaction.rollback();
      throw error;
    } finally {
      transaction.close();
    }
  }

  // TikTok cancellations and returns are separate after-sales records. A
  // request in progress is deliberately ignored; only an accepted/completed
  // cancellation or a successful physical return restores stock. Refund-only
  // requests are excluded because the buyer keeps the item.
  const tiktokReversals = await db.execute({
    sql: `SELECT r.order_id, r.event_type, r.event_id, r.return_type, r.quantity AS reversal_quantity, r.source_updated_at,
                 oi.id AS order_line_item_id, oi.quantity AS line_quantity,
                 a.physical_variant_id, a.quantity_delta AS sale_delta,
                 piv.physical_item_id
          FROM tiktok_after_sales_line_items r
          JOIN physical_inventory_order_state s ON s.order_id = r.order_id AND s.sale_state = 'applied'
          JOIN order_items oi ON oi.order_id = r.order_id AND oi.source_line_item_id = r.source_line_item_id
          JOIN physical_inventory_applications a
            ON a.source = 'tiktok' AND a.event_type = 'sale'
            AND a.order_id = r.order_id AND a.order_line_item_id = oi.id
          JOIN physical_inventory_variants piv ON piv.id = a.physical_variant_id
          WHERE (r.event_type = 'cancel' AND r.status IN ('CANCELLATION_REQUEST_SUCCESS', 'CANCELLATION_REQUEST_COMPLETE'))
             OR (r.event_type = 'return' AND r.return_type = 'RETURN_AND_REFUND'
                 AND r.status IN ('RETURN_OR_REFUND_REQUEST_SUCCESS', 'RETURN_OR_REFUND_REQUEST_COMPLETE'))`,
    args: [],
  });
  for (const rawRow of tiktokReversals.rows) {
    const row = rawRow as Row;
    const lineQuantity = number(row, "line_quantity");
    const requested = lineQuantity > 0
      ? Math.abs(number(row, "sale_delta")) / lineQuantity * number(row, "reversal_quantity")
      : 0;
    if (!Number.isInteger(requested) || requested <= 0) continue;
    const eventType = text(row, "event_type") === "cancel" ? "cancel" : "refund";
    const eventPrefix = `tiktok-${eventType}:${text(row, "event_id")}:${text(row, "order_line_item_id")}:${text(row, "physical_variant_id")}`;
    const previousForEvent = await db.execute({
      sql: `SELECT COALESCE(SUM(quantity_delta), 0) AS restored
            FROM physical_inventory_applications
            WHERE source='tiktok' AND source_event_id LIKE ?`,
      args: [`${eventPrefix}:%`],
    });
    const previous = await db.execute({
      sql: `SELECT COALESCE(SUM(quantity_delta), 0) AS restored
            FROM physical_inventory_applications
            WHERE source='tiktok' AND event_type IN ('cancel', 'refund')
              AND order_id = ? AND order_line_item_id = ? AND physical_variant_id = ?
              AND source_event_id NOT LIKE ?`,
      args: [text(row, "order_id"), text(row, "order_line_item_id"), text(row, "physical_variant_id"), `${eventPrefix}:%`],
    });
    const previousForThisEvent = number(previousForEvent.rows[0], "restored");
    const allowedForThisEvent = Math.max(0, Math.abs(number(row, "sale_delta")) - number(previous.rows[0], "restored"));
    const desired = Math.min(allowedForThisEvent, requested);
    const restored = desired - previousForThisEvent;
    if (restored === 0) continue;
    const eventId = `${eventPrefix}:${text(row, "source_updated_at") || "current"}:${desired}`;
    const applied = await applyPhysicalRestoration({
      source: "tiktok",
      eventType,
      eventId,
      orderId: text(row, "order_id"),
      orderLineItemId: text(row, "order_line_item_id"),
      physicalVariantId: text(row, "physical_variant_id"),
      physicalItemId: text(row, "physical_item_id"),
      quantity: restored,
      actor: eventType === "cancel" ? "TikTok cancellation sync" : "TikTok return sync",
      reference: `${eventType === "cancel" ? "tiktok-cancel" : "tiktok-return"}:${text(row, "event_id")}:${text(row, "order_line_item_id")}`,
    });
    if (applied) stockMovements += 1;
  }

  // The order-status API is the fallback for a full TikTok cancellation. This
  // also covers a cancellation when the seller has not granted after-sales
  // search scope. Any line-level cancellation already restored above is
  // subtracted, so the two signals cannot double-restore stock.
  const tiktokOrderCancellations = await db.execute({
    sql: `SELECT o.id AS order_id, a.order_line_item_id, a.physical_variant_id,
                 a.quantity_delta AS sale_delta, piv.physical_item_id
          FROM orders o
          JOIN physical_inventory_order_state s ON s.order_id = o.id AND s.sale_state = 'applied'
          JOIN physical_inventory_applications a
            ON a.order_id = o.id AND a.source = 'tiktok' AND a.event_type = 'sale'
          JOIN physical_inventory_variants piv ON piv.id = a.physical_variant_id
          WHERE o.source = 'tiktok' AND o.cancelled_at IS NOT NULL`,
    args: [],
  });
  for (const rawRow of tiktokOrderCancellations.rows) {
    const row = rawRow as Row;
    const previous = await db.execute({
      sql: `SELECT COALESCE(SUM(quantity_delta), 0) AS restored
            FROM physical_inventory_applications
            WHERE source='tiktok' AND event_type IN ('cancel', 'refund')
              AND order_id = ? AND order_line_item_id = ? AND physical_variant_id = ?`,
      args: [text(row, "order_id"), text(row, "order_line_item_id"), text(row, "physical_variant_id")],
    });
    const restored = Math.abs(number(row, "sale_delta")) - number(previous.rows[0], "restored");
    if (restored <= 0) continue;
    const applied = await applyPhysicalRestoration({
      source: "tiktok",
      eventType: "cancel",
      eventId: `tiktok-order-cancel:${text(row, "order_id")}:${text(row, "order_line_item_id")}:${text(row, "physical_variant_id")}`,
      orderId: text(row, "order_id"),
      orderLineItemId: text(row, "order_line_item_id"),
      physicalVariantId: text(row, "physical_variant_id"),
      physicalItemId: text(row, "physical_item_id"),
      quantity: restored,
      actor: "TikTok cancellation sync",
      reference: `tiktok-order-cancel:${text(row, "order_id")}:${text(row, "order_line_item_id")}`,
    });
    if (applied) stockMovements += 1;
  }

  return { baselineOrders, stockMovements, packagingMovements: 0, alerts: 0 };
}
