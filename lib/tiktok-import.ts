import "server-only";

import {
  advanceTikTokSyncCursor,
  getActiveTikTokConnections,
  getTikTokSyncCursor,
  updateTikTokConnectionShop,
  updateTikTokConnectionTokens,
} from "@/lib/repository";
import { getTursoClient } from "@/lib/turso";
import { hasTikTokApiCredentials, refreshTikTokAccessToken, tiktokApiRequest } from "@/lib/tiktok";

type UnknownRecord = Record<string, unknown>;

type TikTokShop = {
  id: string;
  cipher: string;
};

type TikTokOrderSearchResult = {
  orders: UnknownRecord[];
  nextPageToken?: string;
};

type SqlStatement = {
  sql: string;
  args: (string | number | null)[];
};

export type TikTokRedactedSample = {
  orderId: "[redacted]";
  customer: "[redacted]";
  lineItems: number;
  hasShippingAddress: boolean;
  hasEmail: boolean;
};

export type TikTokImportResult = {
  orders: number;
  shops: number;
  baselineOrders: number;
  newOrders: number;
  materiallyChangedOrders: number;
  redactedSample?: TikTokRedactedSample;
  afterSales: number;
  afterSalesWarning?: string;
};

export class TikTokNotConnectedError extends Error {
  constructor() {
    super("TikTok Shop is awaiting seller authorization");
  }
}

function record(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : undefined;
}

function records(value: unknown): UnknownRecord[] {
  return Array.isArray(value) ? value.flatMap((item) => record(item) ? [record(item)!] : []) : [];
}

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function number(value: unknown) {
  const candidate = typeof value === "string" ? Number.parseFloat(value) : value;
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : 0;
}

function positiveInteger(value: unknown) {
  return Math.max(1, Math.round(number(value) || 1));
}

function cents(value: unknown) {
  const object = record(value);
  const amount = object ? object.amount ?? object.value ?? object.total_amount : value;
  return Math.round(number(amount) * 100);
}

function timestamp(value: unknown) {
  if (typeof value === "string" && !/^\d+(?:\.\d+)?$/.test(value.trim())) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  const epoch = number(value);
  if (epoch > 0) return new Date((epoch > 1_000_000_000_000 ? epoch : epoch * 1000)).toISOString();
  return new Date().toISOString();
}

function shippingAddress(order: UnknownRecord) {
  const address = record(order.recipient_address) ?? record(order.shipping_address);
  if (!address) return [];
  const districtInfo = records(address.district_info_list).map((district) => text(district.address_name));
  return [...new Set([
    text(address.name),
    text(address.full_address),
    text(address.address_detail),
    ...districtInfo,
    text(address.postal_code),
    text(address.region_code),
  ].filter(Boolean))];
}

function financialStatus(order: UnknownRecord) {
  const status = text(order.status ?? order.order_status).toUpperCase();
  const payment = record(order.payment);
  const paymentStatus = text(payment?.status ?? order.payment_status).toUpperCase();
  if (status.includes("CANCEL") || status.includes("REFUND") || paymentStatus.includes("REFUND")) return "refunded";
  if (status.includes("UNPAID") || paymentStatus.includes("UNPAID") || paymentStatus.includes("PENDING")) return "pending";
  return "paid";
}

function fulfillmentStatus(order: UnknownRecord) {
  const status = text(order.status ?? order.order_status).toUpperCase();
  if (status.includes("CANCEL")) return "cancelled";
  if (status.includes("DELIVERED") || status.includes("COMPLETED")) return "fulfilled";
  if (status.includes("IN_TRANSIT") || status.includes("COLLECTION") || status.includes("PARTIAL")) return "partial";
  return "unfulfilled";
}

function cancelledAt(order: UnknownRecord) {
  const status = text(order.status ?? order.order_status).toUpperCase();
  return status.includes("CANCEL") ? timestamp(order.update_time ?? order.updated_at ?? order.cancel_time) : null;
}

function extractShops(value: unknown): TikTokShop[] {
  const data = record(value);
  return records(data?.shops ?? data?.shop_list).flatMap((shop) => {
    const id = text(shop.id ?? shop.shop_id);
    const cipher = text(shop.cipher ?? shop.shop_cipher);
    return id && cipher ? [{ id, cipher }] : [];
  });
}

function extractOrderSearchResult(value: unknown): TikTokOrderSearchResult {
  const data = record(value);
  return {
    orders: records(data?.orders ?? data?.order_list),
    nextPageToken: text(data?.next_page_token ?? data?.nextPageToken ?? data?.page_token) || undefined,
  };
}

function orderId(value: UnknownRecord) {
  return text(value.id ?? value.order_id);
}

function expiresSoon(value: string | undefined) {
  if (!value) return false;
  const expiry = Date.parse(value);
  return Number.isFinite(expiry) && expiry <= Date.now() + 5 * 60 * 1000;
}

async function authorizedShops(accessToken: string) {
  const data = await tiktokApiRequest<unknown>({
    path: "/authorization/202309/shops",
    method: "GET",
    accessToken,
  });
  return extractShops(data);
}

async function searchOrderRecords(input: { accessToken: string; shopCipher: string; updatedAfter?: string }) {
  const orders: UnknownRecord[] = [];
  const seenPageTokens = new Set<string>();
  let pageToken: string | undefined;
  for (let page = 0; page < 100; page += 1) {
    const body: Record<string, number> = {};
    if (input.updatedAfter) {
      const cutoff = Date.parse(input.updatedAfter) - 2 * 60 * 60 * 1000;
      if (Number.isFinite(cutoff)) body.update_time_ge = Math.max(0, Math.floor(cutoff / 1000));
    }
    const data = await tiktokApiRequest<unknown>({
      path: "/order/202309/orders/search",
      method: "POST",
      accessToken: input.accessToken,
      query: {
        shop_cipher: input.shopCipher,
        page_size: 50,
        page_token: pageToken,
        sort_field: "update_time",
        sort_order: "DESC",
      },
      body,
    });
    const result = extractOrderSearchResult(data);
    orders.push(...result.orders);
    if (!result.nextPageToken || seenPageTokens.has(result.nextPageToken)) break;
    seenPageTokens.add(result.nextPageToken);
    pageToken = result.nextPageToken;
  }
  return orders;
}

async function getOrderDetails(input: { accessToken: string; shopCipher: string; orderIds: string[] }) {
  const details: UnknownRecord[] = [];
  for (let index = 0; index < input.orderIds.length; index += 50) {
    const ids = input.orderIds.slice(index, index + 50);
    const data = await tiktokApiRequest<unknown>({
      path: "/order/202309/orders",
      method: "GET",
      accessToken: input.accessToken,
      query: { shop_cipher: input.shopCipher, ids: ids.join(",") },
    });
    const response = record(data);
    details.push(...records(response?.orders ?? response?.order_list));
  }
  return details;
}

function buildOrderStatements(order: UnknownRecord, initialBackfill: boolean, shopId: string): SqlStatement[] | undefined {
  const sourceOrderId = orderId(order);
  if (!sourceOrderId) return undefined;

  const address = record(order.recipient_address) ?? record(order.shipping_address);
  const payment = record(order.payment);
  const lines = records(order.line_items ?? order.order_line_list ?? order.items);
  const now = new Date().toISOString();
  const id = `tiktok:${sourceOrderId}`;
  const customerName = text(address?.name ?? order.buyer_name ?? order.customer_name) || "Guest customer";
  const customerPhone = text(address?.phone_number ?? address?.phone ?? order.buyer_phone);
  const total = cents(payment?.total_amount ?? order.total_amount);
  const subtotal = cents(payment?.sub_total ?? payment?.subtotal_amount ?? order.subtotal_amount);
  const shipping = cents(payment?.shipping_fee ?? order.shipping_fee);
  const tax = cents(payment?.tax ?? payment?.tax_amount ?? order.tax_amount);
  const currency = text(payment?.currency ?? order.currency) || "GBP";
  const statements: SqlStatement[] = [{
    sql: `INSERT INTO orders (id, source, source_order_id, order_number, customer_name, customer_email, customer_phone,
                              shipping_address_json, currency, total_amount, subtotal_amount, shipping_amount, tax_amount,
                              financial_status, fulfillment_status, cancelled_at, source_shop_id, source_created_at, source_updated_at, imported_at)
          VALUES (?, 'tiktok', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(source, source_order_id) DO UPDATE SET order_number = excluded.order_number,
            customer_name = excluded.customer_name, customer_email = excluded.customer_email, customer_phone = excluded.customer_phone,
            shipping_address_json = excluded.shipping_address_json, currency = excluded.currency, total_amount = excluded.total_amount,
            subtotal_amount = excluded.subtotal_amount, shipping_amount = excluded.shipping_amount, tax_amount = excluded.tax_amount,
            financial_status = excluded.financial_status, fulfillment_status = excluded.fulfillment_status,
            cancelled_at = excluded.cancelled_at, source_shop_id = excluded.source_shop_id,
            source_updated_at = excluded.source_updated_at, imported_at = excluded.imported_at`,
    args: [
      id,
      sourceOrderId,
      text(order.order_number ?? order.display_id ?? order.id) || sourceOrderId,
      customerName,
      text(order.buyer_email ?? order.customer_email) || null,
      customerPhone || null,
      JSON.stringify(shippingAddress(order)),
      currency,
      total,
      subtotal,
      shipping,
      tax,
      financialStatus(order),
      fulfillmentStatus(order),
      cancelledAt(order),
      shopId,
      timestamp(order.create_time ?? order.created_at),
      timestamp(order.update_time ?? order.updated_at),
      now,
    ],
  }];

  // Do not erase a previously imported line-item set if TikTok ever returns a
  // sparse order object during a transient API response.
  if (lines.length > 0) {
    statements.push({ sql: "DELETE FROM order_items WHERE order_id = ?", args: [id] });
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const externalLineId = text(line.id ?? line.order_line_id) || `${sourceOrderId}:${index}`;
      const externalVariantId = text(line.sku_id ?? line.variant_id);
      const externalProductId = text(line.product_id);
      statements.push({
        sql: `INSERT INTO order_items
              (id, order_id, variant_id, source_line_item_id, source_product_id, source_variant_id,
               title, variant_title, sku, quantity, unit_price_amount, image_url)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          `tiktok:${sourceOrderId}:line:${externalLineId}`,
          id,
          null,
          externalLineId,
          externalProductId || null,
          externalVariantId || null,
          text(line.product_name ?? line.product_title ?? line.title) || "TikTok Shop item",
          text(line.sku_name ?? line.variant_title ?? line.sku_title) || null,
          text(line.seller_sku ?? line.sku_id ?? line.sku) || null,
          positiveInteger(line.quantity ?? line.sku_quantity),
          cents(line.sale_price ?? line.original_price ?? line.unit_price),
          text(line.sku_image ?? line.image_url ?? line.image) || null,
        ],
      });
    }
  }

  if (initialBackfill) {
    statements.push({
      sql: `INSERT OR IGNORE INTO inventory_order_applications
            (order_id, stock_recorded_at, packaging_applied_at, state, notes, created_at, updated_at)
            VALUES (?, ?, ?, 'baseline', 'Imported during the initial TikTok Shop history backfill', ?, ?)`,
      args: [id, now, now, now, now],
    });
  }
  return statements;
}

type TikTokAfterSalesType = "cancel" | "return";

function afterSalesEvents(value: unknown, eventType: TikTokAfterSalesType) {
  const data = record(value);
  const keys = eventType === "cancel"
    ? ["cancellations", "cancellation_list", "cancel_orders", "cancel_order_list"]
    : ["returns", "return_orders", "return_list", "return_order_list"];
  return keys.flatMap((key) => records(data?.[key]));
}

function afterSalesLines(event: UnknownRecord) {
  const candidates = [
    ...records(event.return_line_items),
    ...records(event.return_order_line_items),
    ...records(event.sku_return_requests),
    ...records(event.order_line_items),
    ...records(event.order_line_list),
    ...records(event.order_line_item_list),
    ...records(event.skus),
    ...records(event.sku_list),
    ...records(event.line_items),
  ];
  if (candidates.length > 0) return candidates;
  if (event.order_line_item_id || event.order_line_id || event.sku_id) return [event];
  return [];
}

function afterSalesStatus(event: UnknownRecord, eventType: TikTokAfterSalesType) {
  return text(event[eventType === "cancel" ? "cancel_status" : "return_status"] ?? event.status).toUpperCase();
}

function afterSalesSourceUpdatedAt(event: UnknownRecord) {
  return timestamp(event.update_time ?? event.updated_at ?? event.create_time ?? event.created_at);
}

function afterSalesLineId(line: UnknownRecord) {
  return text(line.order_line_item_id ?? line.order_line_id ?? line.line_item_id ?? line.id);
}

function afterSalesVariantId(line: UnknownRecord) {
  return text(line.sku_id ?? line.variant_id);
}

function afterSalesLineQuantity(line: UnknownRecord) {
  return Math.max(0, Math.round(number(line.quantity ?? line.cancel_quantity ?? line.return_quantity ?? line.sku_quantity)));
}

async function searchTikTokAfterSales(input: {
  accessToken: string;
  shopCipher: string;
  eventType: TikTokAfterSalesType;
  updatedAfter?: string;
}) {
  const events: UnknownRecord[] = [];
  const seenPageTokens = new Set<string>();
  let pageToken: string | undefined;
  const path = input.eventType === "cancel"
    ? "/return_refund/202602/cancellations/search"
    : "/return_refund/202602/returns/search";

  for (let page = 0; page < 100; page += 1) {
    const body: Record<string, number> = {};
    if (input.updatedAfter) {
      const cutoff = Date.parse(input.updatedAfter) - 2 * 60 * 60 * 1000;
      if (Number.isFinite(cutoff)) body.update_time_ge = Math.max(0, Math.floor(cutoff / 1000));
    }
    const data = await tiktokApiRequest<unknown>({
      path,
      method: "POST",
      accessToken: input.accessToken,
      query: {
        shop_cipher: input.shopCipher,
        page_size: 50,
        page_token: pageToken,
        sort_field: "update_time",
        sort_order: "DESC",
      },
      body,
    });
    events.push(...afterSalesEvents(data, input.eventType));
    const response = record(data);
    const nextPageToken = text(response?.next_page_token ?? response?.page_token) || undefined;
    if (!nextPageToken || seenPageTokens.has(nextPageToken)) break;
    seenPageTokens.add(nextPageToken);
    pageToken = nextPageToken;
  }
  return events;
}

async function storeTikTokAfterSalesRecords(input: {
  db: Awaited<ReturnType<typeof getTursoClient>>;
  events: UnknownRecord[];
  eventType: TikTokAfterSalesType;
}) {
  let stored = 0;
  for (const event of input.events) {
    const orderSourceId = text(event.order_id ?? event.orderId);
    const eventId = text(event[input.eventType === "cancel" ? "cancel_id" : "return_id"] ?? event.id);
    const status = afterSalesStatus(event, input.eventType);
    if (!orderSourceId || !eventId || !status) continue;
    const order = await input.db.execute({
      sql: "SELECT id FROM orders WHERE source='tiktok' AND source_order_id=? LIMIT 1",
      args: [orderSourceId],
    });
    if (!order.rows[0]) continue;
    const orderId = text(order.rows[0].id);
    const returnType = input.eventType === "return" ? text(event.return_type ?? event.type).toUpperCase() || null : null;
    const sourceUpdatedAt = afterSalesSourceUpdatedAt(event);
    for (const line of afterSalesLines(event)) {
      let sourceLineItemId = afterSalesLineId(line);
      const sourceVariantId = afterSalesVariantId(line);
      const quantity = afterSalesLineQuantity(line);
      if (!sourceLineItemId && sourceVariantId) {
        // A SKU can legitimately occur multiple times in an order. Fall back
        // only when it resolves to exactly one imported line, never all lines.
        const matchingLines = await input.db.execute({
          sql: `SELECT source_line_item_id FROM order_items
                WHERE order_id = ? AND source_variant_id = ? AND source_line_item_id IS NOT NULL
                LIMIT 2`,
          args: [orderId, sourceVariantId],
        });
        if (matchingLines.rows.length === 1) sourceLineItemId = text(matchingLines.rows[0].source_line_item_id);
      }
      if (!sourceLineItemId || quantity <= 0) continue;
      await input.db.execute({
        sql: `INSERT INTO tiktok_after_sales_line_items
              (id, event_type, event_id, order_id, source_line_item_id, source_variant_id, quantity, status, return_type, source_updated_at, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(event_type, event_id, source_line_item_id) DO UPDATE SET
                quantity=excluded.quantity, status=excluded.status, return_type=excluded.return_type,
                source_variant_id=excluded.source_variant_id, source_updated_at=excluded.source_updated_at,
                updated_at=excluded.updated_at`,
        args: [
          `tiktok:${input.eventType}:${eventId}:${sourceLineItemId}`,
          input.eventType,
          eventId,
          orderId,
          sourceLineItemId,
          sourceVariantId || null,
          quantity,
          status,
          returnType,
          sourceUpdatedAt,
          new Date().toISOString(),
          new Date().toISOString(),
        ],
      });
      stored += 1;
    }
  }
  return stored;
}

function latestUpdatedAt(recordsToInspect: UnknownRecord[]) {
  let latest: string | undefined;
  for (const item of recordsToInspect) {
    const raw = item.update_time ?? item.updated_at ?? item.create_time ?? item.created_at;
    if (raw === undefined || raw === null || raw === "") continue;
    const candidate = timestamp(raw);
    if (!latest || candidate > latest) latest = candidate;
  }
  return latest;
}

async function importTikTokAfterSalesForShop(input: {
  connectionId: string;
  shopId: string;
  shopCipher: string;
  accessToken: string;
  grantedScopes: string[];
  db: Awaited<ReturnType<typeof getTursoClient>>;
}) {
  let stored = 0;
  const warnings: string[] = [];
  if (input.grantedScopes.length > 0 && !input.grantedScopes.includes("seller.return_refund.basic")) {
    return { stored, warning: "seller.return_refund.basic scope is not granted" };
  }
  for (const eventType of ["cancel", "return"] as const) {
    const stream = eventType === "cancel" ? "after_sales_cancel" : "after_sales_return";
    try {
      const cursor = await getTikTokSyncCursor({ connectionId: input.connectionId, shopId: input.shopId, stream });
      const events = await searchTikTokAfterSales({
        accessToken: input.accessToken,
        shopCipher: input.shopCipher,
        eventType,
        updatedAfter: cursor ?? undefined,
      });
      stored += await storeTikTokAfterSalesRecords({ db: input.db, events, eventType });
      await advanceTikTokSyncCursor({
        connectionId: input.connectionId,
        shopId: input.shopId,
        stream,
        cursorAt: latestUpdatedAt(events) ?? new Date().toISOString(),
      });
    } catch {
      warnings.push(`TikTok ${eventType === "cancel" ? "cancellation" : "return"} status sync needs attention`);
    }
  }
  return { stored, warning: warnings.length > 0 ? [...new Set(warnings)].join("; ") : undefined };
}

/** Imports the seller's authorized TikTok Shop orders into the shared order model. */
export async function importTikTokOrders(): Promise<TikTokImportResult> {
  if (!hasTikTokApiCredentials()) throw new TikTokNotConnectedError();
  const connections = await getActiveTikTokConnections();
  if (connections.length === 0) throw new TikTokNotConnectedError();

  const importedOrderIds = new Set<string>();
  const db = await getTursoClient();
  const existingOrders = await db.execute("SELECT source_order_id, source_updated_at FROM orders WHERE source = 'tiktok'");
  const existingOrderUpdatedAt = new Map(existingOrders.rows.map((row) => [text(row.source_order_id), text(row.source_updated_at)]));
  let shopsImported = 0;
  let baselineOrders = 0;
  let newOrders = 0;
  let materiallyChangedOrders = 0;
  let afterSales = 0;
  const afterSalesWarnings: string[] = [];
  const importedShopIds = new Set<string>();
  let lastError: unknown;
  let redactedSample: TikTokRedactedSample | undefined;

  for (const connection of connections) {
    try {
      let accessToken = connection.accessToken;
      if (expiresSoon(connection.accessTokenExpiresAt)) {
        const tokens = await refreshTikTokAccessToken(connection.refreshToken);
        accessToken = tokens.accessToken;
        await updateTikTokConnectionTokens({ id: connection.id, ...tokens });
      }
      const shops = await authorizedShops(accessToken);
      for (const shop of shops) {
        if (importedShopIds.has(shop.id)) continue;
        importedShopIds.add(shop.id);
        shopsImported += 1;
        if (!connection.shopId || connection.shopId === shop.id || !connection.shopCipher) {
          await updateTikTokConnectionShop({ id: connection.id, shopId: shop.id, shopCipher: shop.cipher });
        }
        const cursor = await getTikTokSyncCursor({ connectionId: connection.id, shopId: shop.id, stream: "orders" });
        const initialBackfill = !cursor;
        const searchResults = await searchOrderRecords({ accessToken, shopCipher: shop.cipher, updatedAfter: cursor ?? undefined });
        const ids = [...new Set(searchResults.map(orderId).filter(Boolean))];
        const details = ids.length > 0 ? await getOrderDetails({ accessToken, shopCipher: shop.cipher, orderIds: ids }) : [];
        const completeOrders = details.length > 0 ? details : searchResults;
        let pendingStatements: SqlStatement[] = [];
        for (const order of completeOrders) {
          const sourceOrderId = orderId(order);
          const previousUpdatedAt = existingOrderUpdatedAt.get(sourceOrderId);
          const currentUpdatedAt = timestamp(order.update_time ?? order.updated_at);
          if (!previousUpdatedAt) newOrders += 1;
          else if (previousUpdatedAt !== currentUpdatedAt) materiallyChangedOrders += 1;
          const statements = buildOrderStatements(order, initialBackfill, shop.id);
          if (!statements) continue;
          if (!redactedSample) {
            redactedSample = {
              orderId: "[redacted]",
              customer: "[redacted]",
              lineItems: records(order.line_items ?? order.order_line_list ?? order.items).length,
              hasShippingAddress: shippingAddress(order).length > 0,
              hasEmail: Boolean(text(order.buyer_email ?? order.customer_email)),
            };
          }
          pendingStatements.push(...statements);
          importedOrderIds.add(orderId(order));
          if (initialBackfill) baselineOrders += 1;
          if (pendingStatements.length >= 250) {
            await db.batch(pendingStatements, "write");
            pendingStatements = [];
          }
        }
        if (pendingStatements.length > 0) await db.batch(pendingStatements, "write");
        await advanceTikTokSyncCursor({
          connectionId: connection.id,
          shopId: shop.id,
          stream: "orders",
          cursorAt: latestUpdatedAt(completeOrders) ?? latestUpdatedAt(searchResults) ?? new Date().toISOString(),
        });
        const afterSalesResult = await importTikTokAfterSalesForShop({
          connectionId: connection.id,
          shopId: shop.id,
          shopCipher: shop.cipher,
          accessToken,
          grantedScopes: connection.grantedScopes,
          db,
        });
        afterSales += afterSalesResult.stored;
        if (afterSalesResult.warning) afterSalesWarnings.push(afterSalesResult.warning);
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (shopsImported === 0 && lastError) throw lastError;
  if (shopsImported === 0) throw new Error("TikTok Shop returned no authorized shops for this connection");
  return {
    orders: importedOrderIds.size,
    shops: shopsImported,
    baselineOrders,
    newOrders,
    materiallyChangedOrders,
    redactedSample,
    afterSales,
    afterSalesWarning: afterSalesWarnings.length ? [...new Set(afterSalesWarnings)].join("; ") : undefined,
  };
}
