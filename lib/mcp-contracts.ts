import { z } from "zod";
import type { AssistantWriteScope } from "@/lib/mcp-write-contracts";

export const MCP_REGISTRY_VERSION = "2026-09-14-v1" as const;

export type AssistantScope = "assistant:read" | "assistant:pii" | AssistantWriteScope;

export type AssistantDatasetId =
  | "sales"
  | "orders"
  | "order_items"
  | "customers"
  | "shipments"
  | "employees"
  | "inventory"
  | "physical_inventory"
  | "channel_inventory"
  | "channel_listings"
  | "inventory_history"
  | "packaging"
  | "labs"
  | "affiliate_reporting"
  | "ads_reporting"
  | "alerts"
  | "sync_status";

export type AssistantSensitivity = "operational" | "pii";
export type AssistantFieldType = "string" | "integer" | "number" | "boolean" | "date" | "json";

export type DatasetField = {
  type: AssistantFieldType;
  description: string;
  sensitivity: AssistantSensitivity;
  filterable?: boolean;
  sortable?: boolean;
  aggregatable?: boolean;
};

export type DatasetDefinition = {
  id: AssistantDatasetId;
  title: string;
  description: string;
  freshness: string;
  dateFields: string[];
  fields: Record<string, DatasetField>;
  metrics: string[];
  includes: string[];
  examples: string[];
};

const operational = (type: AssistantFieldType, description: string, options: Partial<DatasetField> = {}): DatasetField => ({
  type,
  description,
  sensitivity: "operational",
  ...options,
});

const pii = (type: AssistantFieldType, description: string, options: Partial<DatasetField> = {}): DatasetField => ({
  type,
  description,
  sensitivity: "pii",
  ...options,
});

const definitions: DatasetDefinition[] = [
  {
    id: "sales", title: "Sales and KPIs",
    description: "Order-level sales facts. Amounts are stored in minor currency units and returned as numbers in those units.",
    freshness: "Latest imported order and refund records; see sync_status for source freshness.",
    dateFields: ["source_created_at", "source_updated_at", "cancelled_at"],
    fields: {
      id: operational("string", "Internal order identifier", { sortable: true }), source: operational("string", "shopify or tiktok", { filterable: true, sortable: true }),
      order_number: operational("string", "Channel order number", { filterable: true, sortable: true }), currency: operational("string", "ISO currency", { filterable: true }),
      total_amount: operational("integer", "Gross order total in minor currency units", { aggregatable: true, sortable: true }), subtotal_amount: operational("integer", "Subtotal in minor currency units", { aggregatable: true }),
      shipping_amount: operational("integer", "Shipping charge in minor currency units", { aggregatable: true }), tax_amount: operational("integer", "Tax in minor currency units", { aggregatable: true }),
      financial_status: operational("string", "Payment state", { filterable: true }), fulfillment_status: operational("string", "Fulfillment state", { filterable: true }),
      customer_name: pii("string", "Customer name", { filterable: true }), customer_email: pii("string", "Customer email", { filterable: true }), customer_phone: pii("string", "Customer phone", { filterable: true }),
      source_created_at: operational("date", "Channel order creation timestamp", { filterable: true, sortable: true }), source_updated_at: operational("date", "Channel order update timestamp", { filterable: true, sortable: true }),
      cancelled_at: operational("date", "Cancellation timestamp, if cancelled", { filterable: true }), imported_at: operational("date", "Import timestamp", { sortable: true }),
    },
    metrics: ["count", "sum", "average", "minimum", "maximum"], includes: ["items"],
    examples: ["Top orders by total_amount", "Sales from tiktok in the last 30 days"],
  },
  {
    id: "orders", title: "Orders", description: "Operational order records with optional registered line-item includes.", freshness: "Imported channel order records.",
    dateFields: ["source_created_at", "source_updated_at", "cancelled_at"],
    fields: {
      id: operational("string", "Internal order identifier", { sortable: true }), source: operational("string", "Order channel", { filterable: true, sortable: true }), order_number: operational("string", "Channel order number", { filterable: true, sortable: true }),
      customer_name: pii("string", "Customer name", { filterable: true }), customer_email: pii("string", "Customer email", { filterable: true }), customer_phone: pii("string", "Customer phone", { filterable: true }), shipping_address_json: pii("json", "Customer shipping address", { filterable: false }),
      currency: operational("string", "ISO currency", { filterable: true }), total_amount: operational("integer", "Order total in minor currency units", { aggregatable: true, sortable: true }), financial_status: operational("string", "Payment state", { filterable: true }), fulfillment_status: operational("string", "Fulfillment state", { filterable: true }), cancelled_at: operational("date", "Cancellation timestamp", { filterable: true }),
      source_created_at: operational("date", "Channel order creation timestamp", { filterable: true, sortable: true }), source_updated_at: operational("date", "Channel order update timestamp", { filterable: true, sortable: true }), imported_at: operational("date", "Import timestamp", { sortable: true }),
    }, metrics: ["count", "sum", "average", "minimum", "maximum"], includes: ["items"], examples: ["Show TikTok orders from last month"],
  },
  {
    id: "order_items", title: "Order items", description: "Line-level order facts linked to their order number.", freshness: "Imported channel order records.", dateFields: ["source_created_at"],
    fields: {
      id: operational("string", "Line-item identifier", { sortable: true }), order_id: operational("string", "Parent order identifier", { filterable: true }), order_number: operational("string", "Channel order number", { filterable: true, sortable: true }), source: operational("string", "Order channel", { filterable: true }),
      title: operational("string", "Product title", { filterable: true, sortable: true }), variant_title: operational("string", "Variant title", { filterable: true }), sku: operational("string", "SKU", { filterable: true }), quantity: operational("integer", "Units sold", { aggregatable: true, sortable: true }), unit_price_amount: operational("integer", "Unit price in minor currency units", { aggregatable: true }), source_created_at: operational("date", "Parent order creation timestamp", { filterable: true, sortable: true }),
    }, metrics: ["count", "sum", "average", "minimum", "maximum"], includes: [], examples: ["Best-selling products by quantity"],
  },
  {
    id: "customers", title: "Customers", description: "Derived customer identities and purchase performance; contact fields require the PII scope.", freshness: "Derived from imported orders.", dateFields: ["last_order_at"],
    fields: {
      id: operational("string", "Stable derived customer identifier", { sortable: true }), name: pii("string", "Customer name", { filterable: true, sortable: true }), email: pii("string", "Customer email", { filterable: true }), phone: pii("string", "Customer phone", { filterable: true }),
      orders: operational("integer", "Number of orders", { aggregatable: true, sortable: true }), total_spent: operational("integer", "Total spent in minor currency units", { aggregatable: true, sortable: true }), last_order_at: operational("date", "Most recent order timestamp", { sortable: true }), type: operational("string", "repeat, one-time, or guest", { filterable: true }), channels: operational("string", "Channels used", { filterable: true }),
    }, metrics: ["count", "sum", "average", "minimum", "maximum"], includes: [], examples: ["Customers with more than one order"],
  },
  {
    id: "shipments", title: "Shipments", description: "Parcel2Go shipment and delivery status records.", freshness: "Latest imported shipment records.", dateFields: ["paid_at", "collection_date", "estimated_delivery_at", "last_synced_at"],
    fields: {
      id: operational("string", "Shipment identifier", { sortable: true }), order_id: operational("string", "Linked order identifier", { filterable: true }), order_number: operational("string", "Linked order number", { filterable: true }), provider: operational("string", "Shipment provider", { filterable: true }), courier: operational("string", "Courier name", { filterable: true }), service: operational("string", "Service name", { filterable: true }), status: operational("string", "Shipment status", { filterable: true, sortable: true }), tracking_url: operational("string", "Tracking URL", { filterable: false }), paid_at: operational("date", "Payment timestamp", { filterable: true, sortable: true }), collection_date: operational("date", "Collection date", { filterable: true }), estimated_delivery_at: operational("date", "Estimated delivery timestamp", { filterable: true, sortable: true }), last_synced_at: operational("date", "Last shipment sync timestamp", { sortable: true }),
    }, metrics: ["count"], includes: [], examples: ["Shipments still in transit"],
  },
  {
    id: "employees", title: "Employees", description: "Approved operational staff directory fields only; authentication secrets are excluded.", freshness: "Better Auth staff directory and session presence.", dateFields: ["created_at", "last_seen_at"],
    fields: { id: operational("string", "Staff identifier"), name: operational("string", "Staff display name", { filterable: true, sortable: true }), email: pii("string", "Operational staff email", { filterable: true }), status: operational("string", "Active or offline presence", { filterable: true }), created_at: operational("date", "Directory creation timestamp", { sortable: true }), last_seen_at: operational("date", "Last observed presence", { sortable: true }) },
    metrics: ["count"], includes: [], examples: ["Which staff are currently active?"],
  },
  {
    id: "inventory", title: "Inventory", description: "Legacy Shopify mirror inventory, kept separate from physical and channel inventory.", freshness: "Latest product/channel sync records.", dateFields: ["last_synced_at"],
    fields: { id: operational("string", "Variant identifier"), product_id: operational("string", "Product identifier", { filterable: true }), product: operational("string", "Product title", { filterable: true, sortable: true }), variant: operational("string", "Variant title", { filterable: true, sortable: true }), sku: operational("string", "SKU", { filterable: true }), quantity: operational("integer", "Available quantity", { aggregatable: true, sortable: true }), sold7d: operational("integer", "Units sold in the last 7 days", { aggregatable: true }), sold30d: operational("integer", "Units sold in the last 30 days", { aggregatable: true }), reorder_point: operational("integer", "Reorder threshold", { aggregatable: true }), lead_time_days: operational("integer", "Lead time in days", { aggregatable: true }), mapping: operational("string", "TikTok mapping state", { filterable: true }), packaging_type: operational("string", "Packaging type", { filterable: true }) },
    metrics: ["count", "sum", "average", "minimum", "maximum"], includes: [], examples: ["Which variants are low in stock?"],
  },
  {
    id: "physical_inventory", title: "Physical inventory", description: "Counted master stock, deliberately distinct from channel inventory and packaging.", freshness: "Latest physical stock count and adjustments.", dateFields: ["updated_at"],
    fields: { id: operational("string", "Physical item identifier"), title: operational("string", "Physical product title", { filterable: true, sortable: true }), variant_title: operational("string", "Physical variant title", { filterable: true, sortable: true }), quantity: operational("integer", "Counted quantity", { aggregatable: true, sortable: true }), quantity_known: operational("boolean", "Whether quantity is known", { filterable: true }), packaging_type: operational("string", "Packaging type", { filterable: true }), reorder_point: operational("integer", "Reorder threshold", { aggregatable: true }), lead_time_days: operational("integer", "Lead time", { aggregatable: true }), active: operational("boolean", "Active catalogue row", { filterable: true }), updated_at: operational("date", "Last update timestamp", { sortable: true }) },
    metrics: ["count", "sum", "average", "minimum", "maximum"], includes: ["variants"], examples: ["Which physical products are below reorder point?"],
  },
  {
    id: "channel_inventory", title: "Channel inventory", description: "Fetched Shopify and TikTok display inventory, separate from counted physical stock.", freshness: "Provider inventory sync timestamps.", dateFields: ["synced_at"],
    fields: { id: operational("string", "Channel inventory row identifier"), variant_id: operational("string", "Linked variant identifier", { filterable: true }), channel: operational("string", "shopify or tiktok", { filterable: true, sortable: true }), shop_id: operational("string", "Channel shop identifier", { filterable: true }), external_product_id: operational("string", "Provider product identifier", { filterable: true }), external_sku_id: operational("string", "Provider SKU identifier", { filterable: true }), available_quantity: operational("integer", "Provider available quantity", { aggregatable: true, sortable: true }), synced_at: operational("date", "Last provider inventory timestamp", { filterable: true, sortable: true }) },
    metrics: ["count", "sum", "average", "minimum", "maximum"], includes: [], examples: ["Compare Shopify and TikTok availability"],
  },
  {
    id: "channel_listings", title: "Channel listings and mappings", description: "Listings and registered mapping relationships; never initializes or rewrites the listing catalogue.", freshness: "Latest imported listing and mapping state.", dateFields: ["updated_at"],
    fields: { id: operational("string", "Listing identifier"), channel: operational("string", "shopify or tiktok", { filterable: true }), external_product_id: operational("string", "Provider product identifier", { filterable: true }), external_variant_id: operational("string", "Provider variant identifier", { filterable: true }), title: operational("string", "Listing title", { filterable: true, sortable: true }), variant_title: operational("string", "Listing variant title", { filterable: true }), channel_quantity: operational("integer", "Provider display quantity", { aggregatable: true, sortable: true }), listing_kind: operational("string", "individual, bundle, or unknown", { filterable: true }), mapping_status: operational("string", "confirmed, review, or unmapped", { filterable: true, sortable: true }), active: operational("boolean", "Whether listing is active", { filterable: true }), updated_at: operational("date", "Last listing update", { sortable: true }) },
    metrics: ["count", "sum", "average", "minimum", "maximum"], includes: ["components", "product_link"], examples: ["Show unmapped TikTok listings"],
  },
  {
    id: "inventory_history", title: "Inventory history", description: "Inventory ledger and stock movement facts; reads do not append audit rows.", freshness: "Ledger write timestamps.", dateFields: ["created_at"],
    fields: { id: operational("string", "Ledger entry identifier"), variant_id: operational("string", "Variant identifier", { filterable: true }), inventory: operational("string", "master, shopify, or tiktok", { filterable: true }), change_type: operational("string", "Recorded change type", { filterable: true }), actor: operational("string", "Recorded actor label", { filterable: true }), quantity_before: operational("integer", "Quantity before", { aggregatable: true }), quantity_after: operational("integer", "Quantity after", { aggregatable: true }), quantity_delta: operational("integer", "Quantity change", { aggregatable: true, sortable: true }), reference: operational("string", "Business reference", { filterable: true }), created_at: operational("date", "Ledger timestamp", { filterable: true, sortable: true }) },
    metrics: ["count", "sum", "average", "minimum", "maximum"], includes: [], examples: ["Inventory adjustments this month"],
  },
  {
    id: "packaging", title: "Packaging", description: "Packaging material stock, separate from product and Labs inventory.", freshness: "Latest packaging count/update.", dateFields: ["updated_at"],
    fields: { id: operational("string", "Packaging material identifier"), title: operational("string", "Packaging material", { filterable: true, sortable: true }), quantity: operational("integer", "Quantity on hand", { aggregatable: true, sortable: true }), reorder_point: operational("integer", "Reorder threshold", { aggregatable: true }), lead_time_days: operational("integer", "Lead time", { aggregatable: true }), active: operational("boolean", "Active material", { filterable: true }), updated_at: operational("date", "Last update timestamp", { sortable: true }) },
    metrics: ["count", "sum", "average", "minimum", "maximum"], includes: [], examples: ["Packaging materials below reorder point"],
  },
  {
    id: "labs", title: "Labs", description: "Ingredients, formulas, and batches. Labs quantities are grams and do not affect finished-product stock.", freshness: "Latest Labs record updates.", dateFields: ["updated_at", "created_at"],
    fields: { id: operational("string", "Labs record identifier"), record_type: operational("string", "ingredient, formula, or batch", { filterable: true }), title: operational("string", "Ingredient or formula title", { filterable: true, sortable: true }), subtitle: operational("string", "Formula subtitle"), notes: operational("string", "Formula or batch notes"), quantity_grams: operational("number", "Ingredient quantity in grams", { aggregatable: true, sortable: true }), quantity_known: operational("boolean", "Whether ingredient quantity is known", { filterable: true }), reorder_point_grams: operational("number", "Ingredient reorder threshold in grams", { aggregatable: true }), formula_id: operational("string", "Formula identifier", { filterable: true }), batch_number: operational("string", "Batch number", { filterable: true, sortable: true }), target_grams: operational("number", "Batch target in grams", { aggregatable: true }), actor: operational("string", "Batch actor", { filterable: true }), created_at: operational("date", "Creation timestamp", { filterable: true, sortable: true }), updated_at: operational("date", "Last update timestamp", { sortable: true }) },
    metrics: ["count", "sum", "average", "minimum", "maximum"], includes: ["lines", "packaging"], examples: ["Which formulas use an ingredient?"],
  },
  {
    id: "affiliate_reporting", title: "TikTok affiliate reporting", description: "Normalized TikTok affiliate attribution facts, kept separate from ordinary TikTok Shop orders.", freshness: "Latest affiliate import and sync status.", dateFields: ["source_created_at", "source_updated_at", "imported_at"],
    fields: { id: operational("string", "Affiliate row identifier"), source_order_id: operational("string", "Attributed source order", { filterable: true }), source_line_item_id: operational("string", "Attributed source line item", { filterable: true }), product_title: operational("string", "Attributed product", { filterable: true, sortable: true }), creator_username: operational("string", "Creator display name", { filterable: true, sortable: true }), quantity: operational("integer", "Attributed units", { aggregatable: true, sortable: true }), gross_amount_minor: operational("integer", "Attributed gross amount", { aggregatable: true }), estimated_commission_minor: operational("integer", "Estimated commission", { aggregatable: true }), currency: operational("string", "ISO currency", { filterable: true }), status: operational("string", "Attribution status", { filterable: true }), source_created_at: operational("date", "Source order timestamp", { filterable: true, sortable: true }), source_updated_at: operational("date", "Source update timestamp", { filterable: true }), imported_at: operational("date", "Import timestamp", { sortable: true }) },
    metrics: ["count", "sum", "average", "minimum", "maximum"], includes: [], examples: ["Affiliate performance this month"],
  },
  {
    id: "ads_reporting", title: "TikTok Ads reporting", description: "Normalized advertising metrics; raw provider JSON and credentials are excluded.", freshness: "Latest completed Ads report import.", dateFields: ["report_date", "fetched_at"],
    fields: { id: operational("string", "Report row identifier"), advertiser_id: operational("string", "Advertiser identifier", { filterable: true }), report_date: operational("date", "Reporting date", { filterable: true, sortable: true }), report_type: operational("string", "Report type", { filterable: true }), service_type: operational("string", "Service type", { filterable: true }), data_level: operational("string", "Data level", { filterable: true }), dimension_key: operational("string", "Normalized dimension", { filterable: true }), provider_currency: operational("string", "Provider currency", { filterable: true }), spend_minor: operational("integer", "Spend in minor currency units", { aggregatable: true, sortable: true }), attributed_revenue_minor: operational("integer", "Attributed revenue", { aggregatable: true }), attributed_purchases: operational("integer", "Attributed purchases", { aggregatable: true }), impressions: operational("integer", "Impressions", { aggregatable: true }), clicks: operational("integer", "Clicks", { aggregatable: true }), attribution_window: operational("string", "Attribution window", { filterable: true }), fetched_at: operational("date", "Fetch timestamp", { sortable: true }) },
    metrics: ["count", "sum", "average", "minimum", "maximum"], includes: [], examples: ["Advertising spend and revenue last month"],
  },
  {
    id: "alerts", title: "Alerts", description: "Current inventory and mapping alerts; reading them does not recalculate or resolve alerts.", freshness: "Alert table update timestamps.", dateFields: ["first_seen_at", "last_seen_at", "resolved_at"],
    fields: { id: operational("string", "Alert identifier"), alert_key: operational("string", "Stable alert key", { filterable: true }), kind: operational("string", "Alert kind", { filterable: true }), severity: operational("string", "critical, warning, or info", { filterable: true, sortable: true }), title: operational("string", "Alert title", { filterable: true }), detail: operational("string", "Alert detail"), status: operational("string", "active or resolved", { filterable: true }), first_seen_at: operational("date", "First seen timestamp", { sortable: true }), last_seen_at: operational("date", "Last seen timestamp", { sortable: true }), resolved_at: operational("date", "Resolution timestamp", { sortable: true }) },
    metrics: ["count"], includes: [], examples: ["What alerts need attention?"],
  },
  {
    id: "sync_status", title: "Synchronization status", description: "Provider sync health and freshness without acquiring leases, refreshing providers, or changing state.", freshness: "Latest stored sync run/status record.", dateFields: ["started_at", "finished_at", "last_successful_at", "updated_at"],
    fields: { id: operational("string", "Sync run identifier"), trigger: operational("string", "manual, scheduled, or webhook", { filterable: true }), provider: operational("string", "direct, shopify, or tiktok", { filterable: true }), status: operational("string", "Sync status", { filterable: true, sortable: true }), started_at: operational("date", "Run start timestamp", { sortable: true }), finished_at: operational("date", "Run finish timestamp", { sortable: true }), records_seen: operational("integer", "Records observed", { aggregatable: true }), records_changed: operational("integer", "Records changed", { aggregatable: true }), last_successful_at: operational("date", "Last successful provider sync", { sortable: true }), updated_at: operational("date", "Status update timestamp", { sortable: true }) },
    metrics: ["count", "sum", "average", "minimum", "maximum"], includes: [], examples: ["When was the last successful synchronization?"],
  },
];

// Every registered dataset has a stable identifier. Make that identifier an
// explicit safe sort key, including for datasets whose business fields are
// otherwise intentionally unsortable.
for (const definition of definitions) {
  if (definition.fields.id) definition.fields.id = { ...definition.fields.id, sortable: true };
}

export const DATASET_REGISTRY: Readonly<Record<AssistantDatasetId, DatasetDefinition>> = Object.fromEntries(definitions.map((definition) => [definition.id, definition])) as Record<AssistantDatasetId, DatasetDefinition>;
export const ASSISTANT_DATASET_IDS = definitions.map((definition) => definition.id) as AssistantDatasetId[];

export const assistantFilterSchema = z.object({
  field: z.string().min(1).max(80),
  operator: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "contains", "in", "between"]),
  value: z.unknown(),
});

export const assistantQueryRequestSchema = z.object({
  dataset: z.string().min(1).max(80),
  select: z.array(z.string().min(1).max(80)).max(40).optional(),
  filters: z.array(assistantFilterSchema).max(20).optional(),
  metrics: z.array(z.string().min(1).max(40)).max(5).optional(),
  groupBy: z.array(z.string().min(1).max(80)).max(2).optional(),
  sort: z.object({ field: z.string().min(1).max(80), direction: z.enum(["asc", "desc"]) }).optional(),
  dateRange: z.object({ field: z.string().min(1).max(80).optional(), start: z.string(), end: z.string() }).optional(),
  include: z.array(z.string().min(1).max(80)).max(4).optional(),
  pageSize: z.number().int().positive().max(250).optional(),
  cursor: z.string().max(4096).optional(),
}).strict();

export type AssistantQueryRequest = z.infer<typeof assistantQueryRequestSchema>;

export const assistantReportRequestSchema = z.object({
  report: z.enum(["top_products", "net_sales", "refunds", "customer_performance", "inventory_health", "channel_comparison", "affiliate_performance", "advertising_performance", "packaging_requirements", "labs_usage", "alerts", "sync_status"]),
  start: z.string().optional(),
  end: z.string().optional(),
  limit: z.number().int().positive().max(100).optional(),
}).strict();

export type AssistantReportRequest = z.infer<typeof assistantReportRequestSchema>;

export type AssistantPrincipal = {
  userId: string;
  clientId: string;
  scopes: AssistantScope[];
  resource: string;
  audience: string;
};

export type AssistantQueryResult = {
  dataset: AssistantDatasetId;
  registryVersion: string;
  returnedColumns: string[];
  rows: Array<Record<string, unknown>>;
  resultCount: number;
  truncated: boolean;
  nextCursor: string | null;
  asOf: string;
  freshness: { source: string; latestAt: string | null; note: string };
  warnings: string[];
};

export function datasetRequiresPii(dataset: DatasetDefinition, columns: string[]) {
  return columns.some((column) => dataset.fields[column]?.sensitivity === "pii");
}

export function publicDatasetCatalog(includePii: boolean) {
  return definitions.map((definition) => ({
    id: definition.id,
    title: definition.title,
    description: definition.description,
    freshness: definition.freshness,
    dateFields: definition.dateFields,
    fields: Object.fromEntries(Object.entries(definition.fields).map(([name, field]) => [name, {
      ...field,
      requiredScope: field.sensitivity === "pii" ? "assistant:pii" : "assistant:read",
      available: includePii || field.sensitivity !== "pii",
    }])),
    metrics: definition.metrics,
    includes: definition.includes,
    examples: definition.examples,
  }));
}
