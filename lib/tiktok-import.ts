import "server-only";

import {
  getActiveTikTokConnections,
  getLatestTikTokOrderUpdatedAt,
  hasImportedTikTokOrders,
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

export type TikTokImportResult = {
  orders: number;
  shops: number;
  baselineOrders: number;
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
  if (status.includes("DELIVERED") || status.includes("COMPLETED")) return "fulfilled";
  if (status.includes("IN_TRANSIT") || status.includes("COLLECTION") || status.includes("PARTIAL")) return "partial";
  return "unfulfilled";
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
        page_size: 100,
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

async function confirmedVariantId(input: { externalVariantId: string; externalProductId: string }) {
  const db = await getTursoClient();
  if (input.externalVariantId) {
    const mapped = await db.execute({
      sql: `SELECT variant_id FROM channel_mappings
            WHERE channel = 'tiktok' AND active = 1 AND status = 'confirmed' AND multiplier = 1 AND external_variant_id = ?
            LIMIT 2`,
      args: [input.externalVariantId],
    });
    if (mapped.rows.length === 1) return text(mapped.rows[0].variant_id) || null;
  }
  if (input.externalProductId) {
    const mapped = await db.execute({
      sql: `SELECT variant_id FROM channel_mappings
            WHERE channel = 'tiktok' AND active = 1 AND status = 'confirmed' AND multiplier = 1 AND external_product_id = ?
            LIMIT 2`,
      args: [input.externalProductId],
    });
    if (mapped.rows.length === 1) return text(mapped.rows[0].variant_id) || null;
  }
  return null;
}

async function upsertOrder(order: UnknownRecord, initialBackfill: boolean) {
  const sourceOrderId = orderId(order);
  if (!sourceOrderId) return false;

  const db = await getTursoClient();
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
  const statements: { sql: string; args: (string | number | null)[] }[] = [{
    sql: `INSERT INTO orders (id, source, source_order_id, order_number, customer_name, customer_email, customer_phone,
                              shipping_address_json, currency, total_amount, subtotal_amount, shipping_amount, tax_amount,
                              financial_status, fulfillment_status, source_created_at, source_updated_at, imported_at)
          VALUES (?, 'tiktok', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(source, source_order_id) DO UPDATE SET order_number = excluded.order_number,
            customer_name = excluded.customer_name, customer_email = excluded.customer_email, customer_phone = excluded.customer_phone,
            shipping_address_json = excluded.shipping_address_json, currency = excluded.currency, total_amount = excluded.total_amount,
            subtotal_amount = excluded.subtotal_amount, shipping_amount = excluded.shipping_amount, tax_amount = excluded.tax_amount,
            financial_status = excluded.financial_status, fulfillment_status = excluded.fulfillment_status,
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
      const variantId = await confirmedVariantId({ externalVariantId, externalProductId });
      statements.push({
        sql: `INSERT INTO order_items (id, order_id, variant_id, source_line_item_id, title, variant_title, sku, quantity, unit_price_amount, image_url)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          `tiktok:${sourceOrderId}:line:${externalLineId}`,
          id,
          variantId,
          externalLineId,
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
  await db.batch(statements, "write");
  return true;
}

/** Imports the seller's authorized TikTok Shop orders into the shared order model. */
export async function importTikTokOrders(): Promise<TikTokImportResult> {
  if (!hasTikTokApiCredentials()) throw new TikTokNotConnectedError();
  const connections = await getActiveTikTokConnections();
  if (connections.length === 0) throw new TikTokNotConnectedError();

  const initialBackfill = !(await hasImportedTikTokOrders());
  const updatedAfter = initialBackfill ? undefined : await getLatestTikTokOrderUpdatedAt();
  const importedOrderIds = new Set<string>();
  let shopsImported = 0;
  let lastError: unknown;

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
        shopsImported += 1;
        if (!connection.shopId || connection.shopId === shop.id || !connection.shopCipher) {
          await updateTikTokConnectionShop({ id: connection.id, shopId: shop.id, shopCipher: shop.cipher });
        }
        const searchResults = await searchOrderRecords({ accessToken, shopCipher: shop.cipher, updatedAfter });
        const ids = [...new Set(searchResults.map(orderId).filter(Boolean))];
        const details = ids.length > 0 ? await getOrderDetails({ accessToken, shopCipher: shop.cipher, orderIds: ids }) : [];
        const completeOrders = details.length > 0 ? details : searchResults;
        for (const order of completeOrders) {
          if (await upsertOrder(order, initialBackfill)) importedOrderIds.add(orderId(order));
        }
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (shopsImported === 0 && lastError) throw lastError;
  if (shopsImported === 0) throw new Error("TikTok Shop returned no authorized shops for this connection");
  return { orders: importedOrderIds.size, shops: shopsImported, baselineOrders: initialBackfill ? importedOrderIds.size : 0 };
}
