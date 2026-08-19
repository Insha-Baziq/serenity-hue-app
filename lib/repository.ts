import "server-only";

import { getTursoClient } from "@/lib/turso";
import { hashPassword } from "better-auth/crypto";
import type { ChannelInventoryRow, ChannelInventorySnapshot, Employee, InventoryAlert, InventoryLedgerEntry, InventorySnapshot, Order, PackagingMaterial, Parcel2GoDelivery, Parcel2GoMatchMethod, Parcel2GoShipmentOption, ProductInventory, StockMovement, SyncSnapshot } from "@/lib/types";

type SqlValue = string | number | null;

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown) {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function nullableNumber(value: unknown) {
  return value === null || value === undefined ? null : numberValue(value);
}

function stringArray(value: unknown) {
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function toMapping(value: string): ProductInventory["mapping"] {
  return value === "review" || value === "unmapped" ? value : "confirmed";
}

function toFulfillment(value: string): Order["fulfillment"] {
  return value === "fulfilled" || value === "partial" ? value : "unfulfilled";
}

function toPayment(value: string): Order["payment"] {
  return value === "refunded" || value === "pending" ? value : "paid";
}

function optionalString(value: unknown) {
  const text = stringValue(value);
  return text || undefined;
}

function toParcel2GoMatchMethod(value: unknown): Parcel2GoMatchMethod | undefined {
  const method = stringValue(value);
  return method === "order_reference" || method === "customer_email" || method === "customer_phone" || method === "delivery_address"
    ? method
    : undefined;
}

async function getParcel2GoDeliveriesForOrders(orderIds: string[]) {
  const deliveriesByOrderId = new Map<string, Parcel2GoDelivery[]>();
  if (orderIds.length === 0) return deliveriesByOrderId;
  const db = await getTursoClient();
  const placeholders = orderIds.map(() => "?").join(", ");
  const shipments = await db.execute({
    sql: `SELECT id, order_id, external_order_line_id, courier, service, status, paid_at, collection_date, estimated_delivery_at, tracking_url, match_method
          FROM shipments WHERE order_id IN (${placeholders}) AND provider = 'parcel2go' ORDER BY last_synced_at DESC`,
    args: orderIds,
  });
  const deliveriesByShipmentId = new Map<string, Parcel2GoDelivery>();
  for (const shipment of shipments.rows) {
    const shipmentId = stringValue(shipment.id);
    const orderId = stringValue(shipment.order_id);
    if (!shipmentId || !orderId) continue;
    const delivery: Parcel2GoDelivery = {
      id: shipmentId,
      orderLineId: stringValue(shipment.external_order_line_id),
      courier: stringValue(shipment.courier) || "Parcel2Go courier",
      service: stringValue(shipment.service) || "Service details unavailable",
      status: stringValue(shipment.status) || "booked",
      paidAt: optionalString(shipment.paid_at),
      collectionDate: optionalString(shipment.collection_date),
      estimatedDeliveryAt: optionalString(shipment.estimated_delivery_at),
      trackingUrl: optionalString(shipment.tracking_url),
      matchMethod: toParcel2GoMatchMethod(shipment.match_method),
      events: [],
    };
    deliveriesByShipmentId.set(shipmentId, delivery);
    const orderDeliveries = deliveriesByOrderId.get(orderId) ?? [];
    orderDeliveries.push(delivery);
    deliveriesByOrderId.set(orderId, orderDeliveries);
  }
  const shipmentIds = [...deliveriesByShipmentId.keys()];
  if (shipmentIds.length === 0) return deliveriesByOrderId;
  const eventPlaceholders = shipmentIds.map(() => "?").join(", ");
  const events = await db.execute({
    sql: `SELECT id, shipment_id, event_key, label, occurred_at FROM shipment_events
          WHERE shipment_id IN (${eventPlaceholders}) ORDER BY occurred_at ASC`,
    args: shipmentIds,
  });
  for (const event of events.rows) {
    const delivery = deliveriesByShipmentId.get(stringValue(event.shipment_id));
    if (!delivery) continue;
    delivery.events.push({
      id: stringValue(event.id),
      key: stringValue(event.event_key),
      label: stringValue(event.label),
      occurredAt: stringValue(event.occurred_at),
    });
  }
  return deliveriesByOrderId;
}

export async function getOrders(): Promise<Order[]> {
  const db = await getTursoClient();
  const result = await db.execute(`
    SELECT id, source, source_order_id, order_number, customer_name, customer_email, customer_phone, shipping_address_json,
           financial_status, fulfillment_status, source_created_at,
           subtotal_amount, shipping_amount, tax_amount, total_amount
    FROM orders ORDER BY source_created_at DESC LIMIT 500
  `);

  if (result.rows.length === 0) return [];
  const deliveriesByOrderId = await getParcel2GoDeliveriesForOrders(result.rows.map((row) => stringValue(row.id)).filter(Boolean));

  return Promise.all(result.rows.map(async (row) => {
    const id = stringValue(row.id);
    const itemsResult = await db.execute({
      sql: `SELECT id, title, variant_title, sku, quantity, unit_price_amount, image_url
            FROM order_items WHERE order_id = ? ORDER BY rowid`,
      args: [id],
    });
    const source = stringValue(row.source);
    const sourceOrderId = stringValue(row.source_order_id);
    return {
      id,
      sourceOrderId,
      adminUrl: source === "shopify" ? shopifyOrderAdminUrl(sourceOrderId) : undefined,
      number: stringValue(row.order_number),
      channel: source === "tiktok" ? "tiktok" : "shopify",
      customer: stringValue(row.customer_name) || "Guest customer",
      email: stringValue(row.customer_email),
      phone: stringValue(row.customer_phone),
      address: stringArray(row.shipping_address_json),
      payment: toPayment(stringValue(row.financial_status)),
      fulfillment: toFulfillment(stringValue(row.fulfillment_status)),
      createdAt: stringValue(row.source_created_at),
      subtotal: numberValue(row.subtotal_amount),
      shipping: numberValue(row.shipping_amount),
      tax: numberValue(row.tax_amount),
      total: numberValue(row.total_amount),
      items: itemsResult.rows.map((item) => ({
        id: stringValue(item.id),
        title: stringValue(item.title),
        variant: stringValue(item.variant_title),
        sku: stringValue(item.sku),
        quantity: numberValue(item.quantity),
        unitPrice: numberValue(item.unit_price_amount),
        imageTone: "blush" as const,
      })),
      deliveries: deliveriesByOrderId.get(id) ?? [],
    } satisfies Order;
  }));
}

export async function getEmployees(): Promise<Employee[]> {
  const db = await getTursoClient();
  const now = new Date().toISOString();
  const result = await db.execute({
    sql: `SELECT u.id, u.name, u.email, u.image, u.createdAt,
                 MAX(s.updatedAt) AS last_seen_at,
                 CASE WHEN MAX(CASE WHEN s.expiresAt > ? THEN 1 ELSE 0 END) = 1
                      THEN 'active' ELSE 'offline' END AS status
          FROM "user" AS u
          LEFT JOIN "session" AS s ON s.userId = u.id
          GROUP BY u.id, u.name, u.email, u.image, u.createdAt
          ORDER BY u.createdAt DESC`,
    args: [now],
  });

  return result.rows.map((row) => ({
    id: stringValue(row.id),
    name: stringValue(row.name) || "Unnamed employee",
    email: stringValue(row.email),
    image: optionalString(row.image),
    createdAt: stringValue(row.createdAt),
    lastSeenAt: optionalString(row.last_seen_at),
    status: stringValue(row.status) === "active" ? "active" : "offline",
  }));
}

export async function createEmployee(input: { name: string; email: string; password: string }): Promise<Employee> {
  const db = await getTursoClient();
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const existing = await db.execute({ sql: `SELECT id FROM "user" WHERE lower(email) = ? LIMIT 1`, args: [email] });
  if (existing.rows.length > 0) throw new Error("EMPLOYEE_ALREADY_EXISTS");

  const now = new Date().toISOString();
  const userId = `user_${crypto.randomUUID()}`;
  const accountId = `account_${crypto.randomUUID()}`;
  const passwordHash = await hashPassword(input.password);

  await db.execute({
    sql: `INSERT INTO "user" (id, name, email, emailVerified, image, createdAt, updatedAt)
          VALUES (?, ?, ?, 0, NULL, ?, ?)`,
    args: [userId, name, email, now, now],
  });
  await db.execute({
    sql: `INSERT INTO "account"
            (id, accountId, providerId, userId, accessToken, refreshToken, idToken,
             accessTokenExpiresAt, refreshTokenExpiresAt, scope, password, createdAt, updatedAt)
          VALUES (?, ?, 'credential', ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?)`,
    args: [accountId, userId, userId, passwordHash, now, now],
  });

  return { id: userId, name, email, createdAt: now, status: "offline" };
}

export async function getUnlinkedParcel2GoShipments(): Promise<Parcel2GoShipmentOption[]> {
  const db = await getTursoClient();
  const result = await db.execute(`
    SELECT id, external_order_line_id, courier, service, status, collection_date, estimated_delivery_at
    FROM shipments
    WHERE provider = 'parcel2go' AND order_id IS NULL
    ORDER BY COALESCE(collection_date, updated_at) DESC
    LIMIT 25
  `);
  return result.rows.map((shipment) => ({
    id: stringValue(shipment.id),
    orderLineId: stringValue(shipment.external_order_line_id),
    courier: stringValue(shipment.courier) || "Parcel2Go courier",
    service: stringValue(shipment.service) || "Service details unavailable",
    status: stringValue(shipment.status) || "booked",
    collectionDate: optionalString(shipment.collection_date),
    estimatedDeliveryAt: optionalString(shipment.estimated_delivery_at),
  }));
}

export async function linkParcel2GoShipment(orderId: string, shipmentId: string) {
  const db = await getTursoClient();
  const [orderResult, shipmentResult] = await Promise.all([
    db.execute({ sql: "SELECT id FROM orders WHERE id = ? LIMIT 1", args: [orderId] }),
    db.execute({ sql: "SELECT order_id FROM shipments WHERE id = ? AND provider = 'parcel2go' LIMIT 1", args: [shipmentId] }),
  ]);
  if (orderResult.rows.length === 0) throw new Error("Order not found");
  const shipment = shipmentResult.rows[0];
  if (!shipment) throw new Error("Parcel2Go delivery not found");
  const linkedOrderId = optionalString(shipment.order_id);
  if (linkedOrderId && linkedOrderId !== orderId) throw new Error("This Parcel2Go delivery is already linked to another order");
  await db.execute({ sql: "UPDATE shipments SET order_id = ?, updated_at = ? WHERE id = ?", args: [orderId, new Date().toISOString(), shipmentId] });
}

export async function recordParcel2GoWebhook(input: { externalEventId: string; topic: string }) {
  const db = await getTursoClient();
  const result = await db.execute({
    sql: `INSERT INTO webhook_events (id, provider, external_event_id, topic, received_at, processed_at, status)
          VALUES (?, 'parcel2go', ?, ?, ?, ?, 'processed')
          ON CONFLICT(provider, external_event_id) DO NOTHING`,
    args: [`parcel2go:${input.externalEventId}`, input.externalEventId, input.topic, new Date().toISOString(), new Date().toISOString()],
  });
  return result.rowsAffected > 0;
}

export async function createTikTokOAuthState(input: { id: string; stateHash: string; expiresAt: string }) {
  const db = await getTursoClient();
  await db.execute({
    sql: `INSERT INTO tiktok_oauth_states (id, state_hash, expires_at) VALUES (?, ?, ?)`,
    args: [input.id, input.stateHash, input.expiresAt],
  });
}

export async function consumeTikTokOAuthState(stateHash: string) {
  const db = await getTursoClient();
  const now = new Date().toISOString();
  const result = await db.execute({
    sql: `UPDATE tiktok_oauth_states SET used_at = ?
          WHERE state_hash = ? AND used_at IS NULL AND expires_at > ?`,
    args: [now, stateHash, now],
  });
  return result.rowsAffected > 0;
}

export async function saveTikTokConnection(input: {
  openId?: string;
  userType?: number;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt?: string;
  refreshTokenExpiresAt?: string;
  grantedScopes?: string[];
}) {
  const db = await getTursoClient();
  const now = new Date().toISOString();
  const id = input.openId ? `tiktok:${input.openId}` : `tiktok:${crypto.randomUUID()}`;
  await db.execute({
    sql: `INSERT INTO tiktok_connections
            (id, open_id, user_type, access_token, refresh_token, access_token_expires_at,
             refresh_token_expires_at, granted_scopes, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            user_type = excluded.user_type,
            access_token = excluded.access_token,
            refresh_token = excluded.refresh_token,
            access_token_expires_at = excluded.access_token_expires_at,
            refresh_token_expires_at = excluded.refresh_token_expires_at,
            granted_scopes = excluded.granted_scopes,
            status = 'active',
            updated_at = excluded.updated_at`,
    args: [
      id,
      input.openId ?? null,
      input.userType ?? null,
      input.accessToken,
      input.refreshToken,
      input.accessTokenExpiresAt ?? null,
      input.refreshTokenExpiresAt ?? null,
      JSON.stringify(input.grantedScopes ?? []),
      now,
      now,
    ] as SqlValue[],
  });
  return id;
}

export type TikTokConnection = {
  id: string;
  shopId?: string;
  shopCipher?: string;
  openId?: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt?: string;
  refreshTokenExpiresAt?: string;
  grantedScopes: string[];
};

export async function getActiveTikTokConnections(): Promise<TikTokConnection[]> {
  const db = await getTursoClient();
  const result = await db.execute(`
    SELECT id, shop_id, shop_cipher, open_id, access_token, refresh_token,
           access_token_expires_at, refresh_token_expires_at, granted_scopes
    FROM tiktok_connections
    WHERE status = 'active'
    ORDER BY updated_at DESC
  `);
  return result.rows.map((row) => ({
    id: stringValue(row.id),
    shopId: optionalString(row.shop_id),
    shopCipher: optionalString(row.shop_cipher),
    openId: optionalString(row.open_id),
    accessToken: stringValue(row.access_token),
    refreshToken: stringValue(row.refresh_token),
    accessTokenExpiresAt: optionalString(row.access_token_expires_at),
    refreshTokenExpiresAt: optionalString(row.refresh_token_expires_at),
    grantedScopes: stringArray(row.granted_scopes),
  })).filter((connection) => Boolean(connection.id && connection.accessToken && connection.refreshToken));
}

export async function hasActiveTikTokConnection() {
  const db = await getTursoClient();
  const result = await db.execute("SELECT 1 FROM tiktok_connections WHERE status = 'active' LIMIT 1");
  return result.rows.length > 0;
}

export async function updateTikTokConnectionTokens(input: {
  id: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt?: string;
  refreshTokenExpiresAt?: string;
}) {
  const db = await getTursoClient();
  await db.execute({
    sql: `UPDATE tiktok_connections
          SET access_token = ?, refresh_token = ?, access_token_expires_at = ?, refresh_token_expires_at = ?,
              status = 'active', updated_at = ?
          WHERE id = ?`,
    args: [
      input.accessToken,
      input.refreshToken,
      input.accessTokenExpiresAt ?? null,
      input.refreshTokenExpiresAt ?? null,
      new Date().toISOString(),
      input.id,
    ],
  });
}

export async function updateTikTokConnectionShop(input: { id: string; shopId: string; shopCipher: string }) {
  const db = await getTursoClient();
  await db.execute({
    sql: "UPDATE tiktok_connections SET shop_id = ?, shop_cipher = ?, updated_at = ? WHERE id = ?",
    args: [input.shopId, input.shopCipher, new Date().toISOString(), input.id],
  });
}

export async function hasCompletedTikTokBackfill() {
  const db = await getTursoClient();
  const result = await db.execute(
    "SELECT 1 FROM tiktok_import_state WHERE id = 'global' AND backfill_completed_at IS NOT NULL LIMIT 1",
  );
  return result.rows.length > 0;
}

export async function markTikTokBackfillCompleted() {
  const db = await getTursoClient();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO tiktok_import_state (id, backfill_completed_at, updated_at)
          VALUES ('global', ?, ?)
          ON CONFLICT(id) DO UPDATE SET backfill_completed_at = excluded.backfill_completed_at,
            updated_at = excluded.updated_at`,
    args: [now, now],
  });
}

export async function getLatestTikTokOrderUpdatedAt() {
  const db = await getTursoClient();
  const result = await db.execute("SELECT MAX(source_updated_at) AS latest FROM orders WHERE source = 'tiktok'");
  return optionalString(result.rows[0]?.latest);
}

export async function recordTikTokWebhook(input: { externalEventId: string; topic: string }) {
  const db = await getTursoClient();
  const now = new Date().toISOString();
  const result = await db.execute({
    sql: `INSERT INTO webhook_events (id, provider, external_event_id, topic, received_at, processed_at, status)
          VALUES (?, 'tiktok', ?, ?, ?, ?, 'processed')
          ON CONFLICT(provider, external_event_id) DO NOTHING`,
    args: [`tiktok:${input.externalEventId}`, input.externalEventId, input.topic, now, now],
  });
  return result.rowsAffected > 0;
}

function shopifyOrderAdminUrl(sourceOrderId: string) {
  const orderId = sourceOrderId.match(/(\d+)$/)?.[1];
  const storeDomain = process.env.SHOPIFY_STORE_DOMAIN?.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!orderId || !storeDomain) return undefined;
  return `https://${storeDomain}/admin/orders/${orderId}`;
}

export async function getInventory(): Promise<InventorySnapshot> {
  const db = await getTursoClient();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [variantsResult, packagingResult, salesResult, alertsResult, movementsResult] = await Promise.all([
    db.execute(`
      SELECT v.id, v.product_id, p.title AS product, v.title AS variant, v.sku, v.available_quantity,
        v.reorder_point, v.lead_time_days, v.packaging_type, v.units_per_box,
        COALESCE((SELECT m.status FROM channel_mappings m WHERE m.variant_id = v.id AND m.channel = 'tiktok' AND m.active = 1 ORDER BY m.last_checked_at DESC LIMIT 1), 'unmapped') AS mapping,
        COALESCE((SELECT m.confidence FROM channel_mappings m WHERE m.variant_id = v.id AND m.channel = 'tiktok' AND m.active = 1 ORDER BY m.last_checked_at DESC LIMIT 1), '') AS mapping_confidence
      FROM variants v
      JOIN products p ON p.id = v.product_id
      ORDER BY p.title, v.title
    `),
    db.execute(`SELECT id, title, quantity, reorder_point, lead_time_days, updated_at FROM packaging_materials ORDER BY title`),
    db.execute({
      sql: `SELECT oi.variant_id,
              SUM(CASE WHEN o.source_created_at >= ? THEN oi.quantity ELSE 0 END) AS sold_7d,
              SUM(oi.quantity) AS sold_30d
            FROM order_items oi
            JOIN orders o ON o.id = oi.order_id
            WHERE o.source_created_at >= ? AND oi.variant_id IS NOT NULL
            GROUP BY oi.variant_id`,
      args: [sevenDaysAgo, thirtyDaysAgo],
    }),
    db.execute(`SELECT id, alert_key, kind, severity, title, detail, first_seen_at, last_seen_at
                FROM inventory_alerts WHERE status = 'active'
                ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, last_seen_at DESC`),
    db.execute(`SELECT sm.id, sm.quantity_delta, sm.reason, sm.source, sm.reference_id, sm.created_at,
                CASE WHEN sm.variant_id IS NOT NULL THEN p.title || CASE WHEN v.title <> 'Default Title' THEN ' — ' || v.title ELSE '' END ELSE pm.title END AS item
                FROM stock_movements sm
                LEFT JOIN variants v ON v.id = sm.variant_id
                LEFT JOIN products p ON p.id = v.product_id
                LEFT JOIN packaging_materials pm ON pm.id = sm.packaging_material_id
                ORDER BY sm.created_at DESC LIMIT 8`),
  ]);

  const soldByVariant = new Map(salesResult.rows.map((row) => [stringValue(row.variant_id), {
    sold7d: numberValue(row.sold_7d),
    sold30d: numberValue(row.sold_30d),
  }]));
  const products: ProductInventory[] = variantsResult.rows.map((row, index) => {
    const quantity = numberValue(row.available_quantity);
    const sales = soldByVariant.get(stringValue(row.id)) ?? { sold7d: 0, sold30d: 0 };
    const dailySalesRate = Math.max(sales.sold7d / 7, sales.sold30d / 30);
    const daysLeft = quantity === 0 ? 0 : dailySalesRate > 0 ? Math.ceil(quantity / dailySalesRate) : null;
    const leadTimeDays = nullableNumber(row.lead_time_days);
    const isLowStock = quantity < 10;
    const reorderNow = quantity === 0 || Boolean(leadTimeDays && daysLeft !== null && daysLeft <= leadTimeDays);
    return {
      id: stringValue(row.id),
      productId: stringValue(row.product_id),
      product: stringValue(row.product),
      variant: stringValue(row.variant),
      sku: stringValue(row.sku),
      quantity,
      sold7d: sales.sold7d,
      sold30d: sales.sold30d,
      dailySalesRate,
      daysLeft,
      leadTime: leadTimeDays ? `${leadTimeDays} days` : "—",
      leadTimeDays,
      packagingType: stringValue(row.packaging_type) || "Not set",
      unitsPerBox: Math.max(1, numberValue(row.units_per_box)),
      onHandBoxes: quantity / Math.max(1, numberValue(row.units_per_box)),
      mapping: toMapping(stringValue(row.mapping)),
      mappingConfidence: stringValue(row.mapping_confidence),
      isLowStock,
      reorderNow,
      imageTone: (["blush", "smoke", "taupe", "amber", "rose"] as const)[index % 5],
    };
  });
  const packaging: PackagingMaterial[] = packagingResult.rows.map((row) => ({
    id: stringValue(row.id),
    title: stringValue(row.title),
    quantity: numberValue(row.quantity),
    reorderPoint: numberValue(row.reorder_point),
    leadTimeDays: nullableNumber(row.lead_time_days),
    updatedBy: "Operations",
    updatedAt: stringValue(row.updated_at),
  }));
  const alerts: InventoryAlert[] = alertsResult.rows.map((row) => ({
    id: stringValue(row.id),
    key: stringValue(row.alert_key),
    kind: stringValue(row.kind) as InventoryAlert["kind"],
    severity: stringValue(row.severity) as InventoryAlert["severity"],
    title: stringValue(row.title),
    detail: stringValue(row.detail),
    firstSeenAt: stringValue(row.first_seen_at),
    lastSeenAt: stringValue(row.last_seen_at),
  }));
  const recentMovements: StockMovement[] = movementsResult.rows.map((row) => ({
    id: stringValue(row.id),
    item: stringValue(row.item) || "Inventory item",
    delta: numberValue(row.quantity_delta),
    reason: stringValue(row.reason),
    source: stringValue(row.source) === "tiktok" ? "tiktok" : stringValue(row.source) === "shopify" ? "shopify" : "manual",
    reference: stringValue(row.reference_id),
    createdAt: stringValue(row.created_at),
  }));

  return { products, packaging, alerts, recentMovements, sync: await getLatestSync() };
}

const LEDGER_TONES = ["blush", "smoke", "taupe", "amber", "rose"] as const;

/** The three-inventory view: master (in-app) + fetched Shopify and TikTok display levels per variant. */
export async function getChannelInventory(): Promise<ChannelInventorySnapshot> {
  const db = await getTursoClient();
  const [variantsResult, masterResult, tiktokResult, syncedResult] = await Promise.all([
    db.execute(`SELECT v.id, v.product_id, p.title AS product, v.title AS variant, v.sku, v.available_quantity, v.lead_time_days, v.packaging_type
                FROM variants v JOIN products p ON p.id = v.product_id ORDER BY p.title, v.title`),
    db.execute(`SELECT variant_id, quantity FROM master_inventory`),
    db.execute(`SELECT variant_id, SUM(available_quantity) AS qty FROM channel_inventory WHERE channel = 'tiktok' AND variant_id IS NOT NULL GROUP BY variant_id`),
    db.execute(`SELECT MAX(synced_at) AS synced_at FROM channel_inventory WHERE channel = 'tiktok'`),
  ]);

  const masterByVariant = new Map(masterResult.rows.map((row) => [stringValue(row.variant_id), numberValue(row.quantity)]));
  const tiktokByVariant = new Map(tiktokResult.rows.map((row) => [stringValue(row.variant_id), numberValue(row.qty)]));

  const rows: ChannelInventoryRow[] = variantsResult.rows.map((row, index) => {
    const variantId = stringValue(row.id);
    const leadTimeDays = nullableNumber(row.lead_time_days);
    return {
      variantId,
      productId: stringValue(row.product_id),
      product: stringValue(row.product),
      variant: stringValue(row.variant),
      sku: stringValue(row.sku),
      imageTone: LEDGER_TONES[index % LEDGER_TONES.length],
      master: masterByVariant.has(variantId) ? masterByVariant.get(variantId)! : null,
      shopify: numberValue(row.available_quantity),
      tiktok: tiktokByVariant.has(variantId) ? tiktokByVariant.get(variantId)! : null,
      leadTime: leadTimeDays ? `${leadTimeDays} days` : "—",
      packagingType: stringValue(row.packaging_type) || "Not set",
    };
  });

  return { rows, tiktokSyncedAt: stringValue(syncedResult.rows[0]?.synced_at) || null, sync: await getLatestSync() };
}

/** Appends one immutable audit-ledger row. Never updates or deletes existing rows. */
export async function recordInventoryLedgerEntry(entry: {
  variantId: string | null;
  inventory: InventoryLedgerEntry["inventory"];
  changeType: InventoryLedgerEntry["changeType"];
  actor: string;
  quantityBefore: number | null;
  quantityAfter: number | null;
  reference?: string;
  result?: "ok" | "failed";
}) {
  const db = await getTursoClient();
  const delta = (entry.quantityAfter ?? 0) - (entry.quantityBefore ?? 0);
  await db.execute({
    sql: `INSERT INTO inventory_ledger (id, variant_id, inventory, change_type, actor, quantity_before, quantity_after, quantity_delta, reference, result, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [crypto.randomUUID(), entry.variantId, entry.inventory, entry.changeType, entry.actor,
      entry.quantityBefore, entry.quantityAfter, delta, entry.reference ?? null, entry.result ?? "ok", new Date().toISOString()],
  });
}

/** Sets the master physical count for a variant (manual anchor) and logs the change. */
export async function setMasterQuantity(input: { variantId: string; quantity: number; actor: string }): Promise<{ before: number | null; after: number }> {
  const db = await getTursoClient();
  const now = new Date().toISOString();
  const quantity = Math.max(0, Math.round(input.quantity));
  const existing = await db.execute({ sql: `SELECT quantity FROM master_inventory WHERE variant_id = ?`, args: [input.variantId] });
  const before = existing.rows[0] ? numberValue(existing.rows[0].quantity) : null;
  await db.execute({
    sql: `INSERT INTO master_inventory (variant_id, quantity, anchored_at, updated_at) VALUES (?, ?, ?, ?)
          ON CONFLICT(variant_id) DO UPDATE SET quantity = excluded.quantity, anchored_at = excluded.anchored_at, updated_at = excluded.updated_at`,
    args: [input.variantId, quantity, now, now],
  });
  await recordInventoryLedgerEntry({ variantId: input.variantId, inventory: "master", changeType: "manual_edit", actor: input.actor, quantityBefore: before, quantityAfter: quantity, reference: "recount" });
  return { before, after: quantity };
}

/** Saves a batch of master edits in one action; each changed variant records one ledger entry. */
export async function setMasterQuantities(input: { updates: { variantId: string; quantity: number }[]; actor: string }): Promise<{ saved: number }> {
  let saved = 0;
  for (const update of input.updates) {
    if (typeof update.variantId !== "string" || !update.variantId.trim()) continue;
    if (!Number.isFinite(update.quantity) || update.quantity < 0) continue;
    await setMasterQuantity({ variantId: update.variantId, quantity: update.quantity, actor: input.actor });
    saved += 1;
  }
  return { saved };
}

export type AlertCandidate = Omit<InventoryAlert, "id" | "firstSeenAt" | "lastSeenAt">;

export function collectInventoryAlertCandidates(snapshot: Pick<InventorySnapshot, "products" | "packaging">): AlertCandidate[] {
  const candidates: AlertCandidate[] = [];
  for (const product of snapshot.products) {
    if (product.reorderNow) {
      const detail = product.daysLeft === 0
        ? "No units are available in Shopify."
        : `${product.daysLeft} days of cover against a ${product.leadTime} supplier lead time.`;
      candidates.push({ key: `reorder:${product.id}`, kind: "reorder", severity: "critical", title: `${product.product} needs reordering`, detail });
    } else if (product.isLowStock) {
      candidates.push({ key: `low-stock:${product.id}`, kind: "low_stock", severity: "warning", title: `${product.product} is below 10 units`, detail: `${product.variant || "Default variant"} has ${product.quantity} units available in Shopify.` });
    }
    if (product.mapping !== "confirmed") {
      candidates.push({ key: `mapping:${product.id}`, kind: "mapping", severity: "info", title: `${product.product} needs a TikTok mapping review`, detail: product.mappingConfidence || "This variant is not confirmed for automated TikTok stock handling." });
    }
  }
  for (const material of snapshot.packaging) {
    if (material.quantity <= material.reorderPoint) {
      const severity = material.quantity === 0 ? "critical" : "warning";
      candidates.push({ key: `packaging:${material.id}`, kind: "packaging", severity, title: `${material.title} packaging ${material.quantity === 0 ? "is empty" : "is low"}`, detail: material.leadTimeDays ? `${material.quantity} units on hand · ${material.leadTimeDays}-day lead time.` : `${material.quantity} units on hand.` });
    }
  }
  return candidates;
}

export async function reconcileInventoryAlerts() {
  const snapshot = await getInventory();
  const candidates = collectInventoryAlertCandidates(snapshot);
  const db = await getTursoClient();
  const now = new Date().toISOString();

  for (const candidate of candidates) {
    await db.execute({
      sql: `INSERT INTO inventory_alerts (id, alert_key, kind, severity, title, detail, status, first_seen_at, last_seen_at, resolved_at)
            VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, NULL)
            ON CONFLICT(alert_key) DO UPDATE SET kind = excluded.kind, severity = excluded.severity, title = excluded.title,
              detail = excluded.detail, status = 'active', last_seen_at = excluded.last_seen_at, resolved_at = NULL`,
      args: [crypto.randomUUID(), candidate.key, candidate.kind, candidate.severity, candidate.title, candidate.detail, now, now],
    });
  }

  if (candidates.length === 0) {
    await db.execute({ sql: "UPDATE inventory_alerts SET status = 'resolved', resolved_at = ? WHERE status = 'active'", args: [now] });
  } else {
    const placeholders = candidates.map(() => "?").join(", ");
    await db.execute({
      sql: `UPDATE inventory_alerts SET status = 'resolved', resolved_at = ? WHERE status = 'active' AND alert_key NOT IN (${placeholders})`,
      args: [now, ...candidates.map((candidate) => candidate.key)],
    });
  }
  return candidates.length;
}

export async function getLatestSync(): Promise<SyncSnapshot> {
  const db = await getTursoClient();
  const [result, tiktokConnection] = await Promise.all([
    db.execute(`
      SELECT status, finished_at, message, provider FROM sync_runs
      ORDER BY started_at DESC LIMIT 1
    `),
    db.execute("SELECT 1 FROM tiktok_connections WHERE status = 'active' LIMIT 1"),
  ]);
  const row = result.rows[0];
  if (!row) return setupRequiredSync();
  const succeeded = stringValue(row.status) === "succeeded";
  const provider = stringValue(row.provider);
  const liveChannels = !succeeded ? 0 : provider === "direct"
    ? 1 + (tiktokConnection.rows.length > 0 ? 1 : 0)
    : 1;
  return {
    lastSyncedAt: stringValue(row.finished_at) || new Date().toISOString(),
    status: succeeded ? "healthy" : "attention",
    message: stringValue(row.message) || "Direct channel sync complete",
    liveChannels,
  };
}

function setupRequiredSync(): SyncSnapshot {
  return { status: "attention", message: "Local database is ready — sync Shopify to import data", liveChannels: 0 };
}

export async function recordSyncRun(input: {
  id: string;
  trigger: "manual" | "scheduled" | "webhook";
  status: "running" | "succeeded" | "failed" | "skipped";
  message: string;
  recordsSeen?: number;
  recordsChanged?: number;
  finished?: boolean;
  provider?: "direct" | "shopify" | "tiktok";
}) {
  const db = await getTursoClient();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO sync_runs (id, trigger, provider, status, started_at, finished_at, records_seen, records_changed, message)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET status = excluded.status, finished_at = excluded.finished_at,
            records_seen = excluded.records_seen, records_changed = excluded.records_changed, message = excluded.message`,
    args: [input.id, input.trigger, input.provider ?? "direct", input.status, now, input.finished ? now : null, input.recordsSeen ?? 0, input.recordsChanged ?? 0, input.message] as SqlValue[],
  });
}

export async function takeSyncLease(ownerId: string, durationSeconds = 240) {
  const db = await getTursoClient();
  const lockedUntil = new Date(Date.now() + durationSeconds * 1000).toISOString();
  const now = new Date().toISOString();
  const result = await db.execute({
    sql: `INSERT INTO sync_leases (name, locked_until, owner_id) VALUES ('direct-channel-sync', ?, ?)
          ON CONFLICT(name) DO UPDATE SET locked_until = excluded.locked_until, owner_id = excluded.owner_id
          WHERE sync_leases.locked_until < ?
          RETURNING owner_id`,
    args: [lockedUntil, ownerId, now],
  });
  return result.rows.length > 0;
}

export async function releaseSyncLease(ownerId: string) {
  const db = await getTursoClient();
  await db.execute({ sql: "DELETE FROM sync_leases WHERE name = 'direct-channel-sync' AND owner_id = ?", args: [ownerId] });
}
