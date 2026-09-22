import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { revalidatePath, revalidateTag } from "next/cache";
import { getTursoClient } from "@/lib/turso";
import { decryptTikTokToken, encryptTikTokToken } from "@/lib/tiktok-token-crypto";
import { hasTikTokAdsAppCredentials, type TikTokAdsTokenBundle } from "@/lib/tiktok-ads";
import { tiktokShopProductUrl } from "@/lib/tiktok-links";
import { hashPassword } from "better-auth/crypto";
import type { Channel, ChannelInventoryRow, ChannelInventorySnapshot, Customer, Employee, InventoryAlert, InventoryLedgerEntry, InventorySnapshot, LabBatch, LabBatchDetail, LabFormula, LabFormulaLine, LabFormulaOutput, LabIngredient, LabQuantityUnit, Order, OrdersPageResult, PackagingMaterial, Parcel2GoDelivery, Parcel2GoMatchMethod, Parcel2GoShipmentOption, PhysicalChannel, PhysicalChannelListing, PhysicalInventoryAdjustment, PhysicalInventoryItem, PhysicalInventoryRunway, PhysicalInventoryRunways, PhysicalListingMappingStatus, PhysicalProductDetail, ProductDetail, ProductInventory, ProductDetailVariant, StockMovement, SyncSnapshot } from "@/lib/types";
import type { OrdersQuery } from "@/lib/orders-query";
import { LAB_FORMULAS } from "@/lib/labs-formulas";
import { buildKpiDashboard, type KpiCustomerOrder, type KpiDashboard, type KpiPeriod, type KpiRestockDemandLine, type KpiRestockVariant, type KpiSale } from "@/lib/kpi-dashboard";
import { buildTikTokAffiliateDashboard, type TikTokAffiliateDashboard } from "@/lib/tiktok-affiliate-dashboard";
import {
  buildKpiProductComparison,
  buildTikTokAffiliateComparison,
  comparisonDateRange,
  type ComparisonSpec,
  type KpiProductComparison,
  type TikTokAffiliateComparison,
} from "@/lib/kpi-comparisons";
import { changedColumns } from "@/lib/sql-upsert";
import { addPackagingIncrement, calculateBatchAllocation, packagedUnits, planIngredientDeduction } from "@/lib/lab-production";

type SqlValue = string | number | null;
type DatabaseClient = Awaited<ReturnType<typeof getTursoClient>>;

const changed = changedColumns;

/** How much scheduled-sync bookkeeping to keep. Nothing reads beyond this. */
const SYNC_RUN_RETENTION_DAYS = 30;
const KPI_REPORTING_CACHE_TAG = "serenity-hue:kpi-reporting";

function invalidateKpiReportingCache() {
  revalidateTag(KPI_REPORTING_CACHE_TAG, "max");
  revalidatePath("/kpis");
}

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

function toFulfillment(value: string, cancelledAt: string): Order["fulfillment"] {
  if (cancelledAt) return "cancelled";
  return value === "fulfilled" || value === "partial" ? value : "unfulfilled";
}

function toPayment(value: string): Order["payment"] {
  return value === "refunded" || value === "pending" ? value : "paid";
}

function toInventoryChannel(value: string): InventoryLedgerEntry["inventory"] {
  return value === "shopify" || value === "tiktok" ? value : "master";
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
    sql: `SELECT id, order_id, external_order_line_id, source_references_json, courier, service, status, paid_at, collection_date, estimated_delivery_at, tracking_url, match_method
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
      sourceReferences: stringArray(shipment.source_references_json),
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

const ORDERS_BASE_COLUMNS = `o.id, o.source, o.source_order_id, o.order_number, o.customer_name, o.customer_email,
  o.customer_phone, o.shipping_address_json, o.financial_status, o.fulfillment_status, o.cancelled_at,
  o.source_created_at, o.subtotal_amount, o.shipping_amount, o.tax_amount, o.total_amount`;

type QueryRows = Awaited<ReturnType<DatabaseClient["execute"]>>["rows"];

/** Escapes LIKE wildcards so a user-typed % or _ matches literally (ESCAPE '\'). */
function escapeLike(term: string) {
  return term.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/**
 * Builds the shared WHERE clause for the Orders list. This mirrors the previous
 * in-browser filter exactly: substring search over order number, customer,
 * email and line-item title/SKU; channel; fulfilment (same cancelled / partial /
 * fulfilled / unfulfilled derivation as the UI); and a rolling date window.
 */
function buildOrdersFilter(query: OrdersQuery): { where: string; args: SqlValue[] } {
  const clauses: string[] = [];
  const args: SqlValue[] = [];

  const text = query.q.trim().toLowerCase();
  if (text) {
    const terms = text.match(/[\p{L}\p{N}]+/gu) ?? [];
    if (terms.length) {
      clauses.push("o.rowid IN (SELECT rowid FROM order_search WHERE order_search MATCH ?)");
      args.push(terms.map((term) => `${term}*`).join(" AND "));
    } else {
      // Keep punctuation-only searches literal rather than sending invalid FTS
      // syntax. This is uncommon and preserves the previous behaviour.
      const like = `%${escapeLike(text)}%`;
      clauses.push("(lower(o.order_number) LIKE ? ESCAPE '\\' OR lower(o.customer_name) LIKE ? ESCAPE '\\' OR lower(o.customer_email) LIKE ? ESCAPE '\\')");
      args.push(like, like, like);
    }
  }

  if (query.channel === "tiktok") clauses.push("o.source = 'tiktok'");
  else if (query.channel === "shopify") clauses.push("o.source <> 'tiktok'");

  const notCancelled = "(o.cancelled_at IS NULL OR o.cancelled_at = '')";
  if (query.fulfillment === "cancelled") clauses.push("o.cancelled_at IS NOT NULL AND o.cancelled_at <> ''");
  else if (query.fulfillment === "fulfilled") clauses.push(`${notCancelled} AND o.fulfillment_status = 'fulfilled'`);
  else if (query.fulfillment === "partial") clauses.push(`${notCancelled} AND o.fulfillment_status = 'partial'`);
  else if (query.fulfillment === "unfulfilled") clauses.push(`${notCancelled} AND o.fulfillment_status NOT IN ('fulfilled', 'partial')`);

  if (query.dateRange !== "all") {
    const days = Number(query.dateRange);
    clauses.push("o.source_created_at >= ?");
    args.push(new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString());
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return { where, args };
}

/** Expands base order rows with their line items and Parcel2Go deliveries. */
async function hydrateOrders(db: DatabaseClient, rows: QueryRows): Promise<Order[]> {
  if (rows.length === 0) return [];
  const orderIds = rows.map((row) => stringValue(row.id)).filter(Boolean);
  const [deliveriesByOrderId, itemsResult] = await Promise.all([
    getParcel2GoDeliveriesForOrders(orderIds),
    db.execute({
      sql: `SELECT order_id, id, title, variant_title, sku, quantity, unit_price_amount, image_url
            FROM order_items WHERE order_id IN (${orderIds.map(() => "?").join(", ")}) ORDER BY order_id, rowid`,
      args: orderIds,
    }),
  ]);
  const itemsByOrderId = new Map<string, Order["items"]>();
  for (const item of itemsResult.rows) {
    const orderId = stringValue(item.order_id);
    const items = itemsByOrderId.get(orderId) ?? [];
    items.push({
      id: stringValue(item.id),
      title: stringValue(item.title),
      variant: stringValue(item.variant_title),
      sku: stringValue(item.sku),
      quantity: numberValue(item.quantity),
      unitPrice: numberValue(item.unit_price_amount),
      imageTone: "blush" as const,
    });
    itemsByOrderId.set(orderId, items);
  }

  return rows.map((row) => {
    const id = stringValue(row.id);
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
      fulfillment: toFulfillment(stringValue(row.fulfillment_status), stringValue(row.cancelled_at)),
      cancelledAt: stringValue(row.cancelled_at) || null,
      createdAt: stringValue(row.source_created_at),
      subtotal: numberValue(row.subtotal_amount),
      shipping: numberValue(row.shipping_amount),
      tax: numberValue(row.tax_amount),
      total: numberValue(row.total_amount),
      items: itemsByOrderId.get(id) ?? [],
      deliveries: deliveriesByOrderId.get(id) ?? [],
    } satisfies Order;
  });
}

export async function getOrders(): Promise<Order[]> {
  const db = await getTursoClient();
  const result = await db.execute(`SELECT ${ORDERS_BASE_COLUMNS} FROM orders o ORDER BY o.source_created_at DESC LIMIT 500`);
  return hydrateOrders(db, result.rows);
}

/**
 * Server-side filtered + paginated Orders list. One COUNT gives the true total,
 * and only the current page's rows are hydrated with items/deliveries — so the
 * list no longer ships all 500 orders to the browser on every load.
 */
export async function getOrdersPage(query: OrdersQuery): Promise<OrdersPageResult> {
  const db = await getTursoClient();
  const { where, args } = buildOrdersFilter(query);
  const pageSize = query.pageSize;

  const countResult = await db.execute({ sql: `SELECT COUNT(*) AS total FROM orders o ${where}`, args });
  const total = numberValue(countResult.rows[0]?.total);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, query.page), totalPages);
  const offset = (page - 1) * pageSize;

  const pageResult = await db.execute({
    sql: `SELECT ${ORDERS_BASE_COLUMNS} FROM orders o ${where} ORDER BY o.source_created_at DESC LIMIT ? OFFSET ?`,
    args: [...args, pageSize, offset],
  });
  const orders = await hydrateOrders(db, pageResult.rows);
  return { orders, total, page, pageSize, totalPages };
}

/** Every row matching the current filters, shaped for the CSV export. */
export async function getOrdersForExport(query: OrdersQuery): Promise<string[][]> {
  const db = await getTursoClient();
  const { where, args } = buildOrdersFilter(query);
  const result = await db.execute({
    sql: `SELECT o.order_number, o.source, o.customer_name, o.financial_status, o.fulfillment_status,
            o.cancelled_at, o.source_created_at, o.total_amount
          FROM orders o ${where} ORDER BY o.source_created_at DESC`,
    args,
  });
  return result.rows.map((row) => [
    stringValue(row.order_number),
    stringValue(row.source) === "tiktok" ? "tiktok" : "shopify",
    stringValue(row.customer_name) || "Guest customer",
    toPayment(stringValue(row.financial_status)),
    toFulfillment(stringValue(row.fulfillment_status), stringValue(row.cancelled_at)),
    stringValue(row.source_created_at),
    (numberValue(row.total_amount) / 100).toFixed(2),
  ]);
}

export async function getCustomers(): Promise<Customer[]> {
  const db = await getTursoClient();
  const result = await db.execute(`
    WITH normalised AS (
      SELECT id, source, customer_name, customer_email, customer_phone, total_amount, source_created_at,
        lower(trim(COALESCE(customer_email, ''))) AS email,
        replace(replace(replace(replace(replace(replace(COALESCE(customer_phone, ''), ' ', ''), '+', ''), '-', ''), '(', ''), ')', ''), '.', '') AS phone
      FROM orders
    ), identified AS (
      SELECT *, CASE
        WHEN email <> '' THEN 'email:' || email
        WHEN phone <> '' THEN 'phone:' || phone
        ELSE 'order:' || id
      END AS identity
      FROM normalised
    ), ranked AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY identity ORDER BY source_created_at DESC, id DESC) AS row_number
      FROM identified
    ), aggregates AS (
      SELECT identity, COUNT(*) AS orders, SUM(total_amount) AS total_spent,
             MAX(source_created_at) AS last_order_at, GROUP_CONCAT(DISTINCT source) AS channels
      FROM identified
      GROUP BY identity
    )
    SELECT a.identity, a.orders, a.total_spent, a.last_order_at, a.channels,
           r.customer_name, r.email, r.phone
    FROM aggregates a
    JOIN ranked r ON r.identity = a.identity AND r.row_number = 1
    ORDER BY a.last_order_at DESC
  `);
  return result.rows.map((row) => {
    const identity = stringValue(row.identity);
    const email = stringValue(row.email);
    const phone = stringValue(row.phone);
    const orders = numberValue(row.orders);
    const channels = stringValue(row.channels).split(",").flatMap((channel) => channel === "tiktok" || channel === "shopify" ? [channel] : []) as Channel[];
    return {
      id: `customer:${createHash("sha256").update(identity).digest("hex").slice(0, 16)}`,
      name: stringValue(row.customer_name).trim() || "Unnamed customer",
      email,
      phone,
      channels,
      orders,
      totalSpent: numberValue(row.total_spent),
      lastOrderAt: stringValue(row.last_order_at),
      type: orders > 1 ? "repeat" : !email && !phone ? "guest" : "one-time",
    };
  });
}

function isKpiPeriod(value: KpiPeriod) {
  if (!isKpiCalendarDate(value.start) || !isKpiCalendarDate(value.end)) return false;
  const start = Date.parse(`${value.start}T00:00:00.000Z`);
  const end = Date.parse(`${value.end}T00:00:00.000Z`);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start;
}

function isKpiCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function shiftKpiDate(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function groupKpiSales(rows: QueryRows): KpiSale[] {
  const sales = new Map<string, KpiSale>();
  for (const row of rows) {
    const id = stringValue(row.order_id);
    if (!id) continue;
    const channel = stringValue(row.source) === "tiktok" ? "tiktok" : "shopify";
    const sale = sales.get(id) ?? {
      id,
      createdAt: stringValue(row.source_created_at),
      channel,
      financialStatus: stringValue(row.financial_status),
      cancelledAt: optionalString(row.cancelled_at) ?? null,
      customer: {
        name: stringValue(row.customer_name),
        email: optionalString(row.customer_email) ?? null,
        phone: optionalString(row.customer_phone) ?? null,
      },
      items: [],
    };
    sale.items.push({
      id: stringValue(row.source_line_item_id) || stringValue(row.order_item_id),
      quantity: numberValue(row.quantity),
      unitPrice: numberValue(row.unit_price_amount),
      product: row.physical_item_id ? { id: stringValue(row.physical_item_id), title: stringValue(row.physical_item_title) } : null,
    });
    sales.set(id, sale);
  }
  return [...sales.values()];
}

function groupKpiCustomerOrders(rows: QueryRows): KpiCustomerOrder[] {
  return rows.map((row) => ({
    id: stringValue(row.id),
    createdAt: stringValue(row.source_created_at),
    financialStatus: stringValue(row.financial_status),
    cancelledAt: optionalString(row.cancelled_at) ?? null,
    customer: {
      name: stringValue(row.customer_name),
      email: optionalString(row.customer_email) ?? null,
      phone: optionalString(row.customer_phone) ?? null,
    },
  })).filter((order) => order.id && order.createdAt);
}

function groupKpiRestockDemandLines(rows: QueryRows): KpiRestockDemandLine[] {
  return rows.map((row) => ({
    orderId: stringValue(row.order_id),
    lineItemId: stringValue(row.source_line_item_id) || stringValue(row.order_item_id),
    variantId: stringValue(row.physical_variant_id),
    channel: stringValue(row.channel) === "tiktok" ? "tiktok" as const : "shopify" as const,
    createdAt: stringValue(row.source_created_at),
    financialStatus: stringValue(row.financial_status),
    cancelledAt: optionalString(row.cancelled_at) ?? null,
    quantity: numberValue(row.quantity),
    quantityPerSale: numberValue(row.quantity_per_sale),
  })).filter((line) => line.orderId && line.lineItemId && line.variantId && line.createdAt && line.quantityPerSale > 0);
}

function groupKpiRestockVariants(rows: QueryRows): KpiRestockVariant[] {
  return rows.map((row) => ({
    id: stringValue(row.id),
    productTitle: stringValue(row.product_title),
    variantTitle: stringValue(row.variant_title),
    countedStock: row.counted_stock === null || row.counted_stock === undefined ? null : numberValue(row.counted_stock),
    leadTimeDays: nullableNumber(row.lead_time_days),
    firstPaidSaleAt: optionalString(row.first_paid_sale_at) ?? null,
  })).filter((variant) => variant.id);
}

function londonKpiDate(date: Date | string) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(date));
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function londonKpiToday() {
  return londonKpiDate(new Date());
}

/**
 * KPI reporting read scoped to the requested inclusive interval. The explicit all-time
 * mode resolves to the complete recorded order history; no tax, delivery, client
 * tracking, or separate analytics store is involved.
 */
export async function getKpiDashboard(range: KpiPeriod, database?: DatabaseClient): Promise<KpiDashboard> {
  if (!isKpiPeriod(range)) throw new Error("Choose a valid inclusive reporting period.");
  const db = database ?? await getTursoClient();
  let reportingRange = range;
  if (range.allTime) {
    const earliestOrderResult = await db.execute("SELECT MIN(source_created_at) AS first_order_at FROM orders");
    const earliestOrderAt = optionalString(earliestOrderResult.rows[0]?.first_order_at);
    reportingRange = {
      start: earliestOrderAt ? londonKpiDate(earliestOrderAt) : range.end,
      end: range.end,
      allTime: true,
    };
  }
  const days = Math.floor((Date.parse(`${reportingRange.end}T00:00:00.000Z`) - Date.parse(`${reportingRange.start}T00:00:00.000Z`)) / 86_400_000) + 1;
  const previousStart = reportingRange.allTime ? reportingRange.start : shiftKpiDate(reportingRange.start, -days);
  // Widening each SQL edge by one day safely includes London-midnight records;
  // the calculation core applies the exact Europe/London period boundaries.
  const queryStart = shiftKpiDate(previousStart, -1);
  const queryEndExclusive = shiftKpiDate(reportingRange.end, 2);
  const restockToday = londonKpiToday();
  const restockQueryStart = shiftKpiDate(restockToday, -90);
  const restockQueryEndExclusive = shiftKpiDate(restockToday, 2);
  // The same mapped component rows power both the rolling restock signal and
  // the selected-period variant report. Query the union so custom historical
  // ranges do not silently render an empty variant chart.
  const variantDemandQueryStart = queryStart < restockQueryStart ? queryStart : restockQueryStart;
  const variantDemandQueryEndExclusive = queryEndExclusive > restockQueryEndExclusive ? queryEndExclusive : restockQueryEndExclusive;
  const refundQueryStart = queryStart < restockQueryStart ? queryStart : restockQueryStart;
  const refundQueryEndExclusive = queryEndExclusive > restockQueryEndExclusive ? queryEndExclusive : restockQueryEndExclusive;
  const [salesResult, shopifyRefunds, tiktokRefunds, customerOrdersResult, restockDemandResult, restockVariantsResult, freshnessResult] = await Promise.all([
    db.execute({
      sql: `SELECT o.id AS order_id, o.source, o.source_created_at, o.financial_status, o.cancelled_at,
                   o.customer_name, o.customer_email, o.customer_phone,
                   oi.id AS order_item_id, oi.source_line_item_id, oi.quantity, oi.unit_price_amount,
                   physical_item.id AS physical_item_id, physical_item.title AS physical_item_title
            FROM orders o
            JOIN order_items oi ON oi.order_id = o.id
            LEFT JOIN physical_channel_listings listing
              ON listing.active = 1 AND listing.mapping_status = 'confirmed' AND listing.channel = o.source
             AND ((o.source = 'shopify' AND listing.external_variant_id = oi.source_variant_id)
               OR (o.source = 'tiktok' AND listing.external_product_id = oi.source_product_id
                 AND (listing.external_variant_id = oi.source_variant_id
                   OR (listing.external_variant_id IS NULL AND NOT EXISTS (
                     SELECT 1 FROM physical_channel_listings exact_listing
                     WHERE exact_listing.channel = 'tiktok' AND exact_listing.active = 1
                       AND exact_listing.external_product_id = oi.source_product_id
                       AND exact_listing.external_variant_id = oi.source_variant_id
                   )))))
            LEFT JOIN physical_channel_product_links product_link
              ON product_link.channel = listing.channel AND product_link.external_product_id = listing.external_product_id
            LEFT JOIN physical_inventory_items physical_item
              ON physical_item.id = product_link.physical_item_id AND physical_item.active = 1
            WHERE (o.source_created_at >= ? AND o.source_created_at < ?)
               OR EXISTS (SELECT 1 FROM shopify_refund_line_items refund
                          WHERE refund.order_id = o.id AND refund.processed_at >= ? AND refund.processed_at < ?)
               OR EXISTS (SELECT 1 FROM tiktok_after_sales_line_items after_sale
                          WHERE after_sale.order_id = o.id AND after_sale.source_updated_at >= ? AND after_sale.source_updated_at < ?)
            ORDER BY o.source_created_at ASC, o.id, oi.rowid`,
      args: [queryStart, queryEndExclusive, queryStart, queryEndExclusive, queryStart, queryEndExclusive],
    }),
    db.execute({
      sql: `SELECT order_id, source_line_item_id, quantity, processed_at
            FROM shopify_refund_line_items
            WHERE processed_at >= ? AND processed_at < ?`,
      args: [refundQueryStart, refundQueryEndExclusive],
    }),
    db.execute({
      sql: `SELECT order_id, source_line_item_id, quantity, source_updated_at
            FROM tiktok_after_sales_line_items
            WHERE event_type = 'return' AND return_type = 'RETURN_AND_REFUND'
              AND status IN ('RETURN_OR_REFUND_REQUEST_SUCCESS', 'RETURN_OR_REFUND_REQUEST_COMPLETE')
              AND source_updated_at >= ? AND source_updated_at < ?`,
      args: [refundQueryStart, refundQueryEndExclusive],
    }),
    db.execute(`SELECT id, source_created_at, financial_status, cancelled_at, customer_name, customer_email, customer_phone
                FROM orders
                ORDER BY source_created_at ASC, id ASC`),
    db.execute({
      sql: `WITH relevant_order_ids AS (
              SELECT o.id
              FROM orders o
              WHERE o.source_created_at >= ? AND o.source_created_at < ?
              UNION
              SELECT refund.order_id
              FROM shopify_refund_line_items refund
              WHERE refund.processed_at >= ? AND refund.processed_at < ?
              UNION
              SELECT after_sale.order_id
              FROM tiktok_after_sales_line_items after_sale
              WHERE after_sale.source_updated_at >= ? AND after_sale.source_updated_at < ?
            )
            SELECT o.id AS order_id, o.source AS channel, o.source_created_at, o.financial_status, o.cancelled_at,
                   oi.id AS order_item_id, oi.source_line_item_id, oi.quantity,
                   component.physical_variant_id, component.quantity_per_sale
            FROM relevant_order_ids relevant
            JOIN orders o ON o.id = relevant.id
            JOIN order_items oi ON oi.order_id = o.id
            JOIN physical_channel_listings listing
              ON listing.active = 1 AND listing.mapping_status = 'confirmed' AND listing.channel = o.source
             AND ((o.source = 'shopify' AND listing.external_variant_id = oi.source_variant_id)
               OR (o.source = 'tiktok' AND listing.external_product_id = oi.source_product_id
                 AND (listing.external_variant_id = oi.source_variant_id
                   OR (listing.external_variant_id IS NULL AND NOT EXISTS (
                     SELECT 1 FROM physical_channel_listings exact_listing
                     WHERE exact_listing.channel = 'tiktok' AND exact_listing.active = 1
                       AND exact_listing.external_product_id = oi.source_product_id
                       AND exact_listing.external_variant_id = oi.source_variant_id
                   )))))
             JOIN physical_listing_components component ON component.listing_id = listing.id
             JOIN physical_inventory_variants physical_variant ON physical_variant.id = component.physical_variant_id AND physical_variant.active = 1
             ORDER BY o.source_created_at ASC, o.id, oi.rowid, component.physical_variant_id`,
      args: [variantDemandQueryStart, variantDemandQueryEndExclusive, variantDemandQueryStart, variantDemandQueryEndExclusive, variantDemandQueryStart, variantDemandQueryEndExclusive],
    }),
    db.execute(`WITH first_paid_sales AS (
                  SELECT component.physical_variant_id, MIN(o.source_created_at) AS first_paid_sale_at
                  FROM physical_listing_components component
                  JOIN physical_channel_listings listing ON listing.id = component.listing_id
                    AND listing.active = 1 AND listing.mapping_status = 'confirmed'
                  JOIN order_items oi
                    ON ((listing.channel = 'shopify' AND listing.external_variant_id = oi.source_variant_id)
                      OR (listing.channel = 'tiktok' AND listing.external_product_id = oi.source_product_id
                        AND (listing.external_variant_id = oi.source_variant_id
                          OR (listing.external_variant_id IS NULL AND NOT EXISTS (
                            SELECT 1 FROM physical_channel_listings exact_listing
                            WHERE exact_listing.channel = 'tiktok' AND exact_listing.active = 1
                              AND exact_listing.external_product_id = oi.source_product_id
                              AND exact_listing.external_variant_id = oi.source_variant_id
                          )))))
                  JOIN orders o ON o.id = oi.order_id AND o.source = listing.channel
                  WHERE o.cancelled_at IS NULL AND o.financial_status <> 'pending'
                  GROUP BY component.physical_variant_id
                )
                SELECT physical_variant.id, physical_item.title AS product_title, physical_variant.title AS variant_title,
                       CASE WHEN physical_variant.quantity_known = 1 THEN physical_variant.quantity ELSE NULL END AS counted_stock,
                       physical_item.lead_time_days, first_paid_sales.first_paid_sale_at
                FROM physical_inventory_variants physical_variant
                JOIN physical_inventory_items physical_item ON physical_item.id = physical_variant.physical_item_id
                LEFT JOIN first_paid_sales ON first_paid_sales.physical_variant_id = physical_variant.id
                WHERE physical_variant.active = 1 AND physical_item.active = 1
                ORDER BY physical_item.title ASC, physical_variant.sort_order ASC, physical_variant.title ASC`),
    db.execute("SELECT finished_at FROM sync_runs WHERE status = 'succeeded' AND finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1"),
  ]);

  return buildKpiDashboard({
    range: reportingRange,
    sales: groupKpiSales(salesResult.rows),
    customerOrders: groupKpiCustomerOrders(customerOrdersResult.rows),
    refunds: [
      ...shopifyRefunds.rows.map((row) => ({
        orderId: stringValue(row.order_id), lineItemId: stringValue(row.source_line_item_id), quantity: numberValue(row.quantity), processedAt: stringValue(row.processed_at),
      })),
      ...tiktokRefunds.rows.map((row) => ({
        orderId: stringValue(row.order_id), lineItemId: stringValue(row.source_line_item_id), quantity: numberValue(row.quantity), processedAt: stringValue(row.source_updated_at),
      })),
    ],
    restock: {
      today: restockToday,
      variants: groupKpiRestockVariants(restockVariantsResult.rows),
      demandLines: groupKpiRestockDemandLines(restockDemandResult.rows),
    },
    variantPerformance: {
      variants: groupKpiRestockVariants(restockVariantsResult.rows),
      demandLines: groupKpiRestockDemandLines(restockDemandResult.rows),
    },
    freshness: optionalString(freshnessResult.rows[0]?.finished_at) ?? null,
  });
}

/** Calendar product comparison read. Bucketing and winner rules remain in the pure KPI domain. */
export async function getKpiProductComparison(spec: ComparisonSpec): Promise<KpiProductComparison> {
  const range = comparisonDateRange(spec);
  const db = await getTursoClient();
  const queryStart = shiftKpiDate(range.start, -1);
  const queryEndExclusive = shiftKpiDate(range.end, 2);
  const [salesResult, shopifyRefunds, tiktokRefunds] = await Promise.all([
    db.execute({
      sql: `SELECT o.id AS order_id, o.source, o.source_created_at, o.financial_status, o.cancelled_at,
                   o.customer_name, o.customer_email, o.customer_phone,
                   oi.id AS order_item_id, oi.source_line_item_id, oi.quantity, oi.unit_price_amount,
                   physical_item.id AS physical_item_id, physical_item.title AS physical_item_title
            FROM orders o
            JOIN order_items oi ON oi.order_id = o.id
            LEFT JOIN physical_channel_listings listing
              ON listing.active = 1 AND listing.mapping_status = 'confirmed' AND listing.channel = o.source
             AND ((o.source = 'shopify' AND listing.external_variant_id = oi.source_variant_id)
               OR (o.source = 'tiktok' AND listing.external_product_id = oi.source_product_id
                 AND (listing.external_variant_id = oi.source_variant_id
                   OR (listing.external_variant_id IS NULL AND NOT EXISTS (
                     SELECT 1 FROM physical_channel_listings exact_listing
                     WHERE exact_listing.channel = 'tiktok' AND exact_listing.active = 1
                       AND exact_listing.external_product_id = oi.source_product_id
                       AND exact_listing.external_variant_id = oi.source_variant_id
                   )))))
            LEFT JOIN physical_channel_product_links product_link
              ON product_link.channel = listing.channel AND product_link.external_product_id = listing.external_product_id
            LEFT JOIN physical_inventory_items physical_item
              ON physical_item.id = product_link.physical_item_id AND physical_item.active = 1
            WHERE (o.source_created_at >= ? AND o.source_created_at < ?)
               OR EXISTS (SELECT 1 FROM shopify_refund_line_items refund
                          WHERE refund.order_id = o.id AND refund.processed_at >= ? AND refund.processed_at < ?)
               OR EXISTS (SELECT 1 FROM tiktok_after_sales_line_items after_sale
                          WHERE after_sale.order_id = o.id AND after_sale.source_updated_at >= ? AND after_sale.source_updated_at < ?)
            ORDER BY o.source_created_at ASC, o.id, oi.rowid`,
      args: [queryStart, queryEndExclusive, queryStart, queryEndExclusive, queryStart, queryEndExclusive],
    }),
    db.execute({
      sql: `SELECT order_id, source_line_item_id, quantity, processed_at
            FROM shopify_refund_line_items refund
            JOIN orders ordinary ON ordinary.id = refund.order_id
            WHERE refund.processed_at < ?
              AND ((ordinary.source_created_at >= ? AND ordinary.source_created_at < ?)
                OR EXISTS (SELECT 1 FROM shopify_refund_line_items current_refund
                           WHERE current_refund.order_id = refund.order_id
                             AND current_refund.processed_at >= ? AND current_refund.processed_at < ?))`,
      args: [queryEndExclusive, queryStart, queryEndExclusive, queryStart, queryEndExclusive],
    }),
    db.execute({
      sql: `SELECT refund.order_id, refund.source_line_item_id, refund.quantity, refund.source_updated_at
            FROM tiktok_after_sales_line_items refund
            JOIN orders ordinary ON ordinary.id = refund.order_id
            WHERE refund.event_type = 'return' AND refund.return_type = 'RETURN_AND_REFUND'
              AND refund.status IN ('RETURN_OR_REFUND_REQUEST_SUCCESS', 'RETURN_OR_REFUND_REQUEST_COMPLETE')
              AND refund.source_updated_at < ?
              AND ((ordinary.source_created_at >= ? AND ordinary.source_created_at < ?)
                OR EXISTS (SELECT 1 FROM tiktok_after_sales_line_items current_refund
                           WHERE current_refund.order_id = refund.order_id
                             AND current_refund.event_type = 'return' AND current_refund.return_type = 'RETURN_AND_REFUND'
                             AND current_refund.status IN ('RETURN_OR_REFUND_REQUEST_SUCCESS', 'RETURN_OR_REFUND_REQUEST_COMPLETE')
                             AND current_refund.source_updated_at >= ? AND current_refund.source_updated_at < ?))`,
      args: [queryEndExclusive, queryStart, queryEndExclusive, queryStart, queryEndExclusive],
    }),
  ]);
  return buildKpiProductComparison({
    spec,
    sales: groupKpiSales(salesResult.rows),
    refunds: [
      ...shopifyRefunds.rows.map((row) => ({
        orderId: stringValue(row.order_id), lineItemId: stringValue(row.source_line_item_id), quantity: numberValue(row.quantity), processedAt: stringValue(row.processed_at),
      })),
      ...tiktokRefunds.rows.map((row) => ({
        orderId: stringValue(row.order_id), lineItemId: stringValue(row.source_line_item_id), quantity: numberValue(row.quantity), processedAt: stringValue(row.source_updated_at),
      })),
    ],
  });
}

/** Four-week affiliate comparison read with stable provider creator and product identifiers. */
export async function getTikTokAffiliateComparison(spec: ComparisonSpec): Promise<TikTokAffiliateComparison> {
  const range = comparisonDateRange(spec);
  const db = await getTursoClient();
  const queryStart = shiftKpiDate(range.start, -1);
  const queryEndExclusive = shiftKpiDate(range.end, 2);
  const [orders, refunds, videos] = await Promise.all([
    db.execute({
      sql: `SELECT affiliate.id, affiliate.source_order_id, affiliate.source_line_item_id, affiliate.source_created_at,
                    affiliate.quantity, affiliate.gross_amount_minor, affiliate.estimated_commission_minor,
                    affiliate.creator_open_id, affiliate.creator_username, affiliate.source_product_id,
                    COALESCE(
                      NULLIF(TRIM(affiliate.product_title), ''),
                      (
                        SELECT listing.title
                        FROM physical_channel_listings listing
                        WHERE listing.channel = 'tiktok'
                          AND listing.external_product_id = affiliate.source_product_id
                          AND listing.title IS NOT NULL AND TRIM(listing.title) <> ''
                        ORDER BY listing.active DESC, listing.updated_at DESC, listing.id ASC
                        LIMIT 1
                      ),
                      CASE WHEN affiliate.source_product_id IS NOT NULL AND TRIM(affiliate.source_product_id) <> ''
                        THEN 'TikTok product ' || affiliate.source_product_id ELSE NULL END
                    ) AS product_title,
                    ordinary.financial_status, ordinary.cancelled_at
             FROM tiktok_affiliate_orders affiliate
             LEFT JOIN orders ordinary ON ordinary.source = 'tiktok' AND ordinary.source_order_id = affiliate.source_order_id
             WHERE affiliate.source_created_at >= ? AND affiliate.source_created_at < ?
                OR EXISTS (
                  SELECT 1 FROM tiktok_after_sales_line_items refund
                  WHERE refund.order_id = ordinary.id AND refund.source_line_item_id = affiliate.source_line_item_id
                    AND refund.event_type = 'return' AND refund.return_type = 'RETURN_AND_REFUND'
                    AND refund.status IN ('RETURN_OR_REFUND_REQUEST_SUCCESS', 'RETURN_OR_REFUND_REQUEST_COMPLETE')
                    AND refund.source_updated_at >= ? AND refund.source_updated_at < ?
                )
             ORDER BY affiliate.source_created_at ASC, affiliate.id ASC`,
      args: [queryStart, queryEndExclusive, queryStart, queryEndExclusive],
    }),
    db.execute({
      sql: `SELECT ordinary.source_order_id, refund.source_line_item_id, refund.quantity, refund.source_updated_at
             FROM tiktok_after_sales_line_items refund
             JOIN orders ordinary ON ordinary.id = refund.order_id
             JOIN tiktok_affiliate_orders affiliate
               ON affiliate.source_order_id = ordinary.source_order_id
              AND affiliate.source_line_item_id = refund.source_line_item_id
             WHERE ordinary.source = 'tiktok' AND refund.event_type = 'return' AND refund.return_type = 'RETURN_AND_REFUND'
               AND refund.status IN ('RETURN_OR_REFUND_REQUEST_SUCCESS', 'RETURN_OR_REFUND_REQUEST_COMPLETE')
               AND refund.source_updated_at < ?
               AND ((affiliate.source_created_at >= ? AND affiliate.source_created_at < ?)
                 OR EXISTS (SELECT 1 FROM tiktok_after_sales_line_items current_refund
                            WHERE current_refund.order_id = refund.order_id
                              AND current_refund.source_line_item_id = refund.source_line_item_id
                              AND current_refund.event_type = 'return' AND current_refund.return_type = 'RETURN_AND_REFUND'
                              AND current_refund.status IN ('RETURN_OR_REFUND_REQUEST_SUCCESS', 'RETURN_OR_REFUND_REQUEST_COMPLETE')
                              AND current_refund.source_updated_at >= ? AND current_refund.source_updated_at < ?))`,
      args: [queryEndExclusive, queryStart, queryEndExclusive, queryStart, queryEndExclusive],
    }),
    db.execute({
      sql: `SELECT id, creator_open_id, creator_username, published_at
             FROM tiktok_affiliate_videos WHERE published_at >= ? AND published_at < ? ORDER BY published_at ASC, id ASC`,
      args: [queryStart, queryEndExclusive],
    }),
  ]);
  return buildTikTokAffiliateComparison({
    spec,
    orders: orders.rows.map((row) => ({
      id: stringValue(row.id), orderId: stringValue(row.source_order_id), lineItemId: stringValue(row.source_line_item_id),
      createdAt: stringValue(row.source_created_at), quantity: numberValue(row.quantity), grossAmount: numberValue(row.gross_amount_minor),
      estimatedCommission: numberValue(row.estimated_commission_minor),
      creator: optionalString(row.creator_username) ?? optionalString(row.creator_open_id) ?? null,
      creatorId: optionalString(row.creator_open_id) ?? optionalString(row.creator_username) ?? null,
      creatorName: optionalString(row.creator_username) ?? optionalString(row.creator_open_id) ?? null,
      product: optionalString(row.product_title) ?? null,
      productId: optionalString(row.source_product_id) ?? optionalString(row.product_title) ?? null,
      productTitle: optionalString(row.product_title) ?? null,
      linked: row.financial_status == null ? null : { financialStatus: stringValue(row.financial_status), cancelledAt: optionalString(row.cancelled_at) ?? null },
    })),
    refunds: refunds.rows.map((row) => ({
      orderId: stringValue(row.source_order_id), lineItemId: stringValue(row.source_line_item_id), quantity: numberValue(row.quantity), processedAt: stringValue(row.source_updated_at),
    })),
    videos: videos.rows.map((row) => ({
      id: stringValue(row.id),
      creator: optionalString(row.creator_username) ?? optionalString(row.creator_open_id) ?? null,
      creatorId: optionalString(row.creator_open_id) ?? optionalString(row.creator_username) ?? null,
      creatorName: optionalString(row.creator_username) ?? optionalString(row.creator_open_id) ?? null,
      publishedAt: optionalString(row.published_at) ?? null,
    })),
  });
}

/** Server-shaped affiliate reporting read. TikTok affiliate records remain distinct from ordinary orders until a stable ID join succeeds. */
export async function getTikTokAffiliateDashboard(range: KpiPeriod): Promise<TikTokAffiliateDashboard> {
  if (!isKpiPeriod(range)) throw new Error("Choose a valid inclusive reporting period.");
  const db = await getTursoClient();
  let reportingRange = range;
  const allTime = "allTime" in range && range.allTime === true;
  if (allTime) {
    const earliest = await db.execute("SELECT MIN(source_created_at) AS first_record_at FROM tiktok_affiliate_orders");
    const firstRecordAt = optionalString(earliest.rows[0]?.first_record_at);
    reportingRange = { start: firstRecordAt ? affiliateKpiLondonDate(firstRecordAt) : range.end, end: range.end, allTime: true };
  }
  const queryStart = shiftKpiDate(reportingRange.start, -1);
  const queryEndExclusive = shiftKpiDate(reportingRange.end, 2);
  const [orders, refunds, videos, freshness] = await Promise.all([
    db.execute({
      sql: `SELECT affiliate.id, affiliate.source_order_id, affiliate.source_line_item_id, affiliate.source_created_at,
                    affiliate.quantity, affiliate.gross_amount_minor, affiliate.estimated_commission_minor,
                    affiliate.creator_open_id, affiliate.creator_username, affiliate.source_product_id,
                    COALESCE(
                      NULLIF(TRIM(affiliate.product_title), ''),
                      (
                        SELECT listing.title
                        FROM physical_channel_listings listing
                        WHERE listing.channel = 'tiktok'
                          AND listing.external_product_id = affiliate.source_product_id
                          AND listing.title IS NOT NULL
                          AND TRIM(listing.title) <> ''
                        ORDER BY listing.active DESC, listing.updated_at DESC, listing.id ASC
                        LIMIT 1
                      ),
                      CASE
                        WHEN affiliate.source_product_id IS NOT NULL AND TRIM(affiliate.source_product_id) <> ''
                        THEN 'TikTok product ' || affiliate.source_product_id
                        ELSE NULL
                      END
                    ) AS product_title,
                    ordinary.financial_status, ordinary.cancelled_at
             FROM tiktok_affiliate_orders affiliate
             LEFT JOIN orders ordinary ON ordinary.source = 'tiktok' AND ordinary.source_order_id = affiliate.source_order_id
             WHERE affiliate.source_created_at >= ? AND affiliate.source_created_at < ?
                OR EXISTS (
                  SELECT 1 FROM tiktok_after_sales_line_items refund
                  WHERE refund.order_id = ordinary.id AND refund.source_line_item_id = affiliate.source_line_item_id
                    AND refund.event_type = 'return' AND refund.return_type = 'RETURN_AND_REFUND'
                    AND refund.status IN ('RETURN_OR_REFUND_REQUEST_SUCCESS', 'RETURN_OR_REFUND_REQUEST_COMPLETE')
                    AND refund.source_updated_at >= ? AND refund.source_updated_at < ?
                )
             ORDER BY affiliate.source_created_at ASC, affiliate.id ASC`,
      args: [queryStart, queryEndExclusive, queryStart, queryEndExclusive],
    }),
    db.execute({
      sql: `SELECT ordinary.source_order_id, refund.source_line_item_id, refund.quantity, refund.source_updated_at
             FROM tiktok_after_sales_line_items refund
             JOIN orders ordinary ON ordinary.id = refund.order_id
             WHERE ordinary.source = 'tiktok' AND refund.event_type = 'return' AND refund.return_type = 'RETURN_AND_REFUND'
               AND refund.status IN ('RETURN_OR_REFUND_REQUEST_SUCCESS', 'RETURN_OR_REFUND_REQUEST_COMPLETE')
               AND refund.source_updated_at >= ? AND refund.source_updated_at < ?`,
      args: [queryStart, queryEndExclusive],
    }),
    db.execute({
      sql: `SELECT id, creator_open_id, creator_username, published_at
             FROM tiktok_affiliate_videos WHERE published_at >= ? AND published_at < ? ORDER BY published_at ASC, id ASC`,
      args: [queryStart, queryEndExclusive],
    }),
    db.execute(`SELECT MAX(last_successful_at) AS last_successful_at, MAX(last_error_at) AS last_error_at FROM tiktok_affiliate_sync_status`),
  ]);
  return buildTikTokAffiliateDashboard({
    range: reportingRange,
    orders: orders.rows.map((row) => ({
      id: stringValue(row.id), orderId: stringValue(row.source_order_id), lineItemId: stringValue(row.source_line_item_id),
      createdAt: stringValue(row.source_created_at), quantity: numberValue(row.quantity), grossAmount: numberValue(row.gross_amount_minor),
      estimatedCommission: numberValue(row.estimated_commission_minor),
      creator: optionalString(row.creator_username) ?? optionalString(row.creator_open_id) ?? null,
      creatorId: optionalString(row.creator_open_id) ?? optionalString(row.creator_username) ?? null,
      creatorName: optionalString(row.creator_username) ?? optionalString(row.creator_open_id) ?? null,
      product: optionalString(row.product_title) ?? null,
      productId: optionalString(row.source_product_id) ?? optionalString(row.product_title) ?? null,
      productTitle: optionalString(row.product_title) ?? null,
      linked: row.financial_status == null ? null : { financialStatus: stringValue(row.financial_status), cancelledAt: optionalString(row.cancelled_at) ?? null },
    })),
    refunds: refunds.rows.map((row) => ({ orderId: stringValue(row.source_order_id), lineItemId: stringValue(row.source_line_item_id), quantity: numberValue(row.quantity), processedAt: stringValue(row.source_updated_at) })),
    videos: videos.rows.map((row) => ({
      id: stringValue(row.id),
      creator: optionalString(row.creator_username) ?? optionalString(row.creator_open_id) ?? null,
      creatorId: optionalString(row.creator_open_id) ?? optionalString(row.creator_username) ?? null,
      creatorName: optionalString(row.creator_username) ?? optionalString(row.creator_open_id) ?? null,
      publishedAt: optionalString(row.published_at) ?? null,
    })),
    freshness: freshness.rows[0] ? { lastSuccessfulAt: optionalString(freshness.rows[0].last_successful_at) ?? null, lastErrorAt: optionalString(freshness.rows[0].last_error_at) ?? null } : null,
  });
}

function affiliateKpiLondonDate(date: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(date));
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function labIngredientId(title: string) {
  return `lab-ingredient-${createHash("sha256").update(title).digest("hex").slice(0, 16)}`;
}

/** Explicitly initializes the code-owned starter Labs catalogue. Read methods
 * must call getTursoClient directly so an assistant read can never seed data. */
export async function initializeLabsData() {
  const db = await getTursoClient();
  const now = new Date().toISOString();
  const ingredients = [...new Set(LAB_FORMULAS.flatMap((formula) => formula.lines.map((line) => line.ingredient)))];
  const statements: Array<{ sql: string; args: SqlValue[] }> = ingredients.map((title) => ({
    sql: `INSERT OR IGNORE INTO lab_ingredients (id, title, quantity_grams, quantity_known, reorder_point_grams, active, created_at, updated_at)
          VALUES (?, ?, 0, 0, 0, 1, ?, ?)`,
    args: [labIngredientId(title), title, now, now],
  }));
  for (const formula of LAB_FORMULAS) {
    statements.push({
      sql: `INSERT INTO lab_formulas (id, title, subtitle, notes, active, created_at, updated_at)
            VALUES (?, ?, ?, ?, 1, ?, ?)
            ON CONFLICT(id) DO UPDATE SET title=excluded.title, subtitle=excluded.subtitle, notes=excluded.notes, updated_at=excluded.updated_at`,
      args: [formula.id, formula.title, formula.subtitle, formula.notes, now, now],
    });
    formula.lines.forEach((line, index) => statements.push({
      sql: `INSERT OR IGNORE INTO lab_formula_ingredients (id, formula_id, ingredient_id, percentage, calculation, phase, note, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [`${formula.id}-line-${index + 1}`, formula.id, labIngredientId(line.ingredient), line.percentage ?? null, line.calculation, line.phase ?? null, line.note ?? null, index],
    }));
  }
  if (statements.length) await db.batch(statements, "write");
  return db;
}

/** Streams matching orders in stable keyset batches so large exports stay bounded. */
export async function* streamOrdersForExport(query: OrdersQuery): AsyncGenerator<string[]> {
  const db = await getTursoClient();
  const { where, args } = buildOrdersFilter(query);
  let cursorCreatedAt: string | undefined;
  let cursorId: string | undefined;

  for (;;) {
    const cursorClause = cursorCreatedAt && cursorId
      ? "(o.source_created_at < ? OR (o.source_created_at = ? AND o.id < ?))"
      : "";
    const sql = `SELECT o.id, o.order_number, o.source, o.customer_name, o.financial_status, o.fulfillment_status,
             o.cancelled_at, o.source_created_at, o.total_amount
      FROM orders o
      ${where || "WHERE 1 = 1"}${cursorClause ? ` AND ${cursorClause}` : ""}
      ORDER BY o.source_created_at DESC, o.id DESC
      LIMIT 500`;
    const result = await db.execute({
      sql,
      args: cursorClause ? [...args, cursorCreatedAt!, cursorCreatedAt!, cursorId!] : args,
    });
    if (!result.rows.length) return;
    for (const row of result.rows) {
      yield [
        stringValue(row.order_number),
        stringValue(row.source) === "tiktok" ? "tiktok" : "shopify",
        stringValue(row.customer_name) || "Guest customer",
        toPayment(stringValue(row.financial_status)),
        toFulfillment(stringValue(row.fulfillment_status), stringValue(row.cancelled_at)),
        stringValue(row.source_created_at),
        (numberValue(row.total_amount) / 100).toFixed(2),
      ];
    }
    const last = result.rows[result.rows.length - 1];
    cursorCreatedAt = stringValue(last.source_created_at);
    cursorId = stringValue(last.id);
  }
}

export async function getEmployees(): Promise<Employee[]> {
  const db = await getTursoClient();
  const onlineSince = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const result = await db.execute({
    sql: `SELECT u.id, u.name, u.email, u.image, u.createdAt,
                 MAX(s.updatedAt) AS last_seen_at,
                 CASE WHEN MAX(CASE WHEN s.updatedAt > ? THEN 1 ELSE 0 END) = 1
                      THEN 'active' ELSE 'offline' END AS status
          FROM "user" AS u
          LEFT JOIN "session" AS s ON s.userId = u.id
          GROUP BY u.id, u.name, u.email, u.image, u.createdAt
          ORDER BY u.createdAt DESC`,
    args: [onlineSince],
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
  const now = new Date().toISOString();
  const userId = `user_${crypto.randomUUID()}`;
  const accountId = `account_${crypto.randomUUID()}`;
  const passwordHash = await hashPassword(input.password);
  const transaction = await db.transaction("write");
  try {
    const existing = await transaction.execute({ sql: `SELECT id FROM "user" WHERE lower(email) = ? LIMIT 1`, args: [email] });
    if (existing.rows.length > 0) throw new Error("EMPLOYEE_ALREADY_EXISTS");
    await transaction.execute({
      sql: `INSERT INTO "user" (id, name, email, emailVerified, image, createdAt, updatedAt)
            VALUES (?, ?, ?, 0, NULL, ?, ?)`,
      args: [userId, name, email, now, now],
    });
    await transaction.execute({
      sql: `INSERT INTO "account"
              (id, accountId, providerId, userId, accessToken, refreshToken, idToken,
               accessTokenExpiresAt, refreshTokenExpiresAt, scope, password, createdAt, updatedAt)
            VALUES (?, ?, 'credential', ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?)`,
      args: [accountId, userId, userId, passwordHash, now, now],
    });
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  } finally {
    transaction.close();
  }

  return { id: userId, name, email, createdAt: now, status: "offline" };
}

export async function getUnlinkedParcel2GoShipments(): Promise<Parcel2GoShipmentOption[]> {
  const db = await getTursoClient();
  const result = await db.execute(`
    SELECT id, external_order_line_id, source_references_json, courier, service, status, collection_date, estimated_delivery_at
    FROM shipments
    WHERE provider = 'parcel2go' AND order_id IS NULL
    ORDER BY COALESCE(collection_date, updated_at) DESC
    LIMIT 25
  `);
  return result.rows.map((shipment) => ({
    id: stringValue(shipment.id),
    orderLineId: stringValue(shipment.external_order_line_id),
    sourceReferences: stringArray(shipment.source_references_json),
    courier: stringValue(shipment.courier) || "Parcel2Go courier",
    service: stringValue(shipment.service) || "Service details unavailable",
    status: stringValue(shipment.status) || "booked",
    collectionDate: optionalString(shipment.collection_date),
    estimatedDeliveryAt: optionalString(shipment.estimated_delivery_at),
  }));
}

export async function linkParcel2GoShipment(orderId: string, shipmentId: string) {
  const db = await getTursoClient();
  const transaction = await db.transaction("write");
  try {
    const orderResult = await transaction.execute({ sql: "SELECT id FROM orders WHERE id = ? LIMIT 1", args: [orderId] });
    if (orderResult.rows.length === 0) throw new Error("Order not found");
    const shipmentResult = await transaction.execute({ sql: "SELECT order_id FROM shipments WHERE id = ? AND provider = 'parcel2go' LIMIT 1", args: [shipmentId] });
    const shipment = shipmentResult.rows[0];
    if (!shipment) throw new Error("Parcel2Go delivery not found");
    const linkedOrderId = optionalString(shipment.order_id);
    if (linkedOrderId && linkedOrderId !== orderId) throw new Error("This Parcel2Go delivery is already linked to another order");
    await transaction.execute({ sql: "UPDATE shipments SET order_id = ?, updated_at = ? WHERE id = ?", args: [orderId, new Date().toISOString(), shipmentId] });
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  } finally {
    transaction.close();
  }
}

export async function recordParcel2GoWebhook(input: { externalEventId: string; topic: string }) {
  const db = await getTursoClient();
  const result = await db.execute({
    sql: `INSERT INTO webhook_events (id, provider, external_event_id, topic, received_at, processed_at, status)
          VALUES (?, 'parcel2go', ?, ?, ?, NULL, 'received')
          ON CONFLICT(provider, external_event_id) DO NOTHING`,
    args: [`parcel2go:${input.externalEventId}`, input.externalEventId, input.topic, new Date().toISOString()],
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

export async function createTikTokAdsOAuthState(input: { id: string; stateHash: string; expiresAt: string }) {
  const db = await getTursoClient();
  await db.execute({
    sql: `INSERT INTO tiktok_ads_oauth_states (id, state_hash, expires_at) VALUES (?, ?, ?)`,
    args: [input.id, input.stateHash, input.expiresAt],
  });
}

export async function consumeTikTokAdsOAuthState(stateHash: string) {
  const db = await getTursoClient();
  const now = new Date().toISOString();
  const result = await db.execute({
    sql: `UPDATE tiktok_ads_oauth_states SET used_at = ?
          WHERE state_hash = ? AND used_at IS NULL AND expires_at > ?`,
    args: [now, stateHash, now],
  });
  return result.rowsAffected > 0;
}

export type TikTokAdsConnection = {
  id: string;
  advertiserId: string;
  accessToken: string;
  refreshToken?: string;
  accessTokenExpiresAt?: string;
  refreshTokenExpiresAt?: string;
  authorizedAdvertiserIds: string[];
  grantedScopes: string[];
};

export type TikTokAdsConnectionState = {
  status: "not_configured" | "not_connected" | "connected" | "reconnect_required";
  advertiserId?: string;
  accessTokenExpiresAt?: string;
  refreshTokenExpiresAt?: string;
  updatedAt?: string;
  grantedScopes: string[];
};

export async function saveTikTokAdsConnection(input: TikTokAdsTokenBundle & { advertiserId: string }) {
  const db = await getTursoClient();
  const now = new Date().toISOString();
  const id = `tiktok-ads:${input.advertiserId}`;
  await db.execute({
    sql: `INSERT INTO tiktok_ads_connections
            (id, advertiser_id, access_token, refresh_token, access_token_expires_at,
             refresh_token_expires_at, authorized_advertiser_ids, granted_scopes, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
          ON CONFLICT(advertiser_id) DO UPDATE SET
            access_token = excluded.access_token,
            refresh_token = excluded.refresh_token,
            access_token_expires_at = excluded.access_token_expires_at,
            refresh_token_expires_at = excluded.refresh_token_expires_at,
            authorized_advertiser_ids = excluded.authorized_advertiser_ids,
            granted_scopes = excluded.granted_scopes,
            status = 'active',
            updated_at = excluded.updated_at`,
    args: [
      id,
      input.advertiserId,
      encryptTikTokToken(input.accessToken),
      input.refreshToken ? encryptTikTokToken(input.refreshToken) : null,
      input.accessTokenExpiresAt ?? null,
      input.refreshTokenExpiresAt ?? null,
      JSON.stringify(input.advertiserIds),
      JSON.stringify(input.grantedScopes),
      now,
      now,
    ] as SqlValue[],
  });
  return id;
}

export async function getActiveTikTokAdsConnection(): Promise<TikTokAdsConnection | null> {
  const db = await getTursoClient();
  const configuredAdvertiserId = process.env.TIKTOK_ADS_ADVERTISER_ID?.trim();
  const result = await db.execute({
    sql: `SELECT id, advertiser_id, access_token, refresh_token, access_token_expires_at,
                 refresh_token_expires_at, authorized_advertiser_ids, granted_scopes
          FROM tiktok_ads_connections
          WHERE status = 'active' ${configuredAdvertiserId ? "AND advertiser_id = ?" : ""}
          ORDER BY updated_at DESC LIMIT 1`,
    args: configuredAdvertiserId ? [configuredAdvertiserId] : [],
  });
  const row = result.rows[0];
  if (!row) return null;
  const accessToken = decryptTikTokToken(stringValue(row.access_token));
  const refreshToken = row.refresh_token === null || row.refresh_token === undefined
    ? undefined
    : decryptTikTokToken(stringValue(row.refresh_token));
  if (accessToken.needsEncryption || refreshToken?.needsEncryption) {
    await db.execute({
      sql: `UPDATE tiktok_ads_connections SET access_token = ?, refresh_token = ?, updated_at = ? WHERE id = ?`,
      args: [encryptTikTokToken(accessToken.value), refreshToken ? encryptTikTokToken(refreshToken.value) : null, new Date().toISOString(), stringValue(row.id)],
    });
  }
  return {
    id: stringValue(row.id),
    advertiserId: stringValue(row.advertiser_id),
    accessToken: accessToken.value,
    refreshToken: refreshToken?.value,
    accessTokenExpiresAt: optionalString(row.access_token_expires_at),
    refreshTokenExpiresAt: optionalString(row.refresh_token_expires_at),
    authorizedAdvertiserIds: stringArray(row.authorized_advertiser_ids),
    grantedScopes: stringArray(row.granted_scopes),
  };
}

export async function getTikTokAdsConnectionState(): Promise<TikTokAdsConnectionState> {
  const advertiserId = process.env.TIKTOK_ADS_ADVERTISER_ID?.trim();
  if (!hasTikTokAdsAppCredentials() || !advertiserId) return { status: "not_configured", grantedScopes: [] };
  const db = await getTursoClient();
  const result = await db.execute({
    sql: `SELECT advertiser_id, access_token_expires_at, refresh_token_expires_at, granted_scopes, status, updated_at
          FROM tiktok_ads_connections WHERE advertiser_id = ? LIMIT 1`,
    args: [advertiserId],
  });
  const row = result.rows[0];
  if (!row) return { status: "not_connected", advertiserId, grantedScopes: [] };
  return {
    status: stringValue(row.status) === "active" ? "connected" : "reconnect_required",
    advertiserId: stringValue(row.advertiser_id),
    accessTokenExpiresAt: optionalString(row.access_token_expires_at),
    refreshTokenExpiresAt: optionalString(row.refresh_token_expires_at),
    updatedAt: optionalString(row.updated_at),
    grantedScopes: stringArray(row.granted_scopes),
  };
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
      encryptTikTokToken(input.accessToken),
      encryptTikTokToken(input.refreshToken),
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
  const legacyTokenUpdates: Array<{ sql: string; args: SqlValue[] }> = [];
  const connections = result.rows.map((row) => {
    const id = stringValue(row.id);
    const accessToken = decryptTikTokToken(stringValue(row.access_token));
    const refreshToken = decryptTikTokToken(stringValue(row.refresh_token));
    if (accessToken.needsEncryption || refreshToken.needsEncryption) {
      legacyTokenUpdates.push({
        sql: `UPDATE tiktok_connections SET access_token = ?, refresh_token = ?, updated_at = ? WHERE id = ?`,
        args: [encryptTikTokToken(accessToken.value), encryptTikTokToken(refreshToken.value), new Date().toISOString(), id],
      });
    }
    return {
      id,
      shopId: optionalString(row.shop_id),
      shopCipher: optionalString(row.shop_cipher),
      openId: optionalString(row.open_id),
      accessToken: accessToken.value,
      refreshToken: refreshToken.value,
      accessTokenExpiresAt: optionalString(row.access_token_expires_at),
      refreshTokenExpiresAt: optionalString(row.refresh_token_expires_at),
      grantedScopes: stringArray(row.granted_scopes),
    };
  }).filter((connection) => Boolean(connection.id && connection.accessToken && connection.refreshToken));
  if (legacyTokenUpdates.length) await db.batch(legacyTokenUpdates, "write");
  return connections;
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
  grantedScopes?: string[];
}) {
  const db = await getTursoClient();
  await db.execute({
    sql: `UPDATE tiktok_connections
          SET access_token = ?, refresh_token = ?, access_token_expires_at = ?, refresh_token_expires_at = ?,
              granted_scopes = COALESCE(?, granted_scopes),
              status = 'active', updated_at = ?
          WHERE id = ?`,
    args: [
      encryptTikTokToken(input.accessToken),
      encryptTikTokToken(input.refreshToken),
      input.accessTokenExpiresAt ?? null,
      input.refreshTokenExpiresAt ?? null,
      input.grantedScopes ? JSON.stringify(input.grantedScopes) : null,
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

export type TikTokSyncStream = "orders" | "after_sales_cancel" | "after_sales_return";

export async function getTikTokSyncCursor(input: { connectionId: string; shopId: string; stream: TikTokSyncStream }) {
  const db = await getTursoClient();
  const result = await db.execute({
    sql: `SELECT cursor_at FROM tiktok_sync_cursors
          WHERE connection_id = ? AND shop_id = ? AND stream = ? LIMIT 1`,
    args: [input.connectionId, input.shopId, input.stream],
  });
  return optionalString(result.rows[0]?.cursor_at);
}

export async function advanceTikTokSyncCursor(input: {
  connectionId: string;
  shopId: string;
  stream: TikTokSyncStream;
  cursorAt: string;
}) {
  const db = await getTursoClient();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO tiktok_sync_cursors (connection_id, shop_id, stream, cursor_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(connection_id, shop_id, stream) DO UPDATE SET
            cursor_at = CASE WHEN excluded.cursor_at > tiktok_sync_cursors.cursor_at THEN excluded.cursor_at ELSE tiktok_sync_cursors.cursor_at END,
            updated_at = excluded.updated_at`,
    args: [input.connectionId, input.shopId, input.stream, input.cursorAt, now],
  });
}

/** Affiliate reporting has its own cursor because provider records are not ordinary TikTok order events. */
export async function getTikTokAffiliateSyncCursor(input: { connectionId: string; shopId: string }) {
  const db = await getTursoClient();
  const result = await db.execute({
    sql: `SELECT cursor_at FROM tiktok_affiliate_sync_status
          WHERE connection_id = ? AND shop_id = ? LIMIT 1`,
    args: [input.connectionId, input.shopId],
  });
  return optionalString(result.rows[0]?.cursor_at);
}

export async function advanceTikTokAffiliateSyncCursor(input: { connectionId: string; shopId: string; cursorAt: string }) {
  const db = await getTursoClient();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO tiktok_affiliate_sync_status (connection_id, shop_id, cursor_at, last_attempted_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(connection_id, shop_id) DO UPDATE SET
            cursor_at = CASE WHEN tiktok_affiliate_sync_status.cursor_at IS NULL OR excluded.cursor_at > tiktok_affiliate_sync_status.cursor_at THEN excluded.cursor_at ELSE tiktok_affiliate_sync_status.cursor_at END,
            last_attempted_at = excluded.last_attempted_at,
            updated_at = excluded.updated_at`,
    args: [input.connectionId, input.shopId, input.cursorAt, now, now],
  });
}

export type TikTokAffiliateOrderRecord = {
  id: string;
  connectionId: string;
  shopId: string;
  sourceOrderId: string;
  sourceLineItemId: string;
  sourceProductId?: string;
  sourceSkuId?: string;
  productTitle?: string;
  creatorOpenId?: string;
  creatorUsername?: string;
  quantity: number;
  grossAmountMinor: number;
  estimatedCommissionMinor: number;
  currency: string;
  status?: string;
  sourceCreatedAt?: string;
  sourceUpdatedAt?: string;
};

/** Saves TikTok's affiliate authority records; ordinary TikTok orders remain separate. */
export async function saveTikTokAffiliateOrders(records: TikTokAffiliateOrderRecord[]) {
  if (records.length === 0) return 0;
  const db = await getTursoClient();
  const now = new Date().toISOString();
  await db.batch(records.map((record) => ({
    sql: `INSERT INTO tiktok_affiliate_orders
      (id, connection_id, shop_id, source_order_id, source_line_item_id, source_product_id, source_sku_id,
       product_title, creator_open_id, creator_username, quantity, gross_amount_minor, estimated_commission_minor,
       currency, status, source_created_at, source_updated_at, imported_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(shop_id, source_order_id, source_line_item_id) DO UPDATE SET
        source_product_id=excluded.source_product_id, source_sku_id=excluded.source_sku_id, product_title=excluded.product_title,
        creator_open_id=excluded.creator_open_id, creator_username=excluded.creator_username, quantity=excluded.quantity,
        gross_amount_minor=excluded.gross_amount_minor, estimated_commission_minor=excluded.estimated_commission_minor,
        currency=excluded.currency, status=excluded.status, source_created_at=excluded.source_created_at,
        source_updated_at=excluded.source_updated_at, imported_at=excluded.imported_at, updated_at=excluded.updated_at
      WHERE ${changed("tiktok_affiliate_orders", [
        "source_product_id", "source_sku_id", "product_title", "creator_open_id", "creator_username",
        "quantity", "gross_amount_minor", "estimated_commission_minor", "currency", "status",
        "source_created_at", "source_updated_at",
      ])}`,
    args: [
      record.id, record.connectionId, record.shopId, record.sourceOrderId, record.sourceLineItemId,
      record.sourceProductId ?? null, record.sourceSkuId ?? null, record.productTitle ?? null,
      record.creatorOpenId ?? null, record.creatorUsername ?? null, record.quantity, record.grossAmountMinor,
      record.estimatedCommissionMinor, record.currency, record.status ?? null, record.sourceCreatedAt ?? null,
      record.sourceUpdatedAt ?? null, now, now,
    ],
  })), "write");
  return records.length;
}

export type TikTokAffiliateVideoRecord = {
  id: string;
  connectionId: string;
  shopId: string;
  sourceVideoId: string;
  sourceProductId?: string;
  creatorOpenId?: string;
  creatorUsername?: string;
  videoTitle?: string;
  publishedAt?: string;
  grossAmountMinor: number;
  attributedOrderCount: number;
  currency: string;
  sourceUpdatedAt?: string;
};

export async function saveTikTokAffiliateVideos(records: TikTokAffiliateVideoRecord[]) {
  if (records.length === 0) return 0;
  const db = await getTursoClient();
  const now = new Date().toISOString();
  await db.batch(records.map((record) => ({
    sql: `INSERT INTO tiktok_affiliate_videos
      (id, connection_id, shop_id, source_video_id, source_product_id, creator_open_id, creator_username,
       video_title, published_at, gross_amount_minor, attributed_order_count, currency, source_updated_at, imported_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(shop_id, source_video_id) DO UPDATE SET
        source_product_id=excluded.source_product_id, creator_open_id=excluded.creator_open_id,
        creator_username=excluded.creator_username, video_title=excluded.video_title, published_at=excluded.published_at,
        gross_amount_minor=excluded.gross_amount_minor, attributed_order_count=excluded.attributed_order_count,
        currency=excluded.currency, source_updated_at=excluded.source_updated_at, imported_at=excluded.imported_at,
        updated_at=excluded.updated_at
      WHERE ${changed("tiktok_affiliate_videos", [
        "source_product_id", "creator_open_id", "creator_username", "video_title", "published_at",
        "gross_amount_minor", "attributed_order_count", "currency", "source_updated_at",
      ])}`,
    args: [
      record.id, record.connectionId, record.shopId, record.sourceVideoId, record.sourceProductId ?? null,
      record.creatorOpenId ?? null, record.creatorUsername ?? null, record.videoTitle ?? null, record.publishedAt ?? null,
      record.grossAmountMinor, record.attributedOrderCount, record.currency, record.sourceUpdatedAt ?? null, now, now,
    ],
  })), "write");
  return records.length;
}

export async function recordTikTokAffiliateSyncSuccess(input: {
  connectionId: string;
  shopId: string;
  initialBaseline: boolean;
}) {
  const db = await getTursoClient();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO tiktok_affiliate_sync_status
      (connection_id, shop_id, last_successful_at, last_attempted_at, last_error_at, last_error_message,
       initial_baseline_started_at, initial_baseline_completed_at, updated_at)
      VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?)
      ON CONFLICT(connection_id, shop_id) DO UPDATE SET
        last_successful_at=excluded.last_successful_at, last_attempted_at=excluded.last_attempted_at,
        last_error_at=NULL, last_error_message=NULL,
        initial_baseline_started_at=COALESCE(tiktok_affiliate_sync_status.initial_baseline_started_at, excluded.initial_baseline_started_at),
        initial_baseline_completed_at=COALESCE(tiktok_affiliate_sync_status.initial_baseline_completed_at, excluded.initial_baseline_completed_at),
        updated_at=excluded.updated_at`,
    args: [input.connectionId, input.shopId, now, now, input.initialBaseline ? now : null, input.initialBaseline ? now : null, now],
  });
}

/** Failure status never clears the last successful snapshot or its data. */
export async function recordTikTokAffiliateSyncFailure(input: { connectionId: string; shopId: string; message: string }) {
  const db = await getTursoClient();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO tiktok_affiliate_sync_status
      (connection_id, shop_id, last_attempted_at, last_error_at, last_error_message, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(connection_id, shop_id) DO UPDATE SET
        last_attempted_at=excluded.last_attempted_at, last_error_at=excluded.last_error_at,
        last_error_message=excluded.last_error_message, updated_at=excluded.updated_at`,
    args: [input.connectionId, input.shopId, now, now, input.message.slice(0, 500), now],
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
          VALUES (?, 'tiktok', ?, ?, ?, NULL, 'received')
          ON CONFLICT(provider, external_event_id) DO NOTHING`,
    args: [`tiktok:${input.externalEventId}`, input.externalEventId, input.topic, now],
  });
  return result.rowsAffected > 0;
}

export async function markWebhookEventsProcessed(input: { before: string; providers?: Array<"tiktok" | "parcel2go"> }) {
  const db = await getTursoClient();
  const providers = input.providers ?? ["tiktok", "parcel2go"];
  if (!providers.length) return;
  const placeholders = providers.map(() => "?").join(", ");
  await db.execute({
    sql: `UPDATE webhook_events SET status = 'processed', processed_at = ?
          WHERE status = 'received' AND received_at <= ? AND provider IN (${placeholders})`,
    args: [new Date().toISOString(), input.before, ...providers],
  });
}

function shopifyOrderAdminUrl(sourceOrderId: string) {
  const orderId = sourceOrderId.match(/(\d+)$/)?.[1];
  const storeDomain = process.env.SHOPIFY_STORE_DOMAIN?.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!orderId || !storeDomain) return undefined;
  return `https://${storeDomain}/admin/orders/${orderId}`;
}

export async function getPackagingInventory(): Promise<PackagingMaterial[]> {
  const db = await getTursoClient();
  const result = await db.execute(`
    SELECT id, title, quantity, reorder_point, lead_time_days, updated_at
    FROM packaging_materials
    WHERE active = 1
    ORDER BY title
  `);
  return result.rows.map((row) => ({
    id: stringValue(row.id),
    title: stringValue(row.title),
    quantity: numberValue(row.quantity),
    reorderPoint: numberValue(row.reorder_point),
    leadTimeDays: nullableNumber(row.lead_time_days),
    updatedBy: "Operations",
    updatedAt: stringValue(row.updated_at),
  }));
}

/** @deprecated The legacy Shopify-mirror view. Use physical inventory readers instead. */
export async function getInventory(): Promise<InventorySnapshot> {
  const db = await getTursoClient();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [variantsResult, packagingResult, salesResult, alertsResult, movementsResult, sync] = await Promise.all([
    db.execute(`
      SELECT v.id, v.product_id, p.title AS product, v.title AS variant, v.sku, v.available_quantity,
        v.reorder_point, v.lead_time_days, v.packaging_type, v.units_per_box,
        COALESCE((SELECT m.status FROM channel_mappings m WHERE m.variant_id = v.id AND m.channel = 'tiktok' AND m.active = 1 ORDER BY m.last_checked_at DESC LIMIT 1), 'unmapped') AS mapping,
        COALESCE((SELECT m.confidence FROM channel_mappings m WHERE m.variant_id = v.id AND m.channel = 'tiktok' AND m.active = 1 ORDER BY m.last_checked_at DESC LIMIT 1), '') AS mapping_confidence
      FROM variants v
      JOIN products p ON p.id = v.product_id
      ORDER BY p.title, v.title
    `),
    db.execute(`SELECT id, title, quantity, reorder_point, lead_time_days, updated_at FROM packaging_materials WHERE active = 1 ORDER BY title`),
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
    getLatestSync(),
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

  return { products, packaging, alerts, recentMovements, sync };
}

function packagingQuantity(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Packaging quantity must be a whole number of zero or more");
  return value;
}

function packagingTitle(value: string) {
  const title = value.trim();
  if (title.length < 2) throw new Error("Packaging name must be at least 2 characters");
  if (title.length > 80) throw new Error("Packaging name must be 80 characters or fewer");
  return title;
}

export async function createPackagingMaterial(input: { title: string; quantity: number }) {
  const db = await getTursoClient();
  const title = packagingTitle(input.title);
  const quantity = packagingQuantity(input.quantity);
  const existing = await db.execute({ sql: "SELECT id FROM packaging_materials WHERE lower(title) = lower(?) AND active = 1 LIMIT 1", args: [title] });
  if (existing.rows[0]) throw new Error("PACKAGING_ALREADY_EXISTS");
  const id = `packaging_${randomUUID()}`;
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO packaging_materials (id, title, quantity, reorder_point, lead_time_days, active, updated_at)
          VALUES (?, ?, ?, 0, NULL, 1, ?)`,
    args: [id, title, quantity, now],
  });
  return { id, title, quantity };
}

export async function updatePackagingMaterial(input: { id: string; title: string; quantity: number; actor: string }) {
  const db = await getTursoClient();
  const title = packagingTitle(input.title);
  const quantity = packagingQuantity(input.quantity);
  const transaction = await db.transaction("write");
  const now = new Date().toISOString();
  try {
    const existing = await transaction.execute({ sql: "SELECT title, quantity FROM packaging_materials WHERE id = ? AND active = 1 LIMIT 1", args: [input.id] });
    const row = existing.rows[0];
    if (!row) throw new Error("PACKAGING_NOT_FOUND");
    const duplicate = await transaction.execute({ sql: "SELECT id FROM packaging_materials WHERE lower(title) = lower(?) AND id <> ? AND active = 1 LIMIT 1", args: [title, input.id] });
    if (duplicate.rows[0]) throw new Error("PACKAGING_ALREADY_EXISTS");
    const previousTitle = stringValue(row.title);
    const previousQuantity = numberValue(row.quantity);
    await transaction.execute({ sql: "UPDATE packaging_materials SET title = ?, quantity = ?, updated_at = ? WHERE id = ?", args: [title, quantity, now, input.id] });
    if (previousTitle !== title) {
      await transaction.execute({ sql: "UPDATE variants SET packaging_type = ? WHERE packaging_type = ?", args: [title, previousTitle] });
      await transaction.execute({ sql: "UPDATE physical_inventory_items SET packaging_type = ? WHERE packaging_type = ?", args: [title, previousTitle] });
      await transaction.execute({ sql: "UPDATE bundle_components SET packaging_type = ? WHERE packaging_type = ?", args: [title, previousTitle] });
    }
    if (previousQuantity !== quantity) {
      await transaction.execute({
        sql: `INSERT INTO stock_movements (id, packaging_material_id, quantity_delta, reason, actor_name, source, reference_id, created_at)
              VALUES (?, ?, ?, 'manual_edit', ?, 'manual', ?, ?)`,
        args: [randomUUID(), input.id, quantity - previousQuantity, input.actor, `packaging:${input.id}`, now],
      });
    }
    await transaction.commit();
    return { before: previousQuantity, after: quantity };
  } catch (error) {
    await transaction.rollback();
    throw error;
  } finally {
    transaction.close();
  }
}

export async function deletePackagingMaterial(input: { id: string; actor: string }) {
  const db = await getTursoClient();
  const transaction = await db.transaction("write");
  const now = new Date().toISOString();
  try {
    const existing = await transaction.execute({ sql: "SELECT title FROM packaging_materials WHERE id = ? AND active = 1 LIMIT 1", args: [input.id] });
    if (!existing.rows[0]) throw new Error("PACKAGING_NOT_FOUND");
    const title = stringValue(existing.rows[0].title);
    await transaction.execute({ sql: "UPDATE packaging_materials SET active = 0, updated_at = ? WHERE id = ?", args: [now, input.id] });
    await transaction.execute({ sql: "UPDATE variants SET packaging_type = NULL WHERE packaging_type = ?", args: [title] });
    await transaction.execute({ sql: "UPDATE physical_inventory_items SET packaging_type = NULL WHERE packaging_type = ?", args: [title] });
    await transaction.execute({ sql: "UPDATE bundle_components SET packaging_type = NULL WHERE packaging_type = ?", args: [title] });
    await transaction.commit();
    return { title };
  } catch (error) {
    await transaction.rollback();
    throw error;
  } finally {
    transaction.close();
  }
}

const LEDGER_TONES = ["blush", "smoke", "taupe", "amber", "rose"] as const;

/** Canonical physical stock only. Shopify and TikTok listings are intentionally excluded. */
export async function getPhysicalInventory(): Promise<PhysicalInventoryItem[]> {
  const db = await getTursoClient();
  const [result, variantResult] = await Promise.all([db.execute(`SELECT pi.id, pi.title, pi.variant_label, pi.quantity, pi.quantity_known, pi.packaging_type, pi.reorder_point, pi.lead_time_days,
                                          p.image_url,
                                          COUNT(piv.id) AS variant_count,
                                          SUM(piv.quantity) AS variant_quantity,
                                          MIN(piv.quantity_known) AS variants_known
                                   FROM physical_inventory_items pi
                                   LEFT JOIN physical_inventory_variants piv ON piv.physical_item_id = pi.id AND piv.active = 1
                                   LEFT JOIN products p ON p.shopify_product_id = pi.shopify_product_id
                                   WHERE pi.active = 1
                                   GROUP BY pi.id
                                   ORDER BY pi.title, pi.variant_label`), db.execute(`SELECT piv.id, piv.physical_item_id, piv.title, piv.sku, piv.quantity, piv.quantity_known
                                                                                     FROM physical_inventory_variants piv
                                                                                     JOIN physical_inventory_items pi ON pi.id = piv.physical_item_id
                                                                                     WHERE pi.active = 1 AND piv.active = 1
                                                                                     ORDER BY piv.physical_item_id, piv.sort_order, piv.title`)]);
  const variantsByItem = new Map<string, { id: string; title: string; sku: string; quantity: number; quantityKnown: boolean }[]>();
  for (const variant of variantResult.rows) {
    const itemId = stringValue(variant.physical_item_id);
    const itemVariants = variantsByItem.get(itemId) ?? [];
    itemVariants.push({ id: stringValue(variant.id), title: stringValue(variant.title), sku: stringValue(variant.sku), quantity: numberValue(variant.quantity), quantityKnown: numberValue(variant.quantity_known) === 1 });
    variantsByItem.set(itemId, itemVariants);
  }
  return result.rows.map((row, index) => ({
    id: stringValue(row.id),
    title: stringValue(row.title),
    variantLabel: stringValue(row.variant_label),
    quantity: numberValue(row.variant_count) > 0 ? numberValue(row.variant_quantity) : numberValue(row.quantity),
    quantityKnown: numberValue(row.variant_count) > 0 ? numberValue(row.variants_known) === 1 : numberValue(row.quantity_known) === 1,
    variantCount: numberValue(row.variant_count),
    packagingType: stringValue(row.packaging_type) || "Not set",
    reorderPoint: numberValue(row.reorder_point),
    leadTimeDays: nullableNumber(row.lead_time_days),
    imageUrl: stringValue(row.image_url) || null,
    imageTone: LEDGER_TONES[index % LEDGER_TONES.length],
    variants: variantsByItem.get(stringValue(row.id)) ?? [],
  }));
}

export async function getPhysicalProductDetail(id: string): Promise<PhysicalProductDetail | null> {
  const db = await getTursoClient();
  const item = await db.execute({
    sql: `SELECT pi.id, pi.title, pi.variant_label, pi.description, pi.quantity, pi.quantity_known, pi.packaging_type, pi.reorder_point, pi.lead_time_days, pi.source_label,
                 p.image_url
          FROM physical_inventory_items pi
          LEFT JOIN products p ON p.shopify_product_id = pi.shopify_product_id
          WHERE pi.id = ? AND pi.active = 1`,
    args: [id],
  });
  const row = item.rows[0];
  if (!row) return null;
  const variants = await db.execute({ sql: "SELECT id, title, sku, quantity, quantity_known FROM physical_inventory_variants WHERE physical_item_id = ? AND active = 1 ORDER BY sort_order, title", args: [id] });
  const variantRows = variants.rows.map((variant) => ({ id: stringValue(variant.id), title: stringValue(variant.title), sku: stringValue(variant.sku), quantity: numberValue(variant.quantity), quantityKnown: numberValue(variant.quantity_known) === 1 }));
  return {
    id: stringValue(row.id),
    title: stringValue(row.title),
    variantLabel: stringValue(row.variant_label),
    quantity: variantRows.reduce((total, variant) => total + variant.quantity, 0),
    quantityKnown: variantRows.length > 0 && variantRows.every((variant) => variant.quantityKnown),
    variantCount: variantRows.length,
    packagingType: stringValue(row.packaging_type) || "Not set",
    reorderPoint: numberValue(row.reorder_point),
    leadTimeDays: nullableNumber(row.lead_time_days),
    imageUrl: stringValue(row.image_url) || null,
    imageTone: "blush",
    description: stringValue(row.description) || "No product description has been added yet.",
    sourceLabel: stringValue(row.source_label) || "Individual catalogue",
    variants: variantRows,
  };
}

/**
 * Returns recent mapped sell-through for a master product. It deliberately
 * reads historical order lines, rather than only post-cutover inventory
 * applications, and expands exact listing recipes so bundle components count.
 */
export async function getPhysicalProductRunway(id: string): Promise<PhysicalInventoryRunway> {
  const db = await getTursoClient();
  const now = new Date();
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - 89);
  start.setUTCHours(0, 0, 0, 0);
  const dates = Array.from({ length: 90 }, (_, index) => {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + index);
    return day.toISOString().slice(0, 10);
  });
  const sales = await db.execute({
    sql: `WITH shopify_reversals AS (
            SELECT order_id, source_line_item_id, SUM(quantity) AS quantity
            FROM shopify_refund_line_items
            WHERE restocked = 1
            GROUP BY order_id, source_line_item_id
          ), tiktok_reversals AS (
            SELECT order_id, source_line_item_id, SUM(quantity) AS quantity
            FROM tiktok_after_sales_line_items
            WHERE (event_type = 'cancel' AND status IN ('CANCELLATION_REQUEST_SUCCESS', 'CANCELLATION_REQUEST_COMPLETE'))
               OR (event_type = 'return' AND return_type = 'RETURN_AND_REFUND'
                   AND status IN ('RETURN_OR_REFUND_REQUEST_SUCCESS', 'RETURN_OR_REFUND_REQUEST_COMPLETE'))
            GROUP BY order_id, source_line_item_id
          )
          SELECT date(o.source_created_at) AS sale_date, o.source,
                 SUM(MAX(0, oi.quantity - COALESCE(CASE WHEN o.source = 'shopify' THEN shopify_reversals.quantity ELSE tiktok_reversals.quantity END, 0)) * c.quantity_per_sale) AS units
          FROM order_items oi
          JOIN orders o ON o.id = oi.order_id
          JOIN physical_channel_listings l
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
          JOIN physical_listing_components c ON c.listing_id = l.id
          JOIN physical_inventory_variants variant ON variant.id = c.physical_variant_id
          LEFT JOIN shopify_reversals ON shopify_reversals.order_id = oi.order_id
            AND shopify_reversals.source_line_item_id = oi.source_line_item_id
          LEFT JOIN tiktok_reversals ON tiktok_reversals.order_id = oi.order_id
            AND tiktok_reversals.source_line_item_id = oi.source_line_item_id
          WHERE variant.physical_item_id = ? AND o.cancelled_at IS NULL
            AND date(o.source_created_at) >= date(?)
          GROUP BY date(o.source_created_at), o.source`,
    args: [id, start.toISOString()],
  });
  const salesByDate = new Map<string, { shopify: number; tiktok: number }>();
  for (const row of sales.rows) {
    const date = stringValue(row.sale_date);
    if (!date) continue;
    const entry = salesByDate.get(date) ?? { shopify: 0, tiktok: 0 };
    const units = numberValue(row.units);
    if (stringValue(row.source) === "tiktok") entry.tiktok += units;
    else entry.shopify += units;
    salesByDate.set(date, entry);
  }
  return {
    daysAvailable: dates.length,
    generatedAt: now.toISOString(),
    dailySales: dates.map((date) => {
      const entry = salesByDate.get(date);
      return {
        date,
        shopify: Math.max(0, entry?.shopify ?? 0),
        tiktok: Math.max(0, entry?.tiktok ?? 0),
      };
    }),
  };
}

/**
 * Returns the same mapped sell-through for every active physical product in
 * one query. Bundles are expanded through their component recipes, so the
 * inventory table remains consistent with the product-detail runway.
 */
export async function getPhysicalInventoryRunways(): Promise<PhysicalInventoryRunways> {
  const db = await getTursoClient();
  const now = new Date();
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - 89);
  start.setUTCHours(0, 0, 0, 0);
  const dates = Array.from({ length: 90 }, (_, index) => {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + index);
    return day.toISOString().slice(0, 10);
  });
  const sales = await db.execute({
    sql: `WITH shopify_reversals AS (
            SELECT order_id, source_line_item_id, SUM(quantity) AS quantity
            FROM shopify_refund_line_items
            WHERE restocked = 1
            GROUP BY order_id, source_line_item_id
          ), tiktok_reversals AS (
            SELECT order_id, source_line_item_id, SUM(quantity) AS quantity
            FROM tiktok_after_sales_line_items
            WHERE (event_type = 'cancel' AND status IN ('CANCELLATION_REQUEST_SUCCESS', 'CANCELLATION_REQUEST_COMPLETE'))
               OR (event_type = 'return' AND return_type = 'RETURN_AND_REFUND'
                   AND status IN ('RETURN_OR_REFUND_REQUEST_SUCCESS', 'RETURN_OR_REFUND_REQUEST_COMPLETE'))
            GROUP BY order_id, source_line_item_id
          )
          SELECT variant.physical_item_id, date(o.source_created_at) AS sale_date, o.source,
                 SUM(MAX(0, oi.quantity - COALESCE(CASE WHEN o.source = 'shopify' THEN shopify_reversals.quantity ELSE tiktok_reversals.quantity END, 0)) * c.quantity_per_sale) AS units
          FROM order_items oi
          JOIN orders o ON o.id = oi.order_id
          JOIN physical_channel_listings l
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
          JOIN physical_listing_components c ON c.listing_id = l.id
          JOIN physical_inventory_variants variant ON variant.id = c.physical_variant_id
          JOIN physical_inventory_items item ON item.id = variant.physical_item_id AND item.active = 1
          LEFT JOIN shopify_reversals ON shopify_reversals.order_id = oi.order_id
            AND shopify_reversals.source_line_item_id = oi.source_line_item_id
          LEFT JOIN tiktok_reversals ON tiktok_reversals.order_id = oi.order_id
            AND tiktok_reversals.source_line_item_id = oi.source_line_item_id
          WHERE o.cancelled_at IS NULL AND date(o.source_created_at) >= date(?)
          GROUP BY variant.physical_item_id, date(o.source_created_at), o.source`,
    args: [start.toISOString()],
  });
  const salesByItem = new Map<string, Map<string, { shopify: number; tiktok: number }>>();
  for (const row of sales.rows) {
    const itemId = stringValue(row.physical_item_id);
    const date = stringValue(row.sale_date);
    if (!itemId || !date) continue;
    const salesByDate = salesByItem.get(itemId) ?? new Map<string, { shopify: number; tiktok: number }>();
    const entry = salesByDate.get(date) ?? { shopify: 0, tiktok: 0 };
    const units = numberValue(row.units);
    if (stringValue(row.source) === "tiktok") entry.tiktok += units;
    else entry.shopify += units;
    salesByDate.set(date, entry);
    salesByItem.set(itemId, salesByDate);
  }
  return Object.fromEntries([...salesByItem.entries()].map(([itemId, salesByDate]) => [itemId, {
    daysAvailable: dates.length,
    generatedAt: now.toISOString(),
    dailySales: dates.map((date) => {
      const entry = salesByDate.get(date);
      return { date, shopify: Math.max(0, entry?.shopify ?? 0), tiktok: Math.max(0, entry?.tiktok ?? 0) };
    }),
  }]));
}

export async function updatePhysicalProduct(input: { itemId: string; title: string }) {
  const db = await getTursoClient();
  const title = input.title.trim();
  const transaction = await db.transaction("write");
  try {
    const item = await transaction.execute({ sql: "SELECT id FROM physical_inventory_items WHERE id = ? AND active = 1", args: [input.itemId] });
    if (!item.rows[0]) throw new Error("Physical inventory item not found");
    const duplicate = await transaction.execute({ sql: "SELECT id FROM physical_inventory_items WHERE lower(title) = lower(?) AND id <> ? AND active = 1", args: [title, input.itemId] });
    if (duplicate.rows[0]) throw new Error("A master product with this name already exists");
    await transaction.execute({ sql: "UPDATE physical_inventory_items SET title = ?, updated_at = ? WHERE id = ?", args: [title, new Date().toISOString(), input.itemId] });
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  } finally {
    transaction.close();
  }
  return getPhysicalProductDetail(input.itemId);
}

export async function addPhysicalInventoryVariant(input: { itemId: string; title: string; sku?: string | null }) {
  const db = await getTursoClient();
  const title = input.title.trim();
  const sku = input.sku?.trim() || null;
  const transaction = await db.transaction("write");
  try {
    const item = await transaction.execute({ sql: "SELECT id, variant_label FROM physical_inventory_items WHERE id = ? AND active = 1", args: [input.itemId] });
    if (!item.rows[0]) throw new Error("Physical inventory item not found");
    const duplicate = await transaction.execute({ sql: "SELECT id FROM physical_inventory_variants WHERE physical_item_id = ? AND lower(title) = lower(?) AND active = 1", args: [input.itemId, title] });
    if (duplicate.rows[0]) throw new Error("A variant with this name already exists");
    const sortOrder = await transaction.execute({ sql: "SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_sort_order FROM physical_inventory_variants WHERE physical_item_id = ?", args: [input.itemId] });
    const variantId = `${input.itemId}-variant-${randomUUID()}`;
    const now = new Date().toISOString();
    await transaction.execute({
      sql: "INSERT INTO physical_inventory_variants (id, physical_item_id, title, sku, quantity, quantity_known, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?)",
      args: [variantId, input.itemId, title, sku, numberValue(sortOrder.rows[0]?.next_sort_order), now, now],
    });
    const countResult = await transaction.execute({ sql: "SELECT COUNT(*) AS variant_count FROM physical_inventory_variants WHERE physical_item_id = ?", args: [input.itemId] });
    const count = numberValue(countResult.rows[0]?.variant_count);
    const previousLabel = stringValue(item.rows[0].variant_label);
    const label = count === 1 ? title : /shades?$/i.test(previousLabel) ? `${count} shades` : `${count} variants`;
    await transaction.execute({ sql: "UPDATE physical_inventory_items SET variant_label = ?, quantity_known = 0, updated_at = ? WHERE id = ?", args: [label, now, input.itemId] });
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  } finally {
    transaction.close();
  }
  return getPhysicalProductDetail(input.itemId);
}

export async function updatePhysicalInventoryVariant(input: { variantId: string; title: string; sku?: string | null }) {
  const db = await getTursoClient();
  const title = input.title.trim();
  const sku = input.sku?.trim() || null;
  const transaction = await db.transaction("write");
  let itemId = "";
  try {
    const variant = await transaction.execute({ sql: "SELECT physical_item_id FROM physical_inventory_variants WHERE id = ? AND active = 1", args: [input.variantId] });
    if (!variant.rows[0]) throw new Error("Physical inventory variant not found");
    itemId = stringValue(variant.rows[0].physical_item_id);
    const duplicate = await transaction.execute({ sql: "SELECT id FROM physical_inventory_variants WHERE physical_item_id = ? AND lower(title) = lower(?) AND id <> ? AND active = 1", args: [itemId, title, input.variantId] });
    if (duplicate.rows[0]) throw new Error("A variant with this name already exists");
    const now = new Date().toISOString();
    await transaction.execute({ sql: "UPDATE physical_inventory_variants SET title = ?, sku = ?, updated_at = ? WHERE id = ?", args: [title, sku, now, input.variantId] });
    const count = await transaction.execute({ sql: "SELECT COUNT(*) AS variant_count FROM physical_inventory_variants WHERE physical_item_id = ? AND active = 1", args: [itemId] });
    if (numberValue(count.rows[0]?.variant_count) === 1) await transaction.execute({ sql: "UPDATE physical_inventory_items SET variant_label = ?, updated_at = ? WHERE id = ?", args: [title, now, itemId] });
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  } finally {
    transaction.close();
  }
  return getPhysicalProductDetail(itemId);
}

export async function deletePhysicalInventoryVariant(variantId: string) {
  const db = await getTursoClient();
  const transaction = await db.transaction("write");
  let itemId = "";
  try {
    const variant = await transaction.execute({ sql: "SELECT physical_item_id FROM physical_inventory_variants WHERE id = ? AND active = 1", args: [variantId] });
    if (!variant.rows[0]) throw new Error("Physical inventory variant not found");
    itemId = stringValue(variant.rows[0].physical_item_id);
    const mappings = await transaction.execute({ sql: "SELECT COUNT(*) AS mapping_count FROM physical_listing_components WHERE physical_variant_id = ?", args: [variantId] });
    if (numberValue(mappings.rows[0]?.mapping_count) > 0) throw new Error("Remove this variant's channel mappings before deleting it");
    const formulaOutputs = await transaction.execute({ sql: "SELECT COUNT(*) AS output_count FROM lab_formula_outputs WHERE physical_variant_id = ? AND active = 1", args: [variantId] });
    if (numberValue(formulaOutputs.rows[0]?.output_count) > 0) throw new Error("Remove this variant's Labs formula output link before deleting it");
    const remaining = await transaction.execute({ sql: "SELECT COUNT(*) AS variant_count FROM physical_inventory_variants WHERE physical_item_id = ? AND active = 1", args: [itemId] });
    if (numberValue(remaining.rows[0]?.variant_count) <= 1) throw new Error("A product must keep at least one variant");
    const now = new Date().toISOString();
    await transaction.execute({ sql: "UPDATE physical_inventory_variants SET active = 0, updated_at = ? WHERE id = ?", args: [now, variantId] });
    await transaction.execute({ sql: "UPDATE physical_inventory_items SET quantity = COALESCE((SELECT SUM(quantity) FROM physical_inventory_variants WHERE physical_item_id = ? AND active = 1), 0), quantity_known = CASE WHEN EXISTS (SELECT 1 FROM physical_inventory_variants WHERE physical_item_id = ? AND active = 1 AND quantity_known = 0) THEN 0 ELSE 1 END, variant_label = ?, updated_at = ? WHERE id = ?", args: [itemId, itemId, `${numberValue(remaining.rows[0]?.variant_count) - 1} variants`, now, itemId] });
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  } finally {
    transaction.close();
  }
  return getPhysicalProductDetail(itemId);
}

export async function deletePhysicalProduct(itemId: string) {
  const db = await getTursoClient();
  const transaction = await db.transaction("write");
  try {
    const item = await transaction.execute({ sql: "SELECT id FROM physical_inventory_items WHERE id = ? AND active = 1", args: [itemId] });
    if (!item.rows[0]) throw new Error("Physical inventory item not found");
    const componentMappings = await transaction.execute({
      sql: "SELECT COUNT(*) AS mapping_count FROM physical_listing_components c JOIN physical_inventory_variants v ON v.id = c.physical_variant_id WHERE v.physical_item_id = ?",
      args: [itemId],
    });
    const productMappings = await transaction.execute({ sql: "SELECT COUNT(*) AS mapping_count FROM physical_channel_product_links WHERE physical_item_id = ?", args: [itemId] });
    if (numberValue(componentMappings.rows[0]?.mapping_count) > 0 || numberValue(productMappings.rows[0]?.mapping_count) > 0) {
      throw new Error("Remove this product's channel mappings before deleting it");
    }
    await transaction.execute({ sql: "UPDATE physical_inventory_items SET active = 0, updated_at = ? WHERE id = ?", args: [new Date().toISOString(), itemId] });
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  } finally {
    transaction.close();
  }
}

type PhysicalInventoryAdjustmentResult = {
  variantId: string;
  itemId: string;
  before: number;
  after: number;
  quantityKnown: true;
};

/**
 * Applies a reviewed physical count at the variant level. The parent item is
 * kept in sync solely as a cached total; its variants remain the source of truth.
 */
export async function applyPhysicalInventoryAdjustments(input: {
  adjustments: PhysicalInventoryAdjustment[];
  note: string;
  actor: string;
}): Promise<{ changes: PhysicalInventoryAdjustmentResult[] }> {
  const db = await getTursoClient();
  const transaction = await db.transaction("write");
  const now = new Date().toISOString();
  const changes: PhysicalInventoryAdjustmentResult[] = [];
  const itemIds = new Set<string>();

  try {
    for (const adjustment of input.adjustments) {
      const variant = await transaction.execute({
        sql: `SELECT piv.id, piv.physical_item_id, piv.quantity, piv.quantity_known
              FROM physical_inventory_variants piv
              JOIN physical_inventory_items pi ON pi.id = piv.physical_item_id
              WHERE piv.id = ? AND pi.active = 1`,
        args: [adjustment.variantId],
      });
      const row = variant.rows[0];
      if (!row) throw new Error("One of the selected variants no longer exists");

      const before = numberValue(row.quantity);
      const after = adjustment.quantity;
      if (!Number.isSafeInteger(after) || after < 0) throw new Error("Inventory cannot be negative");

      const itemId = stringValue(row.physical_item_id);
      const wasKnown = numberValue(row.quantity_known) === 1;
      if (before !== after || !wasKnown) {
        await transaction.execute({
          sql: "UPDATE physical_inventory_variants SET quantity = ?, quantity_known = 1, updated_at = ? WHERE id = ?",
          args: [after, now, adjustment.variantId],
        });
        await transaction.execute({
          sql: `INSERT INTO physical_inventory_ledger (id, physical_item_id, change_type, actor, quantity_before, quantity_after, quantity_delta, reference, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [randomUUID(), itemId, "manual_edit", input.actor, before, after, after - before, `${input.note ? `${input.note} · ` : ""}variant:${adjustment.variantId}`, now],
        });
      }
      itemIds.add(itemId);
      changes.push({ variantId: adjustment.variantId, itemId, before, after, quantityKnown: true });
    }

    for (const itemId of itemIds) {
      await transaction.execute({
        sql: `UPDATE physical_inventory_items
              SET quantity = COALESCE((SELECT SUM(quantity) FROM physical_inventory_variants WHERE physical_item_id = ?), 0),
                  quantity_known = CASE WHEN EXISTS (SELECT 1 FROM physical_inventory_variants WHERE physical_item_id = ? AND quantity_known = 0) THEN 0 ELSE 1 END,
                  updated_at = ?
              WHERE id = ?`,
        args: [itemId, itemId, now, itemId],
      });
    }

    await transaction.commit();
    return { changes };
  } catch (error) {
    await transaction.rollback();
    throw error;
  } finally {
    transaction.close();
  }
}

type PhysicalListingSeed = {
  id: string;
  channel: PhysicalChannel;
  externalProductId: string;
  title: string;
  kind: "individual" | "bundle" | "unknown";
  mappingStatus: PhysicalListingMappingStatus;
  note: string;
};

// This is the seller-authorised live TikTok audit from 21 August. It is a
// catalogue snapshot, not a guess based on similarly named Shopify products.
const TIKTOK_LISTING_SEED: PhysicalListingSeed[] = [
  { id: "tiktok:1729881618337077866", channel: "tiktok", externalProductId: "1729881618337077866", title: "20% THD Vitamin C + Astaxanthin Serum 30ml", kind: "individual", mappingStatus: "confirmed", note: "Live TikTok audit: exact 30ml serum match." },
  { id: "tiktok:1729828280298478186", channel: "tiktok", externalProductId: "1729828280298478186", title: "Lash Serum & Brow Kit", kind: "bundle", mappingStatus: "confirmed", note: "Live TikTok audit: image verifies both products." },
  { id: "tiktok:1729787169768774250", channel: "tiktok", externalProductId: "1729787169768774250", title: "Lash & Perfume Bundle", kind: "bundle", mappingStatus: "confirmed", note: "Live TikTok audit: description names both products." },
  { id: "tiktok:1729787210817837674", channel: "tiktok", externalProductId: "1729787210817837674", title: "Under Eye Serum & Perfume", kind: "bundle", mappingStatus: "confirmed", note: "Live TikTok audit: description names both products." },
  { id: "tiktok:1729787213774363242", channel: "tiktok", externalProductId: "1729787213774363242", title: "The Beginning Perfume 2 x 20ml", kind: "bundle", mappingStatus: "confirmed", note: "Live TikTok audit: explicit two-pack." },
  { id: "tiktok:1729787173784296042", channel: "tiktok", externalProductId: "1729787173784296042", title: "The Beginning Perfume 20ml", kind: "individual", mappingStatus: "confirmed", note: "Live TikTok audit: explicit 20ml Eau de Parfum." },
  { id: "tiktok:1729775874675612266", channel: "tiktok", externalProductId: "1729775874675612266", title: "Summer Bundle", kind: "bundle", mappingStatus: "confirmed", note: "Live TikTok audit: description names both serums, BioActivator, pouch, and five spoolies." },
  { id: "tiktok:1729692906874051178", channel: "tiktok", externalProductId: "1729692906874051178", title: "Fuel + Tint Brow Tinting Mud 35g", kind: "individual", mappingStatus: "review", note: "The physical catalogue counts Warm Brown and Black separately; TikTok colour/SKU detail is not sufficient to pick one." },
  { id: "tiktok:1729638607145638506", channel: "tiktok", externalProductId: "1729638607145638506", title: "Lash Serum + Under Eye Serum Duo", kind: "bundle", mappingStatus: "confirmed", note: "Live TikTok audit: corrected from the earlier Glow up Bundle match." },
  { id: "tiktok:1729638563661519466", channel: "tiktok", externalProductId: "1729638563661519466", title: "2 x Peptide SnowLift Eye Serum 8ml", kind: "bundle", mappingStatus: "confirmed", note: "Live TikTok audit: explicit two-pack." },
  { id: "tiktok:1729635949953849962", channel: "tiktok", externalProductId: "1729635949953849962", title: "2 x Eyelash Growth Serum", kind: "bundle", mappingStatus: "confirmed", note: "Live TikTok audit: explicit two-pack." },
  { id: "tiktok:1729587772809255530", channel: "tiktok", externalProductId: "1729587772809255530", title: "Eyelash Growth Serum", kind: "individual", mappingStatus: "confirmed", note: "Live TikTok audit: Serenity Hue Pro Lash Serum." },
  { id: "tiktok:1729511153129593450", channel: "tiktok", externalProductId: "1729511153129593450", title: "Peptide SnowLift Eye Serum 8ml", kind: "individual", mappingStatus: "confirmed", note: "Live TikTok audit: same peptide eye serum." },
  { id: "tiktok:1729456593869835882", channel: "tiktok", externalProductId: "1729456593869835882", title: "Brow Lamination Clay 35g", kind: "individual", mappingStatus: "confirmed", note: "Live TikTok audit: exact salon-size 35g clay." },
  { id: "tiktok:1729456591670054506", channel: "tiktok", externalProductId: "1729456591670054506", title: "Large Extra Hold Brow Primer", kind: "individual", mappingStatus: "review", note: "TikTok calls this 10g while the earlier Shopify relation was 35g. Size must be confirmed." },
  { id: "tiktok:1729427557085843050", channel: "tiktok", externalProductId: "1729427557085843050", title: "Reusable Double-Sided Facial Cleaning Towel", kind: "individual", mappingStatus: "unmapped", note: "Confirmed channel item, but it is not in the approved physical catalogue." },
  { id: "tiktok:1729429043083185770", channel: "tiktok", externalProductId: "1729429043083185770", title: "Brow Shape, Hold & Grow Duo", kind: "bundle", mappingStatus: "review", note: "Each TikTok SKU is imported as a separate shade; map each shade to its physical pomade variant." },
  { id: "tiktok:1729427787512581738", channel: "tiktok", externalProductId: "1729427787512581738", title: "Pouch + 5 Brow Spoolies", kind: "bundle", mappingStatus: "confirmed", note: "Live TikTok audit: explicit five spoolies and pouch." },
  { id: "tiktok:1729427558490148458", channel: "tiktok", externalProductId: "1729427558490148458", title: "All-Day Hold & Grow Lamination Duo", kind: "bundle", mappingStatus: "confirmed", note: "Live TikTok audit: Brow Baking Powder, Brow Lamination Clay, and five spoolies." },
  { id: "tiktok:1729427559489572458", channel: "tiktok", externalProductId: "1729427559489572458", title: "Brow Growth & Hold Kit", kind: "bundle", mappingStatus: "review", note: "Each TikTok SKU is imported as a separate shade; map each shade to its physical pomade variant." },
  { id: "tiktok:1729401004979949162", channel: "tiktok", externalProductId: "1729401004979949162", title: "Extra Hold Brow Primer", kind: "individual", mappingStatus: "review", note: "It is Brow Baking Powder, but TikTok does not state its size." },
  { id: "tiktok:1729401002070871658", channel: "tiktok", externalProductId: "1729401002070871658", title: "Brow Treatment Pomade (7 shades)", kind: "individual", mappingStatus: "review", note: "Each TikTok SKU is imported as a separate shade; map each shade to its physical pomade variant." },
  { id: "tiktok:1729401004890426986", channel: "tiktok", externalProductId: "1729401004890426986", title: "Day Rescue Treatment Clear Matte Gel", kind: "individual", mappingStatus: "confirmed", note: "Live TikTok audit: 10g Brow Lamination Clay rescue formula." },
  { id: "tiktok:1729401004657970794", channel: "tiktok", externalProductId: "1729401004657970794", title: "Brow Conditioning Gel / Follicle BioActivator", kind: "individual", mappingStatus: "confirmed", note: "Live TikTok audit: now called Brow Follicle BioActivator." },
];

// Bump this whenever TIKTOK_LISTING_SEED changes so the listing view rebuilds
// from the new audit even when synced Shopify/TikTok quantities are unchanged.
const TIKTOK_LISTING_SEED_VERSION = "2026-08-25-tiktok-sku-mapping";

function listingIdForShopifyVariant(variantId: string) {
  return `shopify:${variantId}`;
}

let physicalChannelListingsInFlight: Promise<DatabaseClient> | undefined;

// The channel listing view is derived entirely from synced Shopify/TikTok data
// plus the static TikTok audit. Re-running the ~60 upserts on every page view
// was the dominant source of inventory-page latency, so we only rewrite when a
// cheap signature of those exact inputs has actually changed (e.g. after a
// sync or TikTok refresh). Manual mappings live in separate tables and in
// columns the seed never overwrites, so a skipped reseed can never lose them.
export async function ensurePhysicalChannelListings() {
  if (physicalChannelListingsInFlight) return physicalChannelListingsInFlight;
  physicalChannelListingsInFlight = runEnsurePhysicalChannelListings().finally(() => {
    physicalChannelListingsInFlight = undefined;
  });
  return physicalChannelListingsInFlight;
}

// A deterministic fingerprint of every input the reseed reads. Any Shopify
// import, rename, quantity change, or TikTok refresh moves one of these values
// (the importer always bumps updated_at/last_synced_at/synced_at), so an equal
// signature guarantees an identical rebuild and lets us skip it safely.
async function channelListingsSignature(db: DatabaseClient) {
  const result = await db.execute(`
    SELECT
      (SELECT COUNT(*) FROM products) AS p_count,
      (SELECT COALESCE(MAX(updated_at), '') FROM products) AS p_updated,
      (SELECT COUNT(*) FROM variants WHERE shopify_variant_id IS NOT NULL) AS v_count,
      (SELECT COALESCE(MAX(updated_at), '') FROM variants) AS v_updated,
      (SELECT COALESCE(MAX(last_synced_at), '') FROM variants) AS v_synced,
      (SELECT COALESCE(SUM(available_quantity), 0) FROM variants) AS v_qty,
      (SELECT COUNT(*) FROM channel_inventory WHERE channel = 'tiktok') AS t_count,
      (SELECT COALESCE(MAX(synced_at), '') FROM channel_inventory WHERE channel = 'tiktok') AS t_synced,
      (SELECT COALESCE(SUM(available_quantity), 0) FROM channel_inventory WHERE channel = 'tiktok') AS t_qty
  `);
  const row = result.rows[0] ?? {};
  return [
    "canonical-physical-inventory-v1",
    TIKTOK_LISTING_SEED_VERSION,
    process.env.SHOPIFY_STORE_DOMAIN?.trim() ? "shop" : "noshop",
    numberValue(row.p_count), stringValue(row.p_updated),
    numberValue(row.v_count), stringValue(row.v_updated), stringValue(row.v_synced), numberValue(row.v_qty),
    numberValue(row.t_count), stringValue(row.t_synced), numberValue(row.t_qty),
  ].join("|");
}

async function runEnsurePhysicalChannelListings() {
  const db = await getTursoClient();
  const signature = await channelListingsSignature(db);
  const stored = await db.execute({ sql: "SELECT value FROM inventory_settings WHERE key = ?", args: ["physical_channel_listings_signature"] });
  if (stringValue(stored.rows[0]?.value) === signature) return db;

  const now = new Date().toISOString();
  // The audit seed starts with one product-level TikTok row. A successful live
  // SKU import expands multi-SKU products into variant rows below; this
  // product-level quantity remains a safe fallback for products with one SKU.
  const tiktokInventory = await db.execute(`
    SELECT external_product_id, SUM(available_quantity) AS quantity
    FROM channel_inventory
    WHERE channel = 'tiktok' AND external_product_id IS NOT NULL
    GROUP BY external_product_id
  `);
  const tiktokQuantityByProduct = new Map(tiktokInventory.rows.map((row) => [
    stringValue(row.external_product_id),
    numberValue(row.quantity),
  ]));
  const shopifyVariants = await db.execute(`
    SELECT p.shopify_product_id, p.title AS product_title, p.handle, p.image_url,
           v.shopify_variant_id, v.title AS variant_title, v.available_quantity
    FROM products p JOIN variants v ON v.product_id = p.id
    WHERE p.shopify_product_id IS NOT NULL AND v.shopify_variant_id IS NOT NULL
  `);

  // Build every upsert first, then apply them (plus the new signature) in one
  // atomic batch — a single round trip instead of ~60 sequential writes.
  const statements: Array<{ sql: string; args: SqlValue[] }> = [];
  for (const row of shopifyVariants.rows) {
    const externalProductId = stringValue(row.shopify_product_id);
    const externalVariantId = stringValue(row.shopify_variant_id);
    const title = stringValue(row.product_title);
    const variantTitle = stringValue(row.variant_title);
    const kind = /bundle|duo|kit|2 x|two[- ]?pack|5 spoolies/i.test(title) ? "bundle" : "individual";
    const listingUrl = process.env.SHOPIFY_STORE_DOMAIN?.trim()
      ? `https://${process.env.SHOPIFY_STORE_DOMAIN.trim().replace(/^https?:\/\//, "").replace(/\/$/, "")}/products/${stringValue(row.handle)}`
      : null;
    statements.push({
      sql: `INSERT INTO physical_channel_listings
              (id, channel, external_product_id, external_variant_id, title, variant_title, image_url, listing_url, channel_quantity, listing_kind, mapping_status, active, created_at, updated_at)
            VALUES (?, 'shopify', ?, ?, ?, ?, ?, ?, ?, ?, 'unmapped', 1, ?, ?)
            ON CONFLICT(channel, external_product_id, external_variant_id) DO UPDATE SET
              title=excluded.title, variant_title=excluded.variant_title, image_url=excluded.image_url,
              listing_url=excluded.listing_url, channel_quantity=excluded.channel_quantity,
              active=1, updated_at=excluded.updated_at`,
      args: [listingIdForShopifyVariant(externalVariantId), externalProductId, externalVariantId, title, variantTitle, optionalString(row.image_url) ?? null, listingUrl, numberValue(row.available_quantity), kind, now, now],
    });
  }

  for (const listing of TIKTOK_LISTING_SEED) {
    const channelQuantity = tiktokQuantityByProduct.get(listing.externalProductId) ?? null;
    statements.push({
      sql: `INSERT INTO physical_channel_listings
              (id, channel, external_product_id, title, listing_url, channel_quantity, listing_kind, mapping_status, source_note, active, created_at, updated_at)
            VALUES (?, 'tiktok', ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              listing_url=CASE
                WHEN listing_url IS NULL
                  OR listing_url = ''
                  OR listing_url LIKE 'https://shop.tiktok.com/view/product/%'
                  OR listing_url LIKE 'https://seller-%/product/manage?search=%'
                  OR listing_url LIKE 'https://seller-%/product/manage?search_content=%'
                  THEN excluded.listing_url
                ELSE listing_url
              END,
              channel_quantity=excluded.channel_quantity, source_note=excluded.source_note,
              active=1, updated_at=excluded.updated_at`,
      args: [listing.id, listing.externalProductId, listing.title, tiktokShopProductUrl(listing.externalProductId), channelQuantity, listing.kind, "unmapped", listing.note, now, now],
    });
  }

  // Repair live TikTok rows created by an API refresh as well as rows from the
  // static audit. Only replace URLs generated by the old code; a real URL
  // returned by TikTok remains authoritative.
  const invalidTikTokUrls = await db.execute(`
    SELECT id, external_product_id
    FROM physical_channel_listings
    WHERE channel = 'tiktok' AND active = 1
      AND (
        listing_url IS NULL
        OR listing_url = ''
        OR listing_url LIKE 'https://shop.tiktok.com/view/product/%'
        OR listing_url LIKE 'https://seller-%/product/manage?search=%'
      )
  `);
  for (const row of invalidTikTokUrls.rows) {
    const id = stringValue(row.id);
    const productId = stringValue(row.external_product_id);
    const listingUrl = tiktokShopProductUrl(productId);
    if (!id || !listingUrl) continue;
    statements.push({
      sql: "UPDATE physical_channel_listings SET listing_url=?, updated_at=? WHERE id=?",
      args: [listingUrl, now, id],
    });
  }

  statements.push({
    sql: `INSERT INTO inventory_settings (key, value, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    args: ["physical_channel_listings_signature", signature, now],
  });
  await db.batch(statements, "write");
  return db;
}

/**
 * Ensures the seeded TikTok listing view is current. The live importer then
 * expands multi-SKU products into one mapping row per SKU.
 */
export async function refreshPhysicalTikTokListingQuantities() {
  await ensurePhysicalChannelListings();
}

/**
 * Refreshes TikTok display metadata and materializes live SKU variants by the
 * platform product id. Product ids and SKU ids are the identities; titles,
 * labels, URLs, and quantities are mutable display fields and must never be
 * used to find or recreate an existing mapping.
 */
export async function updatePhysicalTikTokListingMetadata(updates: Array<{
  externalProductId: string;
  title: string;
  listingUrl: string | null;
  variants?: Array<{
    externalVariantId: string;
    variantTitle: string;
    channelQuantity: number | null;
  }>;
}>) {
  const db = await ensurePhysicalChannelListings();
  const now = new Date().toISOString();
  const validUpdates = [...new Map(updates
    .filter((update) => Boolean(update.externalProductId))
    .map((update) => [update.externalProductId, {
      ...update,
      variants: [...new Map((update.variants ?? [])
        .filter((variant) => Boolean(variant.externalVariantId))
        .map((variant) => [variant.externalVariantId, variant])).values()],
    }])).values()];
  if (!validUpdates.length) return;
  const placeholders = validUpdates.map(() => "?").join(", ");
  const existing = await db.execute({
    sql: `SELECT id, external_product_id, external_variant_id, listing_kind FROM physical_channel_listings
          WHERE channel = 'tiktok'
            AND external_product_id IN (${placeholders})`,
    args: validUpdates.map((update) => update.externalProductId),
  });
  const existingIdByKey = new Map(existing.rows.map((row) => [
    `${stringValue(row.external_product_id)}\u0000${optionalString(row.external_variant_id) ?? ""}`,
    stringValue(row.id),
  ]));
  const listingKindByProduct = new Map(existing.rows
    .filter((row) => !optionalString(row.external_variant_id))
    .map((row) => [stringValue(row.external_product_id), stringValue(row.listing_kind)]));
  const statements: Array<{ sql: string; args: SqlValue[] }> = [];
  for (const update of validUpdates) {
    const baseListingId = existingIdByKey.get(`${update.externalProductId}\u0000`)
      ?? `physical-tiktok-product:${update.externalProductId}`;
    const variants = update.variants ?? [];
    const hasMultipleVariants = variants.length > 1;
    const listingKind = listingKindByProduct.get(update.externalProductId) === "bundle" || listingKindByProduct.get(update.externalProductId) === "individual"
      ? listingKindByProduct.get(update.externalProductId)!
      : "unknown";
    statements.push({
      sql: `INSERT INTO physical_channel_listings
              (id, channel, external_product_id, external_variant_id, title, listing_url, listing_kind, mapping_status, active, created_at, updated_at)
            VALUES (?, 'tiktok', ?, NULL, ?, ?, 'unknown', 'unmapped', ${hasMultipleVariants ? "0" : "1"}, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              title = excluded.title, listing_url = COALESCE(excluded.listing_url, physical_channel_listings.listing_url),
              active = ${hasMultipleVariants ? "0" : "1"},
              updated_at = excluded.updated_at`,
      args: [
        baseListingId,
        update.externalProductId,
        update.title || `TikTok product ${update.externalProductId}`,
        update.listingUrl,
        now,
        now,
      ],
    });

    if (!hasMultipleVariants) continue;
    const activeVariantIds = new Set(variants.map((variant) => variant.externalVariantId));
    for (const variant of variants) {
      const variantKey = `${update.externalProductId}\u0000${variant.externalVariantId}`;
      const listingId = existingIdByKey.get(variantKey)
        ?? `physical-tiktok-sku:${encodeURIComponent(update.externalProductId)}:${encodeURIComponent(variant.externalVariantId)}`;
      statements.push({
        sql: `INSERT INTO physical_channel_listings
                (id, channel, external_product_id, external_variant_id, title, variant_title, listing_url, channel_quantity, listing_kind, mapping_status, source_note, active, created_at, updated_at)
              VALUES (?, 'tiktok', ?, ?, ?, ?, ?, ?, ?, 'unmapped', ?, 1, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                variant_title = excluded.variant_title,
                listing_url = COALESCE(excluded.listing_url, physical_channel_listings.listing_url),
                channel_quantity = excluded.channel_quantity,
                listing_kind = CASE WHEN physical_channel_listings.listing_kind = 'unknown' THEN excluded.listing_kind ELSE physical_channel_listings.listing_kind END,
                active = 1,
                updated_at = excluded.updated_at`,
        args: [
          listingId,
          update.externalProductId,
          variant.externalVariantId,
          update.title || `TikTok product ${update.externalProductId}`,
          variant.variantTitle || `SKU ${variant.externalVariantId}`,
          update.listingUrl,
          variant.channelQuantity,
          listingKind,
          "Map this TikTok SKU to its corresponding physical variant.",
          now,
          now,
        ],
      });
    }

    // The old product-level row represented the aggregate quantity. Once
    // TikTok exposes multiple SKUs, keeping it active would make the UI show a
    // misleading Default variant and could apply a non-shade-specific mapping.
    statements.push({
      sql: `UPDATE physical_channel_listings
            SET active=0, updated_at=?
            WHERE channel='tiktok' AND external_product_id=? AND external_variant_id IS NULL`,
      args: [now, update.externalProductId],
    });
    statements.push({
      sql: `UPDATE physical_channel_listings
            SET active=0, updated_at=?
            WHERE channel='tiktok' AND external_product_id=? AND external_variant_id IS NOT NULL
              AND active=1 AND external_variant_id NOT IN (${[...activeVariantIds].map(() => "?").join(", ")})`,
      args: [now, update.externalProductId, ...activeVariantIds],
    });
  }
  if (statements.length) await db.batch(statements, "write");
}

export async function getPhysicalChannelListings(channel: PhysicalChannel): Promise<PhysicalChannelListing[]> {
  const db = await getTursoClient();
  const result = await db.execute({
    sql: `SELECT l.id, l.channel, l.external_product_id, l.external_variant_id, l.title, l.variant_title,
                 l.image_url, l.listing_url, l.channel_quantity, l.listing_kind, l.mapping_status, l.source_note,
                 product_link.physical_item_id AS master_product_id, master_item.title AS master_product_title,
                 c.id AS component_id, c.physical_variant_id, c.quantity_per_sale, pi.id AS item_id,
                 pi.title AS item_title, piv.title AS physical_variant_title
          FROM physical_channel_listings l
          LEFT JOIN physical_channel_product_links product_link
            ON product_link.channel=l.channel AND product_link.external_product_id=l.external_product_id
          LEFT JOIN physical_inventory_items master_item ON master_item.id=product_link.physical_item_id
          LEFT JOIN physical_listing_components c ON c.listing_id=l.id
          LEFT JOIN physical_inventory_variants piv ON piv.id=c.physical_variant_id
          LEFT JOIN physical_inventory_items pi ON pi.id=piv.physical_item_id
          WHERE l.channel=? AND l.active=1
          ORDER BY l.title, l.variant_title, l.id`,
    args: [channel],
  });
  const listings = new Map<string, PhysicalChannelListing>();
  for (const row of result.rows) {
    const id = stringValue(row.id);
    let listing = listings.get(id);
    if (!listing) {
      const kind = stringValue(row.listing_kind);
      const mappingValue = stringValue(row.mapping_status);
      const mappingStatus: PhysicalListingMappingStatus = mappingValue === "confirmed" || mappingValue === "review" ? mappingValue : "unmapped";
      listing = {
        id,
        channel: stringValue(row.channel) === "tiktok" ? "tiktok" : "shopify",
        externalProductId: stringValue(row.external_product_id),
        externalVariantId: optionalString(row.external_variant_id) ?? null,
        title: stringValue(row.title),
        variantTitle: stringValue(row.variant_title),
        imageUrl: optionalString(row.image_url) ?? null,
        listingUrl: optionalString(row.listing_url) ?? null,
        channelQuantity: row.channel_quantity === null || row.channel_quantity === undefined ? null : numberValue(row.channel_quantity),
        kind: kind === "bundle" || kind === "individual" ? kind : "unknown",
        masterProductId: optionalString(row.master_product_id) ?? null,
        masterProductTitle: optionalString(row.master_product_title) ?? null,
        mappingStatus,
        sourceNote: stringValue(row.source_note),
        components: [],
      };
      listings.set(id, listing);
    }
    if (!listing) continue;
    if (row.component_id) {
      listing.components.push({
        id: stringValue(row.component_id),
        physicalVariantId: stringValue(row.physical_variant_id),
        itemId: stringValue(row.item_id),
        itemTitle: stringValue(row.item_title),
        variantTitle: stringValue(row.physical_variant_title),
        quantityPerSale: numberValue(row.quantity_per_sale),
      });
    }
  }
  return [...listings.values()];
}

export async function savePhysicalListingMappings(input: { mappings: Array<{ listingId: string; components: Array<{ physicalVariantId: string; quantityPerSale: number }> }>; listingKind?: "individual" | "bundle" }) {
  const db = await ensurePhysicalChannelListings();
  if (!input.mappings.length) throw new Error("At least one listing mapping is required");
  if (new Set(input.mappings.map((mapping) => mapping.listingId)).size !== input.mappings.length) throw new Error("A listing can only be mapped once per save");

  const transaction = await db.transaction("write");
  const now = new Date().toISOString();
  const productKeys = new Map<string, { channel: PhysicalChannel; externalProductId: string; kind: "individual" | "bundle" }>();
  const channels = new Set<PhysicalChannel>();
  let editedProductKey: { channel: PhysicalChannel; externalProductId: string } | null = null;
  try {
    for (const mapping of input.mappings) {
      const listing = await transaction.execute({ sql: "SELECT id, channel, external_product_id, listing_kind FROM physical_channel_listings WHERE id=? AND active=1", args: [mapping.listingId] });
      if (!listing.rows[0]) throw new Error("Channel listing not found");
      const channel = stringValue(listing.rows[0].channel) === "tiktok" ? "tiktok" : "shopify";
      const externalProductId = stringValue(listing.rows[0].external_product_id);
      const kind = input.listingKind ?? stringValue(listing.rows[0].listing_kind);
      if (kind !== "individual" && kind !== "bundle") throw new Error("This listing needs an Individual or Bundle type before it can be mapped");
      if (input.listingKind) {
        if (editedProductKey && (editedProductKey.channel !== channel || editedProductKey.externalProductId !== externalProductId)) {
          throw new Error("Listings from one channel product must be saved together");
        }
        editedProductKey = { channel, externalProductId };
      }
      const components = mapping.components.filter((component) => component.physicalVariantId && Number.isSafeInteger(component.quantityPerSale) && component.quantityPerSale > 0);
      if (components.length !== mapping.components.length) throw new Error("Every mapped item needs a positive whole-number quantity");
      if (new Set(components.map((component) => component.physicalVariantId)).size !== components.length) throw new Error("A physical variant can only be mapped once per listing");
      if (components.length > 12) throw new Error("A listing can include up to 12 physical components");
      if (kind === "individual" && components.length > 1) throw new Error("An Individual listing can map to one physical variant only");

      channels.add(channel);
      productKeys.set(`${channel}:${externalProductId}`, { channel, externalProductId, kind });
      const physicalItemIds = new Set<string>();
      for (const component of components) {
        const variant = await transaction.execute({ sql: "SELECT physical_item_id FROM physical_inventory_variants WHERE id=?", args: [component.physicalVariantId] });
        if (!variant.rows[0]) throw new Error("One selected physical variant no longer exists");
        const physicalItemId = stringValue(variant.rows[0].physical_item_id);
        if (kind === "bundle" && physicalItemIds.has(physicalItemId)) throw new Error("A Bundle listing can use one variant from each physical product. Use quantity for multiples of the same variant.");
        physicalItemIds.add(physicalItemId);
      }
      await transaction.execute({ sql: "DELETE FROM physical_listing_components WHERE listing_id=?", args: [mapping.listingId] });
      for (const component of components) {
        await transaction.execute({
          sql: `INSERT INTO physical_listing_components (id, listing_id, physical_variant_id, quantity_per_sale, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)`,
          args: [randomUUID(), mapping.listingId, component.physicalVariantId, component.quantityPerSale, now, now],
        });
      }
      await transaction.execute({
        sql: "UPDATE physical_channel_listings SET mapping_status=?, updated_at=? WHERE id=?",
        args: [components.length ? "confirmed" : "unmapped", now, mapping.listingId],
      });
    }
    if (channels.size !== 1) throw new Error("Listings from one channel must be saved together");

    if (input.listingKind && editedProductKey) {
      const activeListings = await transaction.execute({
        sql: "SELECT id FROM physical_channel_listings WHERE channel=? AND external_product_id=? AND active=1",
        args: [editedProductKey.channel, editedProductKey.externalProductId],
      });
      const submittedIds = new Set(input.mappings.map((mapping) => mapping.listingId));
      if (activeListings.rows.length !== submittedIds.size || activeListings.rows.some((row) => !submittedIds.has(stringValue(row.id)))) {
        throw new Error("All variants of this channel product must be saved together when changing its listing type");
      }
      await transaction.execute({
        sql: "UPDATE physical_channel_listings SET listing_kind=?, updated_at=? WHERE channel=? AND external_product_id=? AND active=1",
        args: [input.listingKind, now, editedProductKey.channel, editedProductKey.externalProductId],
      });
    }

    for (const { channel, externalProductId, kind } of productKeys.values()) {
      if (kind === "bundle") {
        await transaction.execute({ sql: "DELETE FROM physical_channel_product_links WHERE channel=? AND external_product_id=?", args: [channel, externalProductId] });
        continue;
      }
      const mappedVariants = await transaction.execute({
        sql: `SELECT DISTINCT piv.physical_item_id
              FROM physical_channel_listings l
              JOIN physical_listing_components c ON c.listing_id=l.id
              JOIN physical_inventory_variants piv ON piv.id=c.physical_variant_id
              WHERE l.channel=? AND l.external_product_id=? AND l.active=1`,
        args: [channel, externalProductId],
      });
      const physicalItemIds = [...new Set(mappedVariants.rows.map((row) => stringValue(row.physical_item_id)))];
      if (physicalItemIds.length > 1) throw new Error("All variants of an Individual listing must use the same physical product");
      if (physicalItemIds.length === 1) {
        await transaction.execute({
          sql: `INSERT INTO physical_channel_product_links (channel, external_product_id, physical_item_id, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(channel, external_product_id) DO UPDATE SET physical_item_id=excluded.physical_item_id, updated_at=excluded.updated_at`,
          args: [channel, externalProductId, physicalItemIds[0], now, now],
        });
      } else {
        await transaction.execute({ sql: "DELETE FROM physical_channel_product_links WHERE channel=? AND external_product_id=?", args: [channel, externalProductId] });
      }
    }
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  } finally {
    transaction.close();
  }
  invalidateKpiReportingCache();
  return getPhysicalChannelListings([...channels][0]);
}

export async function savePhysicalListingMapping(input: { listingId: string; components: Array<{ physicalVariantId: string; quantityPerSale: number }> }) {
  return savePhysicalListingMappings({ mappings: [input] });
}

/** Saves the product-level association shown in the grouped channel catalogue. */
export async function savePhysicalChannelProductLink(input: { channel: PhysicalChannel; externalProductId: string; physicalItemId: string | null }) {
  const db = await ensurePhysicalChannelListings();
  const product = await db.execute({
    sql: "SELECT id FROM physical_channel_listings WHERE channel=? AND external_product_id=? AND active=1 LIMIT 1",
    args: [input.channel, input.externalProductId],
  });
  if (!product.rows[0]) throw new Error("Channel product not found");

  const transaction = await db.transaction("write");
  const now = new Date().toISOString();
  try {
    if (input.physicalItemId) {
      const physicalItem = await transaction.execute({ sql: "SELECT id FROM physical_inventory_items WHERE id=? AND active=1", args: [input.physicalItemId] });
      if (!physicalItem.rows[0]) throw new Error("The selected master product no longer exists");
      await transaction.execute({
        sql: `INSERT INTO physical_channel_product_links (channel, external_product_id, physical_item_id, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(channel, external_product_id) DO UPDATE SET physical_item_id=excluded.physical_item_id, updated_at=excluded.updated_at`,
        args: [input.channel, input.externalProductId, input.physicalItemId, now, now],
      });
    } else {
      await transaction.execute({ sql: "DELETE FROM physical_channel_product_links WHERE channel=? AND external_product_id=?", args: [input.channel, input.externalProductId] });
    }
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  } finally {
    transaction.close();
  }
  invalidateKpiReportingCache();
  return getPhysicalChannelListings(input.channel);
}

/** Clears every mapping relationship while preserving channel listings, inventory, and orders. */
export async function clearAllChannelMappings() {
  const db = await ensurePhysicalChannelListings();
  const transaction = await db.transaction("write");
  const now = new Date().toISOString();
  try {
    await transaction.execute("DELETE FROM physical_listing_components");
    await transaction.execute("DELETE FROM physical_channel_product_links");
    await transaction.execute("DELETE FROM channel_mappings");
    await transaction.execute("DELETE FROM bundle_components");
    await transaction.execute({ sql: "UPDATE physical_channel_listings SET mapping_status='unmapped', updated_at=?", args: [now] });
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  } finally {
    transaction.close();
  }
}

/** The three-inventory view: master (in-app) + fetched Shopify and TikTok display levels per variant. */
export async function getChannelInventory(): Promise<ChannelInventorySnapshot> {
  const db = await getTursoClient();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [variantsResult, masterResult, tiktokResult, tiktokProductResult, tiktokCountResult, syncedResult, salesResult, sync] = await Promise.all([
    db.execute(`SELECT v.id, v.product_id, p.title AS product, v.title AS variant, v.sku, v.available_quantity, v.lead_time_days, v.packaging_type
                FROM variants v JOIN products p ON p.id = v.product_id ORDER BY p.title, v.title`),
    db.execute(`SELECT variant_id, quantity FROM master_inventory`),
    db.execute(`SELECT variant_id, SUM(available_quantity) AS qty FROM channel_inventory WHERE channel = 'tiktok' AND variant_id IS NOT NULL GROUP BY variant_id`),
    db.execute(`
      WITH mapped_products AS (
        SELECT cm.external_product_id, MIN(v.product_id) AS product_id
        FROM channel_mappings cm
        JOIN variants v ON v.id = cm.variant_id
        WHERE cm.channel = 'tiktok' AND cm.active = 1 AND cm.external_product_id IS NOT NULL
        GROUP BY cm.external_product_id
        HAVING COUNT(DISTINCT v.product_id) = 1
      )
      SELECT mp.product_id, SUM(ci.available_quantity) AS qty
      FROM channel_inventory ci
      JOIN mapped_products mp ON mp.external_product_id = ci.external_product_id
      WHERE ci.channel = 'tiktok' AND ci.variant_id IS NULL
      GROUP BY mp.product_id
    `),
    db.execute(`SELECT COUNT(DISTINCT external_product_id) AS product_count FROM channel_inventory WHERE channel = 'tiktok' AND external_product_id IS NOT NULL`),
    db.execute(`SELECT MAX(synced_at) AS synced_at FROM channel_inventory WHERE channel = 'tiktok'`),
    db.execute({
      sql: `SELECT oi.variant_id,
              SUM(CASE WHEN o.source_created_at >= ? THEN oi.quantity ELSE 0 END) AS sold_7d,
              SUM(oi.quantity) AS sold_30d
            FROM order_items oi JOIN orders o ON o.id = oi.order_id
            WHERE o.source_created_at >= ? AND oi.variant_id IS NOT NULL GROUP BY oi.variant_id`,
      args: [sevenDaysAgo, thirtyDaysAgo],
    }),
    getLatestSync(),
  ]);

  const masterByVariant = new Map(masterResult.rows.map((row) => [stringValue(row.variant_id), numberValue(row.quantity)]));
  const tiktokByVariant = new Map(tiktokResult.rows.map((row) => [stringValue(row.variant_id), numberValue(row.qty)]));
  const tiktokProductByProduct = new Map(tiktokProductResult.rows.map((row) => [stringValue(row.product_id), numberValue(row.qty)]));
  const soldByVariant = new Map(salesResult.rows.map((row) => [stringValue(row.variant_id), { sold7d: numberValue(row.sold_7d), sold30d: numberValue(row.sold_30d) }]));

  const productLevelShown = new Set<string>();
  const rows: ChannelInventoryRow[] = variantsResult.rows.map((row, index) => {
    const variantId = stringValue(row.id);
    const productId = stringValue(row.product_id);
    const leadTimeDays = nullableNumber(row.lead_time_days);
    const sales = soldByVariant.get(variantId) ?? { sold7d: 0, sold30d: 0 };
    const tiktokProductLevel = tiktokProductByProduct.has(productId) && !productLevelShown.has(productId)
      ? tiktokProductByProduct.get(productId)!
      : null;
    productLevelShown.add(productId);
    return {
      variantId,
      productId,
      product: stringValue(row.product),
      variant: stringValue(row.variant),
      sku: stringValue(row.sku),
      imageTone: LEDGER_TONES[index % LEDGER_TONES.length],
      master: masterByVariant.has(variantId) ? masterByVariant.get(variantId)! : null,
      shopify: numberValue(row.available_quantity),
      tiktok: tiktokByVariant.has(variantId) ? tiktokByVariant.get(variantId)! : null,
      tiktokProductLevel,
      sold7d: sales.sold7d,
      sold30d: sales.sold30d,
      leadTime: leadTimeDays ? `${leadTimeDays} days` : "—",
      packagingType: stringValue(row.packaging_type) || "Not set",
    };
  });

  return {
    rows,
    tiktokSyncedAt: stringValue(syncedResult.rows[0]?.synced_at) || null,
    tiktokProductCount: numberValue(tiktokCountResult.rows[0]?.product_count),
    sync,
  };
}

/** Loads one product from the persisted Shopify/TikTok snapshots and its audit history. */
export async function getProductDetail(productId: string): Promise<ProductDetail | null> {
  const db = await getTursoClient();
  const productResult = await db.execute({
    sql: `SELECT id, title, handle, image_url
          FROM products
          WHERE id = ? OR shopify_product_id = ? OR handle = ? OR shopify_product_id LIKE ?
          LIMIT 1`,
    args: [productId, productId, productId, `%/${productId}`],
  });
  const productRow = productResult.rows[0];
  if (!productRow) return null;
  const canonicalProductId = stringValue(productRow.id);

  const [variantsResult, tiktokSnapshotResult, tiktokProductResult] = await Promise.all([
    db.execute({
      sql: `SELECT id, title, available_quantity, last_synced_at
            FROM variants WHERE product_id = ? ORDER BY title, id`,
      args: [canonicalProductId],
    }),
    db.execute("SELECT MAX(synced_at) AS synced_at FROM channel_inventory WHERE channel = 'tiktok'"),
    db.execute({
      sql: `WITH mapped_products AS (
              SELECT cm.external_product_id, MIN(v.product_id) AS product_id
              FROM channel_mappings cm
              JOIN variants v ON v.id = cm.variant_id
              WHERE cm.channel = 'tiktok' AND cm.active = 1 AND cm.external_product_id IS NOT NULL
              GROUP BY cm.external_product_id
              HAVING COUNT(DISTINCT v.product_id) = 1
            )
            SELECT SUM(ci.available_quantity) AS quantity
            FROM channel_inventory ci
            JOIN mapped_products mp ON mp.external_product_id = ci.external_product_id
            WHERE ci.channel = 'tiktok' AND ci.variant_id IS NULL AND mp.product_id = ?`,
      args: [canonicalProductId],
    }),
  ]);
  const variantIds = variantsResult.rows.map((row) => stringValue(row.id)).filter(Boolean);
  const sync = await getLatestSync();
  if (variantIds.length === 0) {
    return {
      id: canonicalProductId,
      title: stringValue(productRow.title),
      handle: stringValue(productRow.handle),
      imageUrl: optionalString(productRow.image_url) ?? null,
      variants: [],
      totals: { master: null, shopify: 0, tiktok: null, sold7d: 0, sold30d: 0, dailySalesRate: 0, daysCover: null },
      tiktokProductLevel: null,
      shopifySyncedAt: null,
      tiktokSyncedAt: stringValue(tiktokSnapshotResult.rows[0]?.synced_at) || null,
      sync,
      ledger: [],
    };
  }

  const placeholders = variantIds.map(() => "?").join(", ");
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [masterResult, tiktokResult, salesResult, ledgerResult] = await Promise.all([
    db.execute({
      sql: `SELECT variant_id, quantity FROM master_inventory WHERE variant_id IN (${placeholders})`,
      args: variantIds,
    }),
    db.execute({
      sql: `SELECT variant_id, SUM(available_quantity) AS quantity, MAX(synced_at) AS synced_at
            FROM channel_inventory WHERE channel = 'tiktok' AND variant_id IN (${placeholders}) GROUP BY variant_id`,
      args: variantIds,
    }),
    db.execute({
      sql: `SELECT oi.variant_id,
              SUM(CASE WHEN o.source_created_at >= ? THEN oi.quantity ELSE 0 END) AS sold_7d,
              SUM(oi.quantity) AS sold_30d
            FROM order_items oi JOIN orders o ON o.id = oi.order_id
            WHERE o.source_created_at >= ? AND oi.variant_id IN (${placeholders})
            GROUP BY oi.variant_id`,
      args: [sevenDaysAgo, thirtyDaysAgo, ...variantIds],
    }),
    db.execute({
      sql: `SELECT il.id, il.variant_id, v.title AS item, il.inventory, il.change_type, il.actor,
              il.quantity_before, il.quantity_after, il.quantity_delta, il.reference, il.created_at
            FROM inventory_ledger il LEFT JOIN variants v ON v.id = il.variant_id
            WHERE il.variant_id IN (${placeholders}) ORDER BY il.created_at DESC LIMIT 100`,
      args: variantIds,
    }),
  ]);

  const masterByVariant = new Map(masterResult.rows.map((row) => [stringValue(row.variant_id), numberValue(row.quantity)]));
  const tiktokByVariant = new Map(tiktokResult.rows.map((row) => [stringValue(row.variant_id), numberValue(row.quantity)]));
  const tiktokProductLevel = tiktokProductResult.rows[0]?.quantity == null ? null : numberValue(tiktokProductResult.rows[0].quantity);
  const salesByVariant = new Map(salesResult.rows.map((row) => [stringValue(row.variant_id), {
    sold7d: numberValue(row.sold_7d),
    sold30d: numberValue(row.sold_30d),
  }]));
  const shopifySyncedAt = variantsResult.rows.reduce<string | null>((latest, row) => {
    const syncedAt = optionalString(row.last_synced_at) ?? null;
    return syncedAt && (!latest || syncedAt > latest) ? syncedAt : latest;
  }, null);
  const tiktokSyncedAt = stringValue(tiktokSnapshotResult.rows[0]?.synced_at) || null;

  const variants: ProductDetailVariant[] = variantsResult.rows.map((row) => {
    const id = stringValue(row.id);
    const sales = salesByVariant.get(id) ?? { sold7d: 0, sold30d: 0 };
    const dailySalesRate = Math.max(sales.sold7d / 7, sales.sold30d / 30);
    const master = masterByVariant.has(id) ? masterByVariant.get(id)! : null;
    return {
      id,
      title: stringValue(row.title),
      master,
      shopify: numberValue(row.available_quantity),
      tiktok: tiktokByVariant.has(id) ? tiktokByVariant.get(id)! : null,
      sold7d: sales.sold7d,
      sold30d: sales.sold30d,
      dailySalesRate,
      daysCover: master !== null && master > 0 && dailySalesRate > 0 ? Math.ceil(master / dailySalesRate) : null,
    };
  });

  const masterValues = variants.map((variant) => variant.master).filter((quantity): quantity is number => quantity !== null);
  const tiktokValues = variants.map((variant) => variant.tiktok).filter((quantity): quantity is number => quantity !== null);
  const sold7d = variants.reduce((total, variant) => total + variant.sold7d, 0);
  const sold30d = variants.reduce((total, variant) => total + variant.sold30d, 0);
  const dailySalesRate = Math.max(sold7d / 7, sold30d / 30);
  const ledger: InventoryLedgerEntry[] = ledgerResult.rows.map((row) => ({
    id: stringValue(row.id),
    item: stringValue(row.item) || "Inventory item",
    inventory: toInventoryChannel(stringValue(row.inventory)),
    changeType: stringValue(row.change_type) as InventoryLedgerEntry["changeType"],
    actor: stringValue(row.actor),
    isSystem: stringValue(row.actor).toLowerCase() === "system",
    quantityBefore: nullableNumber(row.quantity_before),
    quantityAfter: nullableNumber(row.quantity_after),
    quantityDelta: numberValue(row.quantity_delta),
    reference: stringValue(row.reference),
    createdAt: stringValue(row.created_at),
  }));

  return {
    id: canonicalProductId,
    title: stringValue(productRow.title),
    handle: stringValue(productRow.handle),
    imageUrl: optionalString(productRow.image_url) ?? null,
    variants,
    totals: {
      master: masterValues.length === 0 ? null : masterValues.reduce((total, quantity) => total + quantity, 0),
      shopify: variants.reduce((total, variant) => total + variant.shopify, 0),
      tiktok: tiktokValues.length === 0 && tiktokProductLevel === null
        ? null
        : tiktokValues.reduce((total, quantity) => total + quantity, 0) + (tiktokProductLevel ?? 0),
      sold7d,
      sold30d,
      dailySalesRate,
      daysCover: masterValues.length > 0 && dailySalesRate > 0 ? Math.ceil(masterValues.reduce((total, quantity) => total + quantity, 0) / dailySalesRate) : null,
    },
    shopifySyncedAt,
    tiktokSyncedAt,
    tiktokProductLevel,
    sync,
    ledger,
  };
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
  const [physicalItems, packaging] = await Promise.all([getPhysicalInventory(), getPackagingInventory()]);
  const db = await getTursoClient();
  const unmappedListings = await db.execute(`
    SELECT id, title, channel FROM physical_channel_listings
    WHERE active = 1 AND mapping_status <> 'confirmed'
  `);
  const candidates: AlertCandidate[] = [];
  for (const item of physicalItems) {
    for (const variant of item.variants) {
      if (!variant.quantityKnown || variant.quantity >= 10) continue;
      const empty = variant.quantity === 0;
      candidates.push({
        key: `physical-low-stock:${variant.id}`,
        kind: empty ? "reorder" : "low_stock",
        severity: empty ? "critical" : "warning",
        title: `${item.title} is ${empty ? "out of stock" : "below 10 units"}`,
        detail: `${variant.title || "Default variant"} has ${variant.quantity} physical units on hand.`,
      });
    }
  }
  for (const material of packaging) {
    if (material.quantity > material.reorderPoint) continue;
    candidates.push({
      key: `packaging:${material.id}`,
      kind: "packaging",
      severity: material.quantity === 0 ? "critical" : "warning",
      title: `${material.title} packaging ${material.quantity === 0 ? "is empty" : "is low"}`,
      detail: material.leadTimeDays ? `${material.quantity} units on hand · ${material.leadTimeDays}-day lead time.` : `${material.quantity} units on hand.`,
    });
  }
  for (const listing of unmappedListings.rows) {
    const channel = stringValue(listing.channel) === "tiktok" ? "TikTok" : "Shopify";
    candidates.push({
      key: `physical-mapping:${stringValue(listing.id)}`,
      kind: "mapping",
      severity: "info",
      title: `${stringValue(listing.title) || `${channel} listing`} needs mapping review`,
      detail: `${channel} sales will not affect physical stock until this listing is confirmed.`,
    });
  }
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
  if (input.finished) {
    // Bookkeeping, not history: the table grows by two rows on every scheduled
    // run and nothing reads beyond the recent window. Pruning on completion
    // keeps it bounded without a separate job.
    await db.execute({
      sql: `DELETE FROM sync_runs WHERE started_at < ?`,
      args: [new Date(Date.now() - SYNC_RUN_RETENTION_DAYS * 86_400_000).toISOString()],
    });
    invalidateKpiReportingCache();
  }
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

function labQuantity(value: number) {
  if (!Number.isFinite(value) || value < 0 || value > 10_000_000) throw new Error("Lab quantity must be between 0 and 10,000,000 g");
  return Math.round(value * 1000) / 1000;
}

function batchQuantity(value: number) {
  if (!Number.isFinite(value) || value <= 0 || value > 10_000_000) throw new Error("Batch size must be between 0.001 and 10,000,000 g");
  return Math.round(value * 1000) / 1000;
}

function productionQuantity(value: number, allowZero = false) {
  if (!Number.isFinite(value) || value < (allowZero ? 0 : 0.001) || value > 10_000_000) {
    throw new Error(`Production quantity must be between ${allowZero ? "0" : "0.001"} and 10,000,000`);
  }
  return Math.round(value * 1000) / 1000;
}

function productionUnit(value: unknown): LabQuantityUnit {
  if (value === "g" || value === "ml") return value;
  throw new Error("Choose grams or milliliters");
}

function toLabFormulaOutput(row: Record<string, unknown> | undefined): LabFormulaOutput | null {
  if (!row || !row.output_id) return null;
  return {
    id: stringValue(row.output_id),
    physicalVariantId: stringValue(row.physical_variant_id),
    product: stringValue(row.output_product),
    variant: stringValue(row.output_variant),
    fillQuantity: numberValue(row.fill_quantity),
    fillUnit: productionUnit(row.fill_unit),
  };
}

function toLabFormulaLine(row: Record<string, unknown>): LabFormulaLine {
  const calculation = stringValue(row.calculation);
  return {
    ingredientId: stringValue(row.ingredient_id),
    ingredient: stringValue(row.ingredient),
    percentage: row.percentage === null ? null : numberValue(row.percentage),
    calculation: calculation === "remainder" || calculation === "manual" ? calculation : "fixed",
    phase: stringValue(row.phase),
    note: stringValue(row.note),
    quantityGrams: numberValue(row.quantity_grams),
    quantityKnown: numberValue(row.quantity_known) === 1,
  };
}

export async function getLabIngredients(): Promise<LabIngredient[]> {
  const db = await getTursoClient();
  const result = await db.execute(`
    SELECT i.id, i.title, i.quantity_grams, i.quantity_known, i.reorder_point_grams, i.updated_at,
           COUNT(DISTINCT fi.formula_id) AS formula_count
    FROM lab_ingredients i
    LEFT JOIN lab_formula_ingredients fi ON fi.ingredient_id = i.id
    WHERE i.active = 1
    GROUP BY i.id
    ORDER BY i.title
  `);
  return result.rows.map((row) => ({
    id: stringValue(row.id), title: stringValue(row.title), quantityGrams: numberValue(row.quantity_grams),
    quantityKnown: numberValue(row.quantity_known) === 1, reorderPointGrams: numberValue(row.reorder_point_grams),
    usedByFormulaCount: numberValue(row.formula_count), updatedAt: stringValue(row.updated_at),
  }));
}

export async function getLabFormulas(): Promise<LabFormula[]> {
  const db = await getTursoClient();
  const result = await db.execute(`
    SELECT f.id, f.title, f.subtitle, f.notes, COUNT(fi.id) AS ingredient_count,
           fo.id AS output_id, fo.physical_variant_id, fo.fill_quantity, fo.fill_unit,
           pi.title AS output_product, piv.title AS output_variant
    FROM lab_formulas f LEFT JOIN lab_formula_ingredients fi ON fi.formula_id = f.id
    LEFT JOIN lab_formula_outputs fo ON fo.formula_id = f.id AND fo.active = 1
    LEFT JOIN physical_inventory_variants piv ON piv.id = fo.physical_variant_id AND piv.active = 1
    LEFT JOIN physical_inventory_items pi ON pi.id = piv.physical_item_id AND pi.active = 1
    WHERE f.active = 1 GROUP BY f.id ORDER BY f.title
  `);
  return result.rows.map((row) => ({
    id: stringValue(row.id), title: stringValue(row.title), subtitle: stringValue(row.subtitle), notes: stringValue(row.notes),
    ingredientCount: numberValue(row.ingredient_count), lines: [], output: toLabFormulaOutput(row as Record<string, unknown>),
  }));
}

export async function getLabFormula(id: string): Promise<LabFormula | null> {
  const db = await getTursoClient();
  const formula = await db.execute({ sql: "SELECT id, title, subtitle, notes FROM lab_formulas WHERE id = ? AND active = 1", args: [id] });
  const row = formula.rows[0];
  if (!row) return null;
  const lines = await db.execute({
    sql: `SELECT fi.ingredient_id, i.title AS ingredient, fi.percentage, fi.calculation, fi.phase, fi.note, i.quantity_grams, i.quantity_known
          FROM lab_formula_ingredients fi JOIN lab_ingredients i ON i.id = fi.ingredient_id
          WHERE fi.formula_id = ? ORDER BY fi.sort_order`, args: [id],
  });
  const output = await db.execute({
    sql: `SELECT fo.id AS output_id, fo.physical_variant_id, fo.fill_quantity, fo.fill_unit,
                 pi.title AS output_product, piv.title AS output_variant
          FROM lab_formula_outputs fo
          JOIN physical_inventory_variants piv ON piv.id = fo.physical_variant_id AND piv.active = 1
          JOIN physical_inventory_items pi ON pi.id = piv.physical_item_id AND pi.active = 1
          WHERE fo.formula_id = ? AND fo.active = 1`,
    args: [id],
  });
  return { id: stringValue(row.id), title: stringValue(row.title), subtitle: stringValue(row.subtitle), notes: stringValue(row.notes), ingredientCount: lines.rows.length, lines: lines.rows.map((line) => toLabFormulaLine(line as Record<string, unknown>)), output: toLabFormulaOutput(output.rows[0] as Record<string, unknown> | undefined) };
}

function toLabBatch(row: Record<string, unknown>): LabBatch {
  const outputQuantity = numberValue(row.output_quantity);
  const packagedQuantity = numberValue(row.packaged_quantity);
  const output = toLabFormulaOutput(row);
  let packagedUnitsValue = 0;
  if (output && stringValue(row.output_unit) === output.fillUnit) {
    try { packagedUnitsValue = packagedUnits(packagedQuantity, output.fillUnit, output.fillQuantity, output.fillUnit); } catch { packagedUnitsValue = 0; }
  }
  return {
    id: stringValue(row.id), formula: stringValue(row.formula), batchNumber: stringValue(row.batch_number), targetGrams: numberValue(row.target_grams),
    outputQuantity, outputUnit: productionUnit(row.output_unit || "g"), packagedQuantity,
    remainingQuantity: Math.max(0, Math.round((outputQuantity - packagedQuantity) * 1_000_000) / 1_000_000), packagedUnits: packagedUnitsValue,
    output, actor: stringValue(row.actor), createdAt: stringValue(row.created_at),
  };
}

const labBatchSelect = `SELECT b.id, b.formula_id, b.batch_number, b.target_grams, b.actor, b.created_at, f.title AS formula,
       COALESCE(a.total_quantity, b.target_grams) AS output_quantity,
       COALESCE(a.quantity_unit, 'g') AS output_unit,
       COALESCE(a.packaged_quantity, 0) AS packaged_quantity,
       fo.id AS output_id, fo.physical_variant_id, fo.fill_quantity, fo.fill_unit,
       pi.title AS output_product, piv.title AS output_variant
       FROM lab_batches b
       JOIN lab_formulas f ON f.id = b.formula_id
       LEFT JOIN lab_batch_allocations a ON a.batch_id = b.id
       LEFT JOIN lab_formula_outputs fo ON fo.formula_id = b.formula_id AND fo.active = 1
       LEFT JOIN physical_inventory_variants piv ON piv.id = fo.physical_variant_id AND piv.active = 1
       LEFT JOIN physical_inventory_items pi ON pi.id = piv.physical_item_id AND pi.active = 1`;

export async function getLabBatches(limit = 100, formulaId?: string): Promise<LabBatch[]> {
  const db = await getTursoClient();
  const result = await db.execute({
    sql: `${labBatchSelect} ${formulaId ? "WHERE b.formula_id = ?" : ""} ORDER BY b.created_at DESC LIMIT ?`, args: formulaId ? [formulaId, Math.min(Math.max(1, limit), 100)] : [Math.min(Math.max(1, limit), 100)],
  });
  return result.rows.map((row) => toLabBatch(row as Record<string, unknown>));
}

export async function getLabBatchDetail(id: string): Promise<LabBatchDetail | null> {
  const db = await getTursoClient();
  const result = await db.execute({ sql: `${labBatchSelect} WHERE b.id = ? LIMIT 1`, args: [id] });
  const row = result.rows[0];
  if (!row) return null;
  return { ...toLabBatch(row as Record<string, unknown>), formulaId: stringValue(row.formula_id) };
}

export async function createLabFormula(input: {
  title: string;
  subtitle?: string;
  notes?: string;
  lines: Array<{ ingredient: string; calculation: "fixed" | "remainder" | "manual"; percentage?: number; phase?: string; note?: string }>;
  output?: { physicalVariantId: string; fillQuantity: number; fillUnit: LabQuantityUnit };
}) {
  const title = input.title.trim();
  const subtitle = input.subtitle?.trim() ?? "";
  const notes = input.notes?.trim() ?? "";
  if (!title || title.length > 140) throw new Error("Enter a formula name of up to 140 characters");
  if (subtitle.length > 200 || notes.length > 1400) throw new Error("Keep the formula details within the allowed length");
  if (!input.lines.length) throw new Error("Add at least one ingredient before saving the formula");

  const lines = input.lines.map((line, index) => {
    const ingredient = line.ingredient.trim();
    const phase = line.phase?.trim() ?? "";
    const note = line.note?.trim() ?? "";
    if (!ingredient || ingredient.length > 180) throw new Error(`Ingredient ${index + 1} needs a name of up to 180 characters`);
    if (!["fixed", "remainder", "manual"].includes(line.calculation)) throw new Error(`Choose how ingredient ${index + 1} is calculated`);
    const percentage = line.calculation === "fixed" ? Number(line.percentage) : null;
    if (line.calculation === "fixed" && (!Number.isFinite(percentage) || percentage === null || percentage <= 0 || percentage > 100)) throw new Error(`Enter a percentage from 0.001 to 100 for ${ingredient}`);
    if (phase.length > 40 || note.length > 500) throw new Error(`Keep the details for ${ingredient} shorter`);
    return { ingredient, calculation: line.calculation, percentage, phase, note };
  });
  if (new Set(lines.map((line) => line.ingredient.toLocaleLowerCase())).size !== lines.length) throw new Error("Use each ingredient only once in a formula");
  if (lines.filter((line) => line.calculation === "remainder").length > 1) throw new Error("A formula can have only one remainder-to-100% ingredient");
  if (lines.filter((line) => line.calculation === "fixed").reduce((sum, line) => sum + (line.percentage ?? 0), 0) > 100) throw new Error("Fixed percentages cannot total more than 100%");
  const output = input.output ? { ...input.output, fillQuantity: productionQuantity(input.output.fillQuantity) } : undefined;

  const db = await initializeLabsData();
  const formulaId = `lab-formula-${randomUUID()}`;
  const now = new Date().toISOString();
  const transaction = await db.transaction("write");
  try {
    const existing = await transaction.execute({ sql: "SELECT id FROM lab_formulas WHERE lower(title) = lower(?)", args: [title] });
    if (existing.rows[0]) throw new Error("LAB_FORMULA_TITLE_EXISTS");
    for (const line of lines) {
      await transaction.execute({
        sql: `INSERT OR IGNORE INTO lab_ingredients (id, title, quantity_grams, quantity_known, reorder_point_grams, active, created_at, updated_at)
              VALUES (?, ?, 0, 0, 0, 1, ?, ?)`,
        args: [labIngredientId(line.ingredient), line.ingredient, now, now],
      });
    }
    await transaction.execute({ sql: "INSERT INTO lab_formulas (id, title, subtitle, notes, active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)", args: [formulaId, title, subtitle, notes, now, now] });
    for (const [index, line] of lines.entries()) {
      await transaction.execute({
        sql: `INSERT INTO lab_formula_ingredients (id, formula_id, ingredient_id, percentage, calculation, phase, note, sort_order)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [`${formulaId}-line-${index + 1}`, formulaId, labIngredientId(line.ingredient), line.percentage, line.calculation, line.phase || null, line.note || null, index],
      });
    }
    if (output) {
      const variant = await transaction.execute({
        sql: `SELECT piv.id FROM physical_inventory_variants piv
              JOIN physical_inventory_items pi ON pi.id = piv.physical_item_id
              WHERE piv.id = ? AND piv.active = 1 AND pi.active = 1`,
        args: [output.physicalVariantId],
      });
      if (!variant.rows[0]) throw new Error("LAB_OUTPUT_VARIANT_NOT_FOUND");
      await transaction.execute({
        sql: `INSERT INTO lab_formula_outputs (id, formula_id, physical_variant_id, fill_quantity, fill_unit, active, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
        args: [`lab-output-${randomUUID()}`, formulaId, output.physicalVariantId, output.fillQuantity, productionUnit(output.fillUnit), now, now],
      });
    }
    await transaction.commit();
  } catch (error) { await transaction.rollback(); throw error; } finally { transaction.close(); }
  const formula = await getLabFormula(formulaId);
  if (!formula) throw new Error("LAB_FORMULA_NOT_FOUND");
  return formula;
}

export async function updateLabFormulaOutput(input: {
  formulaId: string;
  physicalVariantId: string;
  fillQuantity: number;
  fillUnit: LabQuantityUnit;
}) {
  const fillQuantity = productionQuantity(input.fillQuantity);
  const fillUnit = productionUnit(input.fillUnit);
  const db = await initializeLabsData();
  const transaction = await db.transaction("write");
  const now = new Date().toISOString();
  try {
    const formula = await transaction.execute({ sql: "SELECT id FROM lab_formulas WHERE id = ? AND active = 1", args: [input.formulaId] });
    if (!formula.rows[0]) throw new Error("LAB_FORMULA_NOT_FOUND");
    const variant = await transaction.execute({
      sql: `SELECT piv.id FROM physical_inventory_variants piv
            JOIN physical_inventory_items pi ON pi.id = piv.physical_item_id
            WHERE piv.id = ? AND piv.active = 1 AND pi.active = 1`,
      args: [input.physicalVariantId],
    });
    if (!variant.rows[0]) throw new Error("LAB_OUTPUT_VARIANT_NOT_FOUND");
    await transaction.execute({
      sql: `INSERT INTO lab_formula_outputs (id, formula_id, physical_variant_id, fill_quantity, fill_unit, active, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 1, ?, ?)
            ON CONFLICT(formula_id) DO UPDATE SET physical_variant_id = excluded.physical_variant_id,
              fill_quantity = excluded.fill_quantity, fill_unit = excluded.fill_unit, active = 1, updated_at = excluded.updated_at`,
      args: [`lab-output-${randomUUID()}`, input.formulaId, input.physicalVariantId, fillQuantity, fillUnit, now, now],
    });
    await transaction.commit();
  } catch (error) { await transaction.rollback(); throw error; } finally { transaction.close(); }
  return getLabFormula(input.formulaId);
}

export async function updateLabIngredient(input: { id: string; quantityGrams: number; reorderPointGrams?: number; actor: string }) {
  const db = await initializeLabsData();
  const quantity = labQuantity(input.quantityGrams);
  const reorderPoint = input.reorderPointGrams === undefined ? undefined : labQuantity(input.reorderPointGrams);
  const transaction = await db.transaction("write");
  const now = new Date().toISOString();
  try {
    const existing = await transaction.execute({ sql: "SELECT quantity_grams, reorder_point_grams FROM lab_ingredients WHERE id = ? AND active = 1", args: [input.id] });
    const row = existing.rows[0];
    if (!row) throw new Error("LAB_INGREDIENT_NOT_FOUND");
    const before = numberValue(row.quantity_grams);
    const finalReorder = reorderPoint ?? numberValue(row.reorder_point_grams);
    await transaction.execute({ sql: "UPDATE lab_ingredients SET quantity_grams = ?, quantity_known = 1, reorder_point_grams = ?, updated_at = ? WHERE id = ?", args: [quantity, finalReorder, now, input.id] });
    await transaction.execute({ sql: `INSERT INTO lab_ingredient_ledger (id, ingredient_id, change_type, actor, quantity_before, quantity_after, quantity_delta, reference, created_at)
      VALUES (?, ?, 'manual_count', ?, ?, ?, ?, ?, ?)`, args: [randomUUID(), input.id, input.actor, before, quantity, quantity - before, `ingredient:${input.id}`, now] });
    await transaction.commit();
  } catch (error) { await transaction.rollback(); throw error; } finally { transaction.close(); }
  return getLabIngredients();
}

export async function createLabBatch(input: {
  formulaId: string;
  batchNumber: string;
  targetGrams: number;
  outputQuantity?: number;
  outputUnit?: LabQuantityUnit;
  actor: string;
}) {
  const db = await initializeLabsData();
  const batchNumber = input.batchNumber.trim();
  if (batchNumber.length < 1 || batchNumber.length > 80) throw new Error("Enter a batch number of up to 80 characters");
  const targetGrams = batchQuantity(input.targetGrams);
  const transaction = await db.transaction("write");
  const now = new Date().toISOString();
  try {
    const formula = await transaction.execute({ sql: "SELECT id FROM lab_formulas WHERE id = ? AND active = 1", args: [input.formulaId] });
    if (!formula.rows[0]) throw new Error("LAB_FORMULA_NOT_FOUND");
    const outputResult = await transaction.execute({
      sql: `SELECT fo.physical_variant_id, fo.fill_quantity, fo.fill_unit
            FROM lab_formula_outputs fo
            WHERE fo.formula_id = ? AND fo.active = 1`,
      args: [input.formulaId],
    });
    const outputRow = outputResult.rows[0];
    const output = outputRow ? {
      physicalVariantId: stringValue(outputRow.physical_variant_id),
      fillQuantity: numberValue(outputRow.fill_quantity),
      fillUnit: productionUnit(outputRow.fill_unit),
    } : null;
    const outputUnit = input.outputUnit ?? output?.fillUnit ?? "g";
    productionUnit(outputUnit);
    if (output && outputUnit !== output.fillUnit) throw new Error("LAB_OUTPUT_UNIT_MISMATCH");
    const outputQuantity = input.outputQuantity === undefined ? targetGrams : productionQuantity(input.outputQuantity);
    calculateBatchAllocation(outputQuantity, 0, outputUnit);
    const rows = await transaction.execute({ sql: `SELECT fi.ingredient_id, fi.percentage, fi.calculation, i.title, i.quantity_grams, i.quantity_known
      FROM lab_formula_ingredients fi JOIN lab_ingredients i ON i.id = fi.ingredient_id
      WHERE fi.formula_id = ? ORDER BY fi.sort_order`, args: [input.formulaId] });
    if (!rows.rows.length) throw new Error("LAB_FORMULA_HAS_NO_LINES");
    const lines = rows.rows.map((row) => ({ id: stringValue(row.ingredient_id), title: stringValue(row.title), percentage: row.percentage === null ? null : numberValue(row.percentage), calculation: stringValue(row.calculation), quantity: numberValue(row.quantity_grams), known: numberValue(row.quantity_known) === 1 }));
    const fixedTotal = lines.filter((line) => line.calculation === "fixed").reduce((sum, line) => sum + (line.percentage ?? 0), 0);
    const requirements = lines.flatMap((line) => {
      if (line.calculation === "manual") return [];
      const percentage = line.calculation === "remainder" ? 100 - fixedTotal : line.percentage ?? 0;
      return [{ ...line, required: Math.round(targetGrams * percentage * 10) / 1000 }];
    });
    const duplicate = await transaction.execute({ sql: "SELECT id FROM lab_batches WHERE batch_number = ?", args: [batchNumber] });
    if (duplicate.rows[0]) throw new Error("LAB_BATCH_ALREADY_EXISTS");
    const batchId = `lab-batch-${randomUUID()}`;
    await transaction.execute({ sql: "INSERT INTO lab_batches (id, formula_id, batch_number, target_grams, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)", args: [batchId, input.formulaId, batchNumber, targetGrams, input.actor, now] });
    await transaction.execute({
      sql: "INSERT INTO lab_batch_allocations (batch_id, total_quantity, quantity_unit, packaged_quantity, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)",
      args: [batchId, outputQuantity, outputUnit, now, now],
    });
    for (const line of requirements) {
      const deduction = planIngredientDeduction(line.quantity, line.known, line.required);
      if (deduction.status === "deducted") {
        await transaction.execute({ sql: "UPDATE lab_ingredients SET quantity_grams = ?, updated_at = ? WHERE id = ?", args: [deduction.after, now, line.id] });
        await transaction.execute({ sql: `INSERT INTO lab_ingredient_ledger (id, ingredient_id, batch_id, change_type, actor, quantity_before, quantity_after, quantity_delta, reference, created_at)
          VALUES (?, ?, ?, 'batch_deduct', ?, ?, ?, ?, ?, ?)`, args: [randomUUID(), line.id, batchId, input.actor, deduction.before, deduction.after, -deduction.deducted, batchNumber, now] });
      }
      await transaction.execute({ sql: "INSERT INTO lab_batch_ingredients (id, batch_id, ingredient_id, required_grams, quantity_before, quantity_after) VALUES (?, ?, ?, ?, ?, ?)", args: [randomUUID(), batchId, line.id, deduction.required, deduction.before, deduction.after] });
    }
    await transaction.commit();
    return { id: batchId, batchNumber, targetGrams, outputQuantity, outputUnit };
  } catch (error) { await transaction.rollback(); throw error; } finally { transaction.close(); }
}

export async function updateLabBatchPackaging(input: {
  batchId: string;
  addedQuantity: number;
  actor: string;
}) {
  const added = productionQuantity(input.addedQuantity);
  const db = await getTursoClient();
  const transaction = await db.transaction("write");
  const now = new Date().toISOString();
  try {
    const batch = await transaction.execute({
      sql: `SELECT b.id, b.formula_id, b.target_grams,
                   COALESCE(a.total_quantity, b.target_grams) AS total_quantity,
                   COALESCE(a.quantity_unit, 'g') AS quantity_unit,
                   COALESCE(a.packaged_quantity, 0) AS packaged_quantity,
                   fo.physical_variant_id, fo.fill_quantity, fo.fill_unit
            FROM lab_batches b
            LEFT JOIN lab_batch_allocations a ON a.batch_id = b.id
            LEFT JOIN lab_formula_outputs fo ON fo.formula_id = b.formula_id AND fo.active = 1
            WHERE b.id = ? LIMIT 1`,
      args: [input.batchId],
    });
    const row = batch.rows[0];
    if (!row) throw new Error("LAB_BATCH_NOT_FOUND");

    const total = productionQuantity(numberValue(row.total_quantity));
    const unit = productionUnit(row.quantity_unit);
    const current = productionQuantity(numberValue(row.packaged_quantity), true);
    const allocation = addPackagingIncrement(total, current, added, unit);

    const variantId = stringValue(row.physical_variant_id);
    if (!variantId) throw new Error("LAB_OUTPUT_NOT_LINKED");
    const fillUnit = productionUnit(row.fill_unit);
    if (unit !== fillUnit) throw new Error("LAB_OUTPUT_UNIT_MISMATCH");
    const finishedUnits = packagedUnits(added, unit, productionQuantity(numberValue(row.fill_quantity)), fillUnit);
    const variant = await transaction.execute({
      sql: `SELECT piv.id, piv.physical_item_id, piv.quantity, piv.quantity_known
            FROM physical_inventory_variants piv
            JOIN physical_inventory_items pi ON pi.id = piv.physical_item_id
            WHERE piv.id = ? AND piv.active = 1 AND pi.active = 1`,
      args: [variantId],
    });
    const variantRow = variant.rows[0];
    if (!variantRow) throw new Error("LAB_OUTPUT_VARIANT_NOT_FOUND");
    const before = numberValue(variantRow.quantity);
    const after = before + finishedUnits;
    if (!Number.isSafeInteger(after)) throw new Error("MASTER_INVENTORY_LIMIT");
    const itemId = stringValue(variantRow.physical_item_id);

    await transaction.execute({
      sql: `INSERT INTO lab_batch_allocations (batch_id, total_quantity, quantity_unit, packaged_quantity, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(batch_id) DO UPDATE SET packaged_quantity = excluded.packaged_quantity, updated_at = excluded.updated_at`,
      args: [input.batchId, allocation.total, allocation.unit, allocation.packaged, now, now],
    });
    await transaction.execute({
      sql: "UPDATE physical_inventory_variants SET quantity = ?, updated_at = ? WHERE id = ?",
      args: [after, now, variantId],
    });
    await transaction.execute({
      sql: `UPDATE physical_inventory_items
            SET quantity = COALESCE((SELECT SUM(quantity) FROM physical_inventory_variants WHERE physical_item_id = ? AND active = 1), 0),
                quantity_known = CASE WHEN EXISTS (SELECT 1 FROM physical_inventory_variants WHERE physical_item_id = ? AND active = 1 AND quantity_known = 0) THEN 0 ELSE 1 END,
                updated_at = ?
            WHERE id = ?`,
      args: [itemId, itemId, now, itemId],
    });
    await transaction.execute({
      sql: `INSERT INTO lab_batch_packaging_ledger
            (id, batch_id, physical_variant_id, actor, packaged_before, packaged_after, packaged_delta, finished_units, reference, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [randomUUID(), input.batchId, variantId, input.actor, current, allocation.packaged, added, finishedUnits, `production fill · ${variantId}`, now],
    });
    await transaction.commit();
  } catch (error) { await transaction.rollback(); throw error; } finally { transaction.close(); }
  return getLabBatchDetail(input.batchId);
}
