// Shared, dependency-free definition of the Orders list query so the server
// page, the CSV export route, and the client workspace all agree on the exact
// parameter names, defaults, and URL shape. No database or server-only imports
// here — the client bundle imports the serializer and the page-size list.

export type OrdersChannelFilter = "all" | "shopify" | "tiktok";
export type OrdersFulfillmentFilter = "all" | "unfulfilled" | "partial" | "fulfilled" | "cancelled";
export type OrdersDateRange = "30" | "90" | "all";

export type OrdersQuery = {
  q: string;
  channel: OrdersChannelFilter;
  fulfillment: OrdersFulfillmentFilter;
  dateRange: OrdersDateRange;
  page: number;
  pageSize: number;
};

export const ORDERS_PAGE_SIZES = [25, 40, 50] as const;
export const ORDERS_DEFAULT_PAGE_SIZE = 50;

const CHANNELS: OrdersChannelFilter[] = ["all", "shopify", "tiktok"];
const FULFILLMENTS: OrdersFulfillmentFilter[] = ["all", "unfulfilled", "partial", "fulfilled", "cancelled"];
const DATE_RANGES: OrdersDateRange[] = ["30", "90", "all"];

type RawSearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

/** Normalizes untrusted URL search params into a fully-defaulted OrdersQuery. */
export function parseOrdersQuery(searchParams: RawSearchParams): OrdersQuery {
  const channelRaw = first(searchParams.channel);
  const fulfillmentRaw = first(searchParams.fulfillment);
  const dateRaw = first(searchParams.dateRange);
  const pageSizeRaw = Number(first(searchParams.pageSize));
  const pageRaw = Number(first(searchParams.page));

  return {
    // The raw search text is preserved (trimming happens in the SQL filter) so
    // the value survives a round trip to the server and back unchanged.
    q: first(searchParams.q),
    channel: (CHANNELS as string[]).includes(channelRaw) ? (channelRaw as OrdersChannelFilter) : "all",
    fulfillment: (FULFILLMENTS as string[]).includes(fulfillmentRaw) ? (fulfillmentRaw as OrdersFulfillmentFilter) : "all",
    dateRange: (DATE_RANGES as string[]).includes(dateRaw) ? (dateRaw as OrdersDateRange) : "all",
    pageSize: (ORDERS_PAGE_SIZES as readonly number[]).includes(pageSizeRaw) ? pageSizeRaw : ORDERS_DEFAULT_PAGE_SIZE,
    page: Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1,
  };
}

/** Serializes a query to URL params, omitting defaults so URLs stay clean. */
export function ordersQueryToParams(query: OrdersQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.q.trim()) params.set("q", query.q);
  if (query.channel !== "all") params.set("channel", query.channel);
  if (query.fulfillment !== "all") params.set("fulfillment", query.fulfillment);
  if (query.dateRange !== "all") params.set("dateRange", query.dateRange);
  if (query.pageSize !== ORDERS_DEFAULT_PAGE_SIZE) params.set("pageSize", String(query.pageSize));
  if (query.page > 1) params.set("page", String(query.page));
  return params;
}
