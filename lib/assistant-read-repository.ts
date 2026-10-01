import "server-only";

import { createHash, createHmac } from "node:crypto";
import type { DatabaseClient } from "@/lib/turso";
import { getMcpReadClient } from "@/lib/turso";
import {
  assistantQueryRequestSchema,
  assistantReportRequestSchema,
  DATASET_REGISTRY,
  MCP_REGISTRY_VERSION,
  datasetRequiresPii,
  type AssistantDatasetId,
  type AssistantPrincipal,
  type AssistantQueryRequest,
  type AssistantQueryResult,
  type DatasetDefinition,
} from "@/lib/mcp-contracts";

const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_ROWS = 250;
const MAX_PII_ROWS = 100;
const QUERY_TIMEOUT_MS = 10_000;

type SqlValue = string | number | null | Uint8Array;
type DatasetSpec = { from: string; fields: Record<string, string>; freshness: string; freshnessField?: string };

const specs: Record<AssistantDatasetId, DatasetSpec> = {
  sales: {
    from: "orders o", freshness: "Imported order timestamps", freshnessField: "o.imported_at",
    fields: { id: "o.id", source: "o.source", order_number: "o.order_number", currency: "o.currency", total_amount: "o.total_amount", subtotal_amount: "o.subtotal_amount", shipping_amount: "o.shipping_amount", tax_amount: "o.tax_amount", financial_status: "o.financial_status", fulfillment_status: "o.fulfillment_status", customer_name: "o.customer_name", customer_email: "o.customer_email", customer_phone: "o.customer_phone", source_created_at: "o.source_created_at", source_updated_at: "o.source_updated_at", cancelled_at: "o.cancelled_at", imported_at: "o.imported_at" },
  },
  orders: {
    from: "orders o", freshness: "Imported order timestamps", freshnessField: "o.imported_at",
    fields: { id: "o.id", source: "o.source", order_number: "o.order_number", customer_name: "o.customer_name", customer_email: "o.customer_email", customer_phone: "o.customer_phone", shipping_address_json: "o.shipping_address_json", currency: "o.currency", total_amount: "o.total_amount", financial_status: "o.financial_status", fulfillment_status: "o.fulfillment_status", cancelled_at: "o.cancelled_at", source_created_at: "o.source_created_at", source_updated_at: "o.source_updated_at", imported_at: "o.imported_at" },
  },
  order_items: {
    from: "order_items oi JOIN orders o ON o.id = oi.order_id", freshness: "Parent order import timestamps", freshnessField: "o.imported_at",
    fields: { id: "oi.id", order_id: "oi.order_id", order_number: "o.order_number", source: "o.source", title: "oi.title", variant_title: "oi.variant_title", sku: "oi.sku", quantity: "oi.quantity", unit_price_amount: "oi.unit_price_amount", source_created_at: "o.source_created_at" },
  },
  customers: {
    from: `(SELECT a.identity, r.customer_name AS name, r.email, r.phone, a.orders, a.total_spent, a.last_order_at, a.channels,
              CASE WHEN a.orders > 1 THEN 'repeat' WHEN r.email = '' AND r.phone = '' THEN 'guest' ELSE 'one-time' END AS type
            FROM (SELECT identity, COUNT(*) AS orders, SUM(total_amount) AS total_spent,
                         MAX(source_created_at) AS last_order_at, GROUP_CONCAT(DISTINCT source) AS channels
                  FROM (SELECT id, total_amount, source_created_at, source,
                               CASE WHEN trim(COALESCE(customer_email, '')) <> '' THEN 'email:' || lower(trim(customer_email))
                                    WHEN trim(COALESCE(customer_phone, '')) <> '' THEN 'phone:' || replace(replace(replace(replace(replace(replace(customer_phone, ' ', ''), '+', ''), '-', ''), '(', ''), ')', ''), '.', '')
                                    ELSE 'order:' || id END AS identity
                        FROM orders) normalized GROUP BY identity) a
            JOIN (SELECT identity, customer_name, email, phone,
                         ROW_NUMBER() OVER (PARTITION BY identity ORDER BY source_created_at DESC, id DESC) AS rn
                  FROM (SELECT id, customer_name, lower(trim(COALESCE(customer_email, ''))) AS email,
                               replace(replace(replace(replace(replace(replace(COALESCE(customer_phone, ''), ' ', ''), '+', ''), '-', ''), '(', ''), ')', ''), '.', '') AS phone,
                               source_created_at,
                               CASE WHEN trim(COALESCE(customer_email, '')) <> '' THEN 'email:' || lower(trim(customer_email))
                                    WHEN trim(COALESCE(customer_phone, '')) <> '' THEN 'phone:' || replace(replace(replace(replace(replace(replace(customer_phone, ' ', ''), '+', ''), '-', ''), '(', ''), ')', ''), '.', '')
                                    ELSE 'order:' || id END AS identity
                        FROM orders) identities) r ON r.identity = a.identity AND r.rn = 1) c`,
    freshness: "Derived from order imports", freshnessField: "c.last_order_at",
    fields: { id: "c.identity", name: "c.name", email: "c.email", phone: "c.phone", orders: "c.orders", total_spent: "c.total_spent", last_order_at: "c.last_order_at", type: "c.type", channels: "c.channels" },
  },
  shipments: {
    from: "shipments s LEFT JOIN orders o ON o.id = s.order_id", freshness: "Shipment sync timestamps", freshnessField: "s.last_synced_at",
    fields: { id: "s.id", order_id: "s.order_id", order_number: "o.order_number", provider: "s.provider", courier: "s.courier", service: "s.service", status: "s.status", tracking_url: "s.tracking_url", paid_at: "s.paid_at", collection_date: "s.collection_date", estimated_delivery_at: "s.estimated_delivery_at", last_synced_at: "s.last_synced_at" },
  },
  employees: {
    from: `(SELECT u.id, u.name, u.email, u.createdAt AS created_at, MAX(s.updatedAt) AS last_seen_at,
              CASE WHEN MAX(CASE WHEN s.updatedAt > datetime('now', '-5 minutes') THEN 1 ELSE 0 END) = 1 THEN 'active' ELSE 'offline' END AS status
            FROM "user" u LEFT JOIN "session" s ON s.userId = u.id GROUP BY u.id, u.name, u.email, u.createdAt) e`, freshness: "Staff directory timestamps", freshnessField: "e.last_seen_at",
    fields: { id: "e.id", name: "e.name", email: "e.email", status: "e.status", created_at: "e.created_at", last_seen_at: "e.last_seen_at" },
  },
  inventory: {
    from: "variants v JOIN products p ON p.id = v.product_id", freshness: "Variant sync timestamps", freshnessField: "v.last_synced_at",
    fields: { id: "v.id", product_id: "v.product_id", product: "p.title", variant: "v.title", sku: "v.sku", quantity: "v.available_quantity", sold7d: "COALESCE((SELECT SUM(oi.quantity) FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.variant_id=v.id AND o.source_created_at >= datetime('now','-7 days')),0)", sold30d: "COALESCE((SELECT SUM(oi.quantity) FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.variant_id=v.id AND o.source_created_at >= datetime('now','-30 days')),0)", reorder_point: "v.reorder_point", lead_time_days: "v.lead_time_days", mapping: "COALESCE((SELECT m.status FROM channel_mappings m WHERE m.variant_id=v.id AND m.channel='tiktok' AND m.active=1 LIMIT 1),'unmapped')", packaging_type: "v.packaging_type" },
  },
  physical_inventory: {
    from: "physical_inventory_items p", freshness: "Physical inventory timestamps", freshnessField: "p.updated_at",
    fields: { id: "p.id", title: "p.title", variant_title: "p.variant_label", quantity: "p.quantity", quantity_known: "p.quantity_known", packaging_type: "p.packaging_type", reorder_point: "p.reorder_point", lead_time_days: "p.lead_time_days", active: "p.active", updated_at: "p.updated_at" },
  },
  channel_inventory: {
    from: "channel_inventory ci", freshness: "Channel inventory sync timestamps", freshnessField: "ci.synced_at",
    fields: { id: "ci.id", variant_id: "ci.variant_id", channel: "ci.channel", shop_id: "ci.shop_id", external_product_id: "ci.external_product_id", external_sku_id: "ci.external_sku_id", available_quantity: "ci.available_quantity", synced_at: "ci.synced_at" },
  },
  channel_listings: {
    from: "physical_channel_listings l", freshness: "Channel listing update timestamps", freshnessField: "l.updated_at",
    fields: { id: "l.id", channel: "l.channel", external_product_id: "l.external_product_id", external_variant_id: "l.external_variant_id", title: "l.title", variant_title: "l.variant_title", channel_quantity: "l.channel_quantity", listing_kind: "l.listing_kind", mapping_status: "l.mapping_status", active: "l.active", updated_at: "l.updated_at" },
  },
  inventory_history: {
    from: "inventory_ledger l", freshness: "Inventory ledger timestamps", freshnessField: "l.created_at",
    fields: { id: "l.id", variant_id: "l.variant_id", inventory: "l.inventory", change_type: "l.change_type", actor: "l.actor", quantity_before: "l.quantity_before", quantity_after: "l.quantity_after", quantity_delta: "l.quantity_delta", reference: "l.reference", created_at: "l.created_at" },
  },
  packaging: {
    from: "packaging_materials p", freshness: "Packaging update timestamps", freshnessField: "p.updated_at",
    fields: { id: "p.id", title: "p.title", quantity: "p.quantity", reorder_point: "p.reorder_point", lead_time_days: "p.lead_time_days", active: "p.active", updated_at: "p.updated_at" },
  },
  labs: {
    from: `(SELECT i.id, 'ingredient' AS record_type, i.title, '' AS subtitle, '' AS notes, i.quantity_grams,
              i.quantity_known, i.reorder_point_grams, NULL AS formula_id, NULL AS batch_number, NULL AS target_grams,
              NULL AS actor, NULL AS created_at, i.updated_at FROM lab_ingredients i WHERE i.active=1
            UNION ALL SELECT f.id, 'formula', f.title, f.subtitle, f.notes, NULL, NULL, NULL, f.id, NULL, NULL, NULL, f.created_at, f.updated_at FROM lab_formulas f WHERE f.active=1
            UNION ALL SELECT b.id, 'batch', f.title, '', b.notes, NULL, NULL, NULL, b.formula_id, b.batch_number, b.target_grams, b.actor, b.created_at, b.updated_at
              FROM lab_batches b JOIN lab_formulas f ON f.id=b.formula_id) l`, freshness: "Labs record timestamps", freshnessField: "l.updated_at",
    fields: { id: "l.id", record_type: "l.record_type", title: "l.title", subtitle: "l.subtitle", notes: "l.notes", quantity_grams: "l.quantity_grams", quantity_known: "l.quantity_known", reorder_point_grams: "l.reorder_point_grams", formula_id: "l.formula_id", batch_number: "l.batch_number", target_grams: "l.target_grams", actor: "l.actor", created_at: "l.created_at", updated_at: "l.updated_at" },
  },
  affiliate_reporting: {
    from: "tiktok_affiliate_orders a", freshness: "Affiliate import timestamps", freshnessField: "a.imported_at",
    fields: { id: "a.id", source_order_id: "a.source_order_id", source_line_item_id: "a.source_line_item_id", product_title: "a.product_title", creator_username: "a.creator_username", quantity: "a.quantity", gross_amount_minor: "a.gross_amount_minor", estimated_commission_minor: "a.estimated_commission_minor", currency: "a.currency", status: "a.status", source_created_at: "a.source_created_at", source_updated_at: "a.source_updated_at", imported_at: "a.imported_at" },
  },
  ads_reporting: {
    from: "tiktok_ads_report_rows a", freshness: "Ads report fetch timestamps", freshnessField: "a.fetched_at",
    fields: { id: "a.id", advertiser_id: "a.advertiser_id", report_date: "a.report_date", report_type: "a.report_type", service_type: "a.service_type", data_level: "a.data_level", dimension_key: "a.dimension_key", provider_currency: "a.provider_currency", spend_minor: "a.spend_minor", attributed_revenue_minor: "a.attributed_revenue_minor", attributed_purchases: "a.attributed_purchases", impressions: "a.impressions", clicks: "a.clicks", attribution_window: "a.attribution_window", fetched_at: "a.fetched_at" },
  },
  alerts: {
    from: "inventory_alerts a", freshness: "Alert update timestamps", freshnessField: "a.last_seen_at",
    fields: { id: "a.id", alert_key: "a.alert_key", kind: "a.kind", severity: "a.severity", title: "a.title", detail: "a.detail", status: "a.status", first_seen_at: "a.first_seen_at", last_seen_at: "a.last_seen_at", resolved_at: "a.resolved_at" },
  },
  sync_status: {
    from: `(SELECT id, trigger, provider, status, started_at, finished_at, records_seen, records_changed,
              CASE WHEN status='succeeded' THEN finished_at ELSE NULL END AS last_successful_at, finished_at AS updated_at
            FROM sync_runs) s`, freshness: "Stored synchronization status", freshnessField: "s.updated_at",
    fields: { id: "s.id", trigger: "s.trigger", provider: "s.provider", status: "s.status", started_at: "s.started_at", finished_at: "s.finished_at", records_seen: "s.records_seen", records_changed: "s.records_changed", last_successful_at: "s.last_successful_at", updated_at: "s.updated_at" },
  },
};

class AssistantQueryError extends Error { code: string; constructor(code: string, message: string) { super(message); this.code = code; } }

function jsonValue(value: unknown): unknown {
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Uint8Array) return Buffer.from(value).toString("base64");
  return value;
}

function rowObject(row: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, jsonValue(value)]));
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

function cursorSignature(payload: Record<string, unknown>) {
  const secret = process.env.MCP_OAUTH_SECRET?.trim() || createHash("sha256").update(`serenity-hue-mcp:${process.cwd()}:development`).digest("hex");
  return createHmac("sha256", secret).update(canonical(payload)).digest("base64url");
}

function encodeCursor(payload: Record<string, unknown>) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${cursorSignature(payload)}`;
}

function decodeCursor(value: string, principal: AssistantPrincipal, query: AssistantQueryRequest, dataset: AssistantDatasetId, sort: { field: string; direction: "asc" | "desc" }) {
  const [body, signature] = value.split(".");
  if (!body || !signature) throw new AssistantQueryError("invalid_cursor", "The cursor is invalid.");
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { throw new AssistantQueryError("invalid_cursor", "The cursor is invalid."); }
  if (cursorSignature(payload) !== signature) throw new AssistantQueryError("invalid_cursor", "The cursor signature is invalid.");
  if (Number(payload.exp) < Date.now() || payload.userId !== principal.userId || payload.clientId !== principal.clientId || payload.dataset !== dataset || payload.registryVersion !== MCP_REGISTRY_VERSION || payload.query !== canonical({ ...query, cursor: undefined }) || canonical(payload.sort) !== canonical(sort)) throw new AssistantQueryError("invalid_cursor", "The cursor is expired or does not belong to this query.");
  return Number(payload.offset);
}

function validateDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}(?:T[^\s]+)?$/.test(value) || !Number.isFinite(Date.parse(value))) throw new AssistantQueryError("invalid_date", "Dates must be valid ISO dates.");
}

function escapeLike(value: string) { return value.replace(/[\\%_]/g, (match) => `\\${match}`); }
function valueForSql(value: unknown): SqlValue {
  if (typeof value === "string" || typeof value === "number" || value === null) return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  throw new AssistantQueryError("invalid_value", "Filter values must be strings, numbers, booleans, or null.");
}

function metricExpression(metric: string, definition: DatasetDefinition, spec: DatasetSpec) {
  const match = metric.match(/^(count|sum|average|minimum|maximum)(?::|\()([A-Za-z_][A-Za-z0-9_]*?)[)]?$/);
  if (metric === "count") return { sql: "COUNT(*)", alias: "count" };
  if (!match) throw new AssistantQueryError("unknown_metric", `Metric '${metric}' is not registered.`);
  const [, operation, field] = match;
  const metadata = definition.fields[field];
  if (!metadata?.aggregatable || !spec.fields[field]) throw new AssistantQueryError("unknown_metric", `Metric '${metric}' is not registered for this dataset.`);
  const fn = operation === "average" ? "AVG" : operation === "minimum" ? "MIN" : operation === "maximum" ? "MAX" : "SUM";
  return { sql: `${fn}(${spec.fields[field]})`, alias: `${operation}_${field}` };
}

async function withTimeout<T>(promise: Promise<T>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new AssistantQueryError("timeout", "The read-only query timed out.")), QUERY_TIMEOUT_MS); })]);
  } finally { if (timer) clearTimeout(timer); }
}

function fieldsForRequest(definition: DatasetDefinition, request: AssistantQueryRequest, principal: AssistantPrincipal) {
  const selected = request.select?.length ? [...new Set(request.select)] : Object.entries(definition.fields).filter(([, field]) => field.sensitivity !== "pii").map(([name]) => name);
  for (const field of selected) if (!definition.fields[field]) throw new AssistantQueryError("unknown_field", `Field '${field}' is not registered.`);
  if (datasetRequiresPii(definition, selected) && !principal.scopes.includes("assistant:pii")) throw new AssistantQueryError("pii_scope_required", "The requested fields require the assistant:pii scope.");
  if (request.groupBy?.some((field) => !definition.fields[field])) throw new AssistantQueryError("unknown_field", "A group-by field is not registered.");
  if (request.groupBy && datasetRequiresPii(definition, request.groupBy) && !principal.scopes.includes("assistant:pii")) throw new AssistantQueryError("pii_scope_required", "The requested grouping requires the assistant:pii scope.");
  if (request.include?.some((include) => !definition.includes.includes(include))) throw new AssistantQueryError("unknown_include", "The requested nested include is not registered.");
  return selected;
}

function normalizedFilterValue(filter: { operator: string; value: unknown }) {
  if (filter.operator === "in") {
    if (!Array.isArray(filter.value) || !filter.value.length || filter.value.length > 50) throw new AssistantQueryError("invalid_filter", "An in filter must contain 1 to 50 values.");
    return filter.value.map(valueForSql);
  }
  if (filter.operator === "between") {
    if (!Array.isArray(filter.value) || filter.value.length !== 2) throw new AssistantQueryError("invalid_filter", "A between filter must contain exactly two values.");
    return filter.value.map(valueForSql);
  }
  if (filter.operator === "contains") {
    if (typeof filter.value !== "string" || filter.value.length > 200) throw new AssistantQueryError("invalid_filter", "A contains filter needs a short text value.");
    return escapeLike(filter.value);
  }
  return valueForSql(filter.value);
}

async function addIncludes(db: DatabaseClient, dataset: AssistantDatasetId, rows: Array<Record<string, unknown>>, includes: string[]) {
  if (!rows.length || !includes.length || !["orders", "physical_inventory", "channel_listings", "labs"].includes(dataset)) return;
  const ids = rows.map((row) => row.id).filter((id): id is string => typeof id === "string");
  if (!ids.length) return;
  const placeholders = ids.map(() => "?").join(",");
  if (dataset === "orders" && includes.includes("items")) {
    const result = await db.execute({ sql: `SELECT order_id, id, title, variant_title, sku, quantity, unit_price_amount FROM order_items WHERE order_id IN (${placeholders}) ORDER BY order_id, id`, args: ids });
    const byOrder = new Map<string, unknown[]>();
    for (const row of result.rows) { const key = String(row.order_id); byOrder.set(key, [...(byOrder.get(key) ?? []), rowObject({ id: row.id, title: row.title, variant_title: row.variant_title, sku: row.sku, quantity: row.quantity, unit_price_amount: row.unit_price_amount })]); }
    for (const row of rows) row.items = byOrder.get(String(row.id)) ?? [];
  }
  if (dataset === "physical_inventory" && includes.includes("variants")) {
    const result = await db.execute({ sql: `SELECT physical_item_id, id, title, sku, quantity, quantity_known, updated_at FROM physical_inventory_variants WHERE physical_item_id IN (${placeholders}) AND active=1 ORDER BY physical_item_id, sort_order, title`, args: ids });
    const grouped = new Map<string, unknown[]>();
    for (const row of result.rows) { const key = String(row.physical_item_id); grouped.set(key, [...(grouped.get(key) ?? []), rowObject({ id: row.id, title: row.title, sku: row.sku, quantity: row.quantity, quantity_known: row.quantity_known, updated_at: row.updated_at })]); }
    for (const row of rows) row.variants = grouped.get(String(row.id)) ?? [];
  }
  if (dataset === "channel_listings" && includes.includes("components")) {
    const result = await db.execute({ sql: `SELECT listing_id, physical_variant_id, quantity_per_sale FROM physical_listing_components WHERE listing_id IN (${placeholders}) ORDER BY listing_id, id`, args: ids });
    const grouped = new Map<string, unknown[]>();
    for (const row of result.rows) { const key = String(row.listing_id); grouped.set(key, [...(grouped.get(key) ?? []), rowObject({ physical_variant_id: row.physical_variant_id, quantity_per_sale: row.quantity_per_sale })]); }
    for (const row of rows) row.components = grouped.get(String(row.id)) ?? [];
  }
  if (dataset === "channel_listings" && includes.includes("product_link")) {
    const result = await db.execute({ sql: `SELECT l.id, p.physical_item_id FROM physical_channel_listings l LEFT JOIN physical_channel_product_links p ON p.channel = l.channel AND p.external_product_id = l.external_product_id WHERE l.id IN (${placeholders})`, args: ids });
    const linked = new Map(result.rows.map((row) => [String(row.id), row.physical_item_id ?? null]));
    for (const row of rows) row.physical_item_id = linked.get(String(row.id)) ?? null;
  }
  if (dataset === "labs" && includes.includes("lines")) {
    const formulaIds = rows.filter((row) => row.record_type === "formula").map((row) => row.id).filter((id): id is string => typeof id === "string");
    if (formulaIds.length) {
      const formulaPlaceholders = formulaIds.map(() => "?").join(",");
      const result = await db.execute({ sql: `SELECT formula_id, ingredient_id, percentage, calculation, phase, note FROM lab_formula_ingredients WHERE formula_id IN (${formulaPlaceholders}) ORDER BY formula_id, sort_order`, args: formulaIds });
      const grouped = new Map<string, unknown[]>();
      for (const row of result.rows) { const key = String(row.formula_id); grouped.set(key, [...(grouped.get(key) ?? []), rowObject({ ingredient_id: row.ingredient_id, percentage: row.percentage, calculation: row.calculation, phase: row.phase, note: row.note })]); }
      for (const row of rows) if (row.record_type === "formula") row.lines = grouped.get(String(row.id)) ?? [];
    }
  }
  if (dataset === "labs" && includes.includes("packaging")) {
    const formulas = rows.filter((row) => row.record_type === "formula").map((row) => String(row.id));
    if (formulas.length) {
      const result = await db.execute({ sql: `SELECT formula_id, fill_quantity, fill_unit FROM lab_formula_packaging WHERE formula_id IN (${formulas.map(() => "?").join(",")})`, args: formulas });
      const byFormula = new Map(result.rows.map((row) => [String(row.formula_id), rowObject({ fill_quantity: row.fill_quantity, fill_unit: row.fill_unit })]));
      for (const row of rows) if (row.record_type === "formula") row.packaging = byFormula.get(String(row.id)) ?? null;
    }
    const batches = rows.filter((row) => row.record_type === "batch").map((row) => String(row.id));
    if (batches.length) {
      const result = await db.execute({ sql: `SELECT batch_id, total_quantity, quantity_unit, packaged_quantity FROM lab_batch_allocations WHERE batch_id IN (${batches.map(() => "?").join(",")})`, args: batches });
      const byBatch = new Map(result.rows.map((row) => [String(row.batch_id), rowObject({ total_quantity: row.total_quantity, quantity_unit: row.quantity_unit, packaged_quantity: row.packaged_quantity })]));
      for (const row of rows) if (row.record_type === "batch") row.packaging = byBatch.get(String(row.id)) ?? null;
    }
  }
}

export async function runAssistantQuery(principal: AssistantPrincipal, input: unknown): Promise<AssistantQueryResult> {
  const request = assistantQueryRequestSchema.parse(input);
  const definition = DATASET_REGISTRY[request.dataset as AssistantDatasetId];
  if (!definition) throw new AssistantQueryError("unknown_dataset", `Dataset '${request.dataset}' is not registered.`);
  const spec = specs[definition.id];
  const selected = fieldsForRequest(definition, request, principal);
  const pageSize = Math.min(request.pageSize ?? 50, principal.scopes.includes("assistant:pii") ? MAX_PII_ROWS : MAX_ROWS);
  const defaultSortField = selected.find((field) => definition.fields[field]?.sortable) ?? selected[0];
  const sort = request.sort ?? { field: defaultSortField, direction: "desc" as const };
  if (!definition.fields[sort.field]?.sortable && !request.groupBy?.includes(sort.field) && !request.metrics?.some((metric) => metricExpression(metric, definition, spec).alias === sort.field)) throw new AssistantQueryError("invalid_sort", `Sort field '${sort.field}' is not registered as sortable.`);

  const args: SqlValue[] = [];
  const conditions: string[] = [];
  for (const filter of request.filters ?? []) {
    const expression = spec.fields[filter.field];
    const metadata = definition.fields[filter.field];
    if (!expression || !metadata?.filterable) throw new AssistantQueryError("unknown_filter", `Field '${filter.field}' cannot be filtered.`);
    const value = normalizedFilterValue(filter);
    if (filter.operator === "in" || filter.operator === "between") {
      const values = value as SqlValue[];
      if (filter.operator === "between") { conditions.push(`${expression} BETWEEN ? AND ?`); args.push(...values); }
      else { conditions.push(`${expression} IN (${values.map(() => "?").join(",")})`); args.push(...values); }
    } else {
      if (filter.operator === "contains") { conditions.push(`CAST(${expression} AS TEXT) LIKE ? ESCAPE '\\'`); args.push(`%${value}%`); }
      else { const operator = ({ eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" } as Record<string, string>)[filter.operator]; conditions.push(`${expression} ${operator} ?`); args.push(value as SqlValue); }
    }
  }
  if (request.dateRange) {
    const dateField = request.dateRange.field ?? definition.dateFields[0];
    if (!dateField || !definition.dateFields.includes(dateField) || !spec.fields[dateField]) throw new AssistantQueryError("invalid_date_range", "The requested date field is not registered for this dataset.");
    validateDate(request.dateRange.start); validateDate(request.dateRange.end);
    if (request.dateRange.end < request.dateRange.start) throw new AssistantQueryError("invalid_date_range", "The date range ends before it starts.");
    conditions.push(`${spec.fields[dateField]} >= ? AND ${spec.fields[dateField]} <= ?`); args.push(request.dateRange.start, request.dateRange.end);
  }

  const groupBy = request.groupBy ?? [];
  const selectParts = groupBy.map((field) => spec.fields[field]).concat(
    request.metrics?.length ? request.metrics.map((metric) => metricExpression(metric, definition, spec).sql) : selected.map((field) => spec.fields[field]),
  );
  const aliases = groupBy.concat(request.metrics?.length ? request.metrics.map((metric) => metricExpression(metric, definition, spec).alias) : selected);
  const selectSql = selectParts.map((expression, index) => `${expression} AS "${aliases[index]}"`).join(", ");
  const groupSql = groupBy.length ? ` GROUP BY ${groupBy.map((field) => spec.fields[field]).join(", ")}` : "";
  let sortExpression = spec.fields[sort.field] || (aliases.includes(sort.field) ? `"${sort.field}"` : null);
  if (groupBy.length && aliases.includes(sort.field)) sortExpression = `"${sort.field}"`;
  if (!sortExpression) throw new AssistantQueryError("invalid_sort", "The sort definition is not registered.");
  const whereSql = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  const offset = request.cursor ? decodeCursor(request.cursor, principal, request, definition.id, sort) : 0;
  const sql = `SELECT ${selectSql} FROM ${spec.from}${whereSql}${groupSql} ORDER BY ${sortExpression} ${sort.direction.toUpperCase()} LIMIT ? OFFSET ?`;
  args.push(pageSize + 1, offset);
  const db = await getMcpReadClient();
  const result = await withTimeout(db.execute({ sql, args }));
  const rows = result.rows.slice(0, pageSize).map((row) => {
    const value = rowObject(row as Record<string, unknown>);
    if (definition.id === "customers" && typeof value.id === "string") value.id = `customer:${createHash("sha256").update(value.id).digest("hex").slice(0, 16)}`;
    return value;
  });
  await addIncludes(db, definition.id, rows, request.include ?? []);
  const truncated = result.rows.length > pageSize;
  const latest = spec.freshnessField ? await withTimeout(db.execute(`SELECT MAX(${spec.freshnessField}) AS latest_at FROM ${spec.from}`)) : { rows: [] };
  const latestAt = latest.rows[0]?.latest_at ? String(latest.rows[0].latest_at) : null;
  const nextCursor = truncated ? encodeCursor({ userId: principal.userId, clientId: principal.clientId, dataset: definition.id, registryVersion: MCP_REGISTRY_VERSION, query: canonical({ ...request, cursor: undefined }), sort, offset: offset + pageSize, exp: Date.now() + 15 * 60 * 1000 }) : null;
  const warnings: string[] = [];
  if (definition.fields.shipping_address_json && selected.includes("shipping_address_json")) warnings.push("Shipping addresses are sensitive customer data; handle and retain them only for the approved business purpose.");
  if (truncated) warnings.push("The result was truncated; use nextCursor to continue.");
  const response: AssistantQueryResult = { dataset: definition.id, registryVersion: MCP_REGISTRY_VERSION, returnedColumns: aliases, rows, resultCount: rows.length, truncated, nextCursor, asOf: new Date().toISOString(), freshness: { source: spec.freshness, latestAt, note: definition.freshness }, warnings };
  let serialized = JSON.stringify(response);
  while (Buffer.byteLength(serialized, "utf8") > MAX_RESPONSE_BYTES && response.rows.length > 0) {
    response.rows.pop(); response.truncated = true; response.warnings = [...new Set([...response.warnings, "The response byte limit was reached; fewer rows were returned."])]; serialized = JSON.stringify(response);
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_RESPONSE_BYTES) throw new AssistantQueryError("response_too_large", "A single result exceeds the response size limit.");
  return response;
}

export function assistantQueryError(error: unknown) {
  if (error instanceof AssistantQueryError) return error;
  if (error instanceof Error && error.name === "ZodError") return new AssistantQueryError("invalid_request", "The query request did not match the public assistant contract.");
  return new AssistantQueryError("query_failed", "The read-only query could not be completed.");
}

function numeric(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function reportDateBounds(request: { start?: string; end?: string }) {
  if (Boolean(request.start) !== Boolean(request.end)) throw new AssistantQueryError("invalid_date_range", "Reports require both start and end when a date range is supplied.");
  if (!request.start || !request.end) return null;
  validateDate(request.start); validateDate(request.end);
  if (request.end < request.start) throw new AssistantQueryError("invalid_date_range", "The date range ends before it starts.");
  const start = /^\d{4}-\d{2}-\d{2}$/.test(request.start) ? `${request.start}T00:00:00.000Z` : request.start;
  const end = /^\d{4}-\d{2}-\d{2}$/.test(request.end) ? `${request.end}T23:59:59.999Z` : request.end;
  return { start, end };
}

/**
 * Read-only sales facts used by the reports that need KPI semantics. This is
 * deliberately kept on the MCP read connection and mirrors the pure KPI rule:
 * paid, non-cancelled line sales are reduced by capped processed refunds.
 */
async function getAssistantSalesFacts(request: { start?: string; end?: string }) {
  const bounds = reportDateBounds(request);
  const db = await getMcpReadClient();
  const saleConditions: string[] = [];
  const saleArgs: SqlValue[] = [];
  if (bounds) {
    saleConditions.push(`(o.source_created_at >= ? AND o.source_created_at <= ?
      OR EXISTS (SELECT 1 FROM shopify_refund_line_items sr WHERE sr.order_id = o.id AND sr.processed_at >= ? AND sr.processed_at <= ?)
      OR EXISTS (SELECT 1 FROM tiktok_after_sales_line_items tr WHERE tr.order_id = o.id AND tr.source_updated_at >= ? AND tr.source_updated_at <= ?))`);
    saleArgs.push(bounds.start, bounds.end, bounds.start, bounds.end, bounds.start, bounds.end);
  }
  const refundConditions: string[] = [];
  const refundArgs: SqlValue[] = [];
  if (bounds) {
    refundConditions.push("processed_at >= ? AND processed_at <= ?");
    refundArgs.push(bounds.start, bounds.end);
  }
  const [sales, refunds] = await Promise.all([
    withTimeout(db.execute({
      sql: `SELECT o.id AS order_id, o.source, o.source_created_at, o.financial_status, o.cancelled_at,
                   oi.id AS line_item_id, oi.source_line_item_id, oi.title, oi.quantity, oi.unit_price_amount
            FROM orders o JOIN order_items oi ON oi.order_id = o.id
            ${saleConditions.length ? `WHERE ${saleConditions.join(" AND ")}` : ""}
            ORDER BY o.source_created_at ASC, o.id ASC, oi.id ASC`,
      args: saleArgs,
    })),
    withTimeout(db.execute({
      sql: `SELECT order_id, source_line_item_id, quantity, processed_at
            FROM shopify_refund_line_items
            ${refundConditions.length ? `WHERE ${refundConditions.join(" AND ")}` : ""}
            UNION ALL
            SELECT order_id, source_line_item_id, quantity, source_updated_at AS processed_at
            FROM tiktok_after_sales_line_items
            WHERE event_type = 'return' AND return_type = 'RETURN_AND_REFUND'
              AND status IN ('RETURN_OR_REFUND_REQUEST_SUCCESS', 'RETURN_OR_REFUND_REQUEST_COMPLETE')
              ${bounds ? "AND source_updated_at >= ? AND source_updated_at <= ?" : ""}
            ORDER BY processed_at ASC`,
      args: bounds ? [...refundArgs, bounds.start, bounds.end] : [],
    })),
  ]);
  const freshness = await withTimeout(db.execute("SELECT MAX(imported_at) AS latest_at FROM orders"));
  return { sales: sales.rows as Array<Record<string, unknown>>, refunds: refunds.rows as Array<Record<string, unknown>>, bounds, latestAt: freshness.rows[0]?.latest_at ? String(freshness.rows[0].latest_at) : null };
}

async function getAssistantSalesReport(request: { start?: string; end?: string; limit?: number }) {
  const { sales, refunds, bounds, latestAt } = await getAssistantSalesFacts(request);
  const selectedStart = bounds?.start ?? null;
  const selectedEnd = bounds?.end ?? null;
  const salesByLine = new Map<string, { orderId: string; channel: string; saleDate: string; title: string; quantity: number; unitPrice: number; eligible: boolean }>();
  const products = new Map<string, { title: string; netUnits: number; netRevenue: number }>();
  const channels = new Map<string, { channel: string; netUnits: number; netRevenue: number; orders: Set<string> }>();
  const orderIds = new Set<string>();
  for (const row of sales) {
    const orderId = String(row.order_id);
    const lineId = String(row.source_line_item_id ?? row.line_item_id);
    const saleDate = String(row.source_created_at ?? "");
    const eligible = !row.cancelled_at && String(row.financial_status ?? "") !== "pending";
    const line = { orderId, channel: String(row.source ?? "unknown"), saleDate, title: String(row.title ?? "Unknown product"), quantity: numeric(row.quantity), unitPrice: numeric(row.unit_price_amount), eligible };
    salesByLine.set(`${orderId}:${lineId}`, line);
    const inRange = !bounds || (saleDate >= selectedStart! && saleDate <= selectedEnd!);
    if (!eligible || !inRange) continue;
    orderIds.add(orderId);
    const product = products.get(line.title) ?? { title: line.title, netUnits: 0, netRevenue: 0 };
    product.netUnits += line.quantity; product.netRevenue += line.quantity * line.unitPrice; products.set(line.title, product);
    const channel = channels.get(line.channel) ?? { channel: line.channel, netUnits: 0, netRevenue: 0, orders: new Set<string>() };
    channel.netUnits += line.quantity; channel.netRevenue += line.quantity * line.unitPrice; channel.orders.add(orderId); channels.set(line.channel, channel);
  }
  const refundedByLine = new Map<string, number>();
  let refundEvents = 0;
  let refundedUnits = 0;
  for (const row of refunds) {
    const key = `${String(row.order_id)}:${String(row.source_line_item_id)}`;
    const line = salesByLine.get(key);
    if (!line?.eligible) continue;
    const remaining = Math.max(0, line.quantity - (refundedByLine.get(key) ?? 0));
    const units = Math.min(Math.max(0, numeric(row.quantity)), remaining);
    if (!units) continue;
    refundedByLine.set(key, (refundedByLine.get(key) ?? 0) + units);
    refundEvents += 1; refundedUnits += units;
    const product = products.get(line.title) ?? { title: line.title, netUnits: 0, netRevenue: 0 };
    product.netUnits -= units; product.netRevenue -= units * line.unitPrice; products.set(line.title, product);
    const channel = channels.get(line.channel) ?? { channel: line.channel, netUnits: 0, netRevenue: 0, orders: new Set<string>() };
    channel.netUnits -= units; channel.netRevenue -= units * line.unitPrice; channels.set(line.channel, channel);
  }
  const productRows = [...products.values()].filter((row) => row.netUnits !== 0 || row.netRevenue !== 0).sort((left, right) => right.netRevenue - left.netRevenue || right.netUnits - left.netUnits || left.title.localeCompare(right.title));
  const channelRows = [...channels.values()].map((row) => ({ channel: row.channel, netUnits: row.netUnits, netSales: row.netRevenue, orders: row.orders.size })).sort((left, right) => right.netSales - left.netSales || left.channel.localeCompare(right.channel));
  const netSales = productRows.reduce((total, row) => total + row.netRevenue, 0);
  const netUnits = productRows.reduce((total, row) => total + row.netUnits, 0);
  return {
    start: request.start ?? null,
    end: request.end ?? null,
    metrics: { netSales, orders: orderIds.size, netUnits, refundEvents, refundedUnits },
    products: productRows.slice(0, request.limit ?? 50),
    channels: channelRows,
    resultCount: productRows.length,
    truncated: productRows.length > (request.limit ?? 50),
    asOf: new Date().toISOString(),
    freshness: { source: "Imported orders and processed refund records", latestAt, note: "Freshness is based on the latest stored order import." },
    warnings: ["Amounts are minor currency units. Net sales exclude pending/cancelled orders and subtract capped processed line refunds.", ...(refundEvents ? ["Refunds are applied on their processed date and capped at the sold quantity per line."] : [])],
  };
}

export async function getAssistantReport(principal: AssistantPrincipal, input: unknown) {
  const request = assistantReportRequestSchema.parse(input);
  const limit = Math.min(Math.max(1, Number(request.limit ?? 20)), principal.scopes.includes("assistant:pii") ? 100 : 50);
  if (request.report === "refunds") {
    const end = request.end ?? new Date().toISOString();
    const start = request.start ?? new Date(Date.now() - 29 * 86_400_000).toISOString();
    validateDate(start); validateDate(end);
    if (end < start) throw new AssistantQueryError("invalid_date_range", "The date range ends before it starts.");
    const db = await getMcpReadClient();
    const result = await withTimeout(db.execute({
      sql: `SELECT 'shopify' AS channel, o.order_number, r.source_line_item_id, r.quantity, r.processed_at
            FROM shopify_refund_line_items r JOIN orders o ON o.id = r.order_id
            WHERE r.processed_at >= ? AND r.processed_at <= ?
            UNION ALL
            SELECT 'tiktok' AS channel, o.order_number, r.source_line_item_id, r.quantity, r.source_updated_at AS processed_at
            FROM tiktok_after_sales_line_items r JOIN orders o ON o.id = r.order_id
            WHERE r.event_type = 'return' AND r.return_type = 'RETURN_AND_REFUND'
              AND r.status IN ('RETURN_OR_REFUND_REQUEST_SUCCESS', 'RETURN_OR_REFUND_REQUEST_COMPLETE')
              AND r.source_updated_at >= ? AND r.source_updated_at <= ?
            ORDER BY processed_at DESC LIMIT ?`,
      args: [start, end, start, end, limit],
    }));
    return { report: "refunds", dataset: "orders", registryVersion: MCP_REGISTRY_VERSION, start, end, returnedColumns: ["channel", "order_number", "source_line_item_id", "quantity", "processed_at"], rows: result.rows.map((row) => rowObject(row as Record<string, unknown>)), resultCount: result.rows.length, truncated: result.rows.length >= limit, nextCursor: null, asOf: new Date().toISOString(), freshness: { source: "Processed refund records", latestAt: result.rows[0]?.processed_at ? String(result.rows[0].processed_at) : null, note: "Refund events are read from stored Shopify and TikTok after-sales records." }, warnings: ["Refund quantities are line-level events; net revenue remains defined by the refund-aware KPI report."] };
  }
  if (request.start && !request.end || request.end && !request.start) throw new AssistantQueryError("invalid_date_range", "Reports require both start and end when a date range is supplied.");
  if (["top_products", "net_sales", "channel_comparison"].includes(request.report)) {
    const facts = await getAssistantSalesReport({ start: request.start, end: request.end, limit });
    if (request.report === "top_products") return { report: request.report, dataset: "order_items", registryVersion: MCP_REGISTRY_VERSION, returnedColumns: ["title", "netUnits", "netRevenue"], rows: facts.products, products: facts.products, resultCount: facts.resultCount, truncated: facts.truncated, nextCursor: null, asOf: facts.asOf, freshness: facts.freshness, warnings: facts.warnings };
    if (request.report === "channel_comparison") return { report: request.report, dataset: "sales", registryVersion: MCP_REGISTRY_VERSION, returnedColumns: ["channel", "netUnits", "netSales", "orders"], rows: facts.channels, channels: facts.channels, resultCount: facts.channels.length, truncated: false, nextCursor: null, asOf: facts.asOf, freshness: facts.freshness, warnings: facts.warnings };
    return { report: request.report, dataset: "sales", registryVersion: MCP_REGISTRY_VERSION, returnedColumns: ["title", "netUnits", "netRevenue"], rows: facts.products, nextCursor: null, ...facts };
  }
  const dateRange = request.start && request.end ? { start: request.start, end: request.end } : undefined;
  const reports: Record<string, { dataset: AssistantDatasetId; groupBy?: string[]; metrics?: string[]; select?: string[]; sort?: { field: string; direction: "asc" | "desc" }; filters?: Array<{ field: string; operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains" | "in" | "between"; value: unknown }> }> = {
    customer_performance: { dataset: "customers", select: ["id", "name", "orders", "total_spent", "last_order_at", "type"], sort: { field: "total_spent", direction: "desc" } },
    inventory_health: { dataset: "physical_inventory", select: ["id", "title", "quantity", "quantity_known", "reorder_point", "lead_time_days"], sort: { field: "quantity", direction: "asc" } },
    affiliate_performance: { dataset: "affiliate_reporting", groupBy: ["creator_username"], metrics: ["sum:quantity", "sum:gross_amount_minor", "sum:estimated_commission_minor"], sort: { field: "sum_gross_amount_minor", direction: "desc" } },
    advertising_performance: { dataset: "ads_reporting", groupBy: ["report_date"], metrics: ["sum:spend_minor", "sum:attributed_revenue_minor", "sum:attributed_purchases"], sort: { field: "report_date", direction: "desc" } },
    packaging_requirements: { dataset: "packaging", select: ["id", "title", "quantity", "reorder_point", "lead_time_days"], sort: { field: "quantity", direction: "asc" } },
    labs_usage: { dataset: "labs", select: ["id", "record_type", "title", "quantity_grams", "reorder_point_grams", "formula_id", "batch_number", "target_grams"], sort: { field: "title", direction: "asc" } },
    alerts: { dataset: "alerts", select: ["id", "kind", "severity", "title", "detail", "status", "last_seen_at"], filters: [{ field: "status", operator: "eq", value: "active" }], sort: { field: "severity", direction: "asc" } },
    sync_status: { dataset: "sync_status", select: ["id", "provider", "status", "started_at", "finished_at", "records_seen", "records_changed", "last_successful_at"], sort: { field: "started_at", direction: "desc" } },
  };
  if (!request.report || !reports[request.report]) throw new AssistantQueryError("unknown_report", "The requested report is not registered.");
  if (request.report === "customer_performance" && !principal.scopes.includes("assistant:pii")) throw new AssistantQueryError("pii_scope_required", "Customer performance requires the assistant:pii scope.");
  return runAssistantQuery(principal, { ...reports[request.report], dateRange, pageSize: limit });
}
