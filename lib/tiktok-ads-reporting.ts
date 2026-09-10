const TIKTOK_ADS_API_BASE_URL = "https://business-api.tiktok.com";
const TIKTOK_ADS_REPORT_PATH = "/open_api/v1.3/report/integrated/get/";
const REPORT_TYPE = "BASIC";
const SERVICE_TYPE = "AUCTION";
const DATA_LEVEL = "AUCTION_ADVERTISER";
const REPORT_DIMENSIONS = ["advertiser_id", "stat_time_day"] as const;
const REPORT_METRICS = [
  "currency",
  "spend",
  "total_onsite_shopping_value",
  "shop_total_purchase_by_order_submission",
  "impressions",
  "clicks",
] as const;

export type TikTokAdsProviderReportRow = {
  dimensions?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
};

type TikTokAdsReportResponse = {
  code?: unknown;
  data?: {
    list?: unknown;
    page_info?: {
      page?: unknown;
      total_page?: unknown;
    };
  };
};

export type TikTokAdsReportRecord = {
  id: string;
  advertiserId: string;
  reportDate: string;
  reportType: typeof REPORT_TYPE;
  serviceType: typeof SERVICE_TYPE;
  dataLevel: typeof DATA_LEVEL;
  dimensionKey: string;
  providerCurrency: string;
  spendMinor: number;
  attributedRevenueMinor: number | null;
  attributedPurchases: number | null;
  impressions: number | null;
  clicks: number | null;
  sourceDimensions: Record<string, string>;
  sourceMetrics: Record<string, string>;
  attributionWindow: string | null;
  fetchedAt: string;
};

export type TikTokAdsReportingWindow = {
  kind: "baseline" | "rolling";
  startDate: string;
  endDate: string;
  retainedBeforeDate: string;
};

function textValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function londonDate(now: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function shiftDate(date: string, days: number) {
  const shifted = new Date(`${date}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

export function tiktokAdsReportingWindow(now = new Date(), kind: "baseline" | "rolling" = "rolling"): TikTokAdsReportingWindow {
  const endDate = londonDate(now);
  const retainedBeforeDate = shiftDate(endDate, -89);
  return {
    kind,
    startDate: shiftDate(endDate, kind === "baseline" ? -89 : -6),
    endDate,
    retainedBeforeDate,
  };
}

function responseCode(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function isSafeDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function primitiveRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") result[key] = String(item);
  }
  return result;
}

function minorUnits(value: unknown) {
  const text = textValue(value);
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return undefined;
  const [whole, fraction = ""] = text.split(".");
  const minorText = `${fraction}00`.slice(0, 2);
  const minor = Number(`${whole}${minorText}`);
  return Number.isSafeInteger(minor) ? minor : undefined;
}

function nonNegativeInteger(value: unknown) {
  const text = textValue(value);
  if (!/^\d+$/.test(text)) return undefined;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function optionalMetric(metrics: Record<string, unknown>, key: string, parser: (value: unknown) => number | undefined) {
  if (!(key in metrics) || metrics[key] === null || metrics[key] === undefined || textValue(metrics[key]) === "") return null;
  return parser(metrics[key]);
}

export function normalizeTikTokAdsReportRows(input: {
  advertiserId: string;
  fetchedAt: string;
  rows: TikTokAdsProviderReportRow[];
}) {
  const records: TikTokAdsReportRecord[] = [];
  let skippedRows = 0;
  const advertiserId = input.advertiserId.trim();

  for (const row of input.rows) {
    const dimensions = primitiveRecord(row.dimensions);
    const metrics = primitiveRecord(row.metrics);
    const rowAdvertiserId = dimensions.advertiser_id ?? "";
    const reportDate = dimensions.stat_time_day ?? "";
    const currency = (metrics.currency ?? dimensions.currency ?? "").trim().toUpperCase();
    const spendMinor = minorUnits(metrics.spend);
    const attributedRevenueMinor = optionalMetric(metrics, "total_onsite_shopping_value", minorUnits);
    const attributedPurchases = optionalMetric(metrics, "shop_total_purchase_by_order_submission", nonNegativeInteger);
    const impressions = optionalMetric(metrics, "impressions", nonNegativeInteger);
    const clicks = optionalMetric(metrics, "clicks", nonNegativeInteger);

    if (
      !advertiserId
      || rowAdvertiserId !== advertiserId
      || !isSafeDate(reportDate)
      || !currency
      || spendMinor === undefined
      || attributedRevenueMinor === undefined
      || attributedPurchases === undefined
      || impressions === undefined
      || clicks === undefined
    ) {
      skippedRows += 1;
      continue;
    }

    const dimensionKey = Object.keys(dimensions).sort().map((key) => `${key}=${dimensions[key]}`).join("|");
    records.push({
      id: `tiktok-ads:${advertiserId}:${SERVICE_TYPE}:${DATA_LEVEL}:${dimensionKey}`,
      advertiserId,
      reportDate,
      reportType: REPORT_TYPE,
      serviceType: SERVICE_TYPE,
      dataLevel: DATA_LEVEL,
      dimensionKey,
      providerCurrency: currency,
      spendMinor,
      attributedRevenueMinor,
      attributedPurchases,
      impressions,
      clicks,
      sourceDimensions: dimensions,
      sourceMetrics: metrics,
      attributionWindow: null,
      fetchedAt: input.fetchedAt,
    });
  }

  return { records, skippedRows };
}

function pageNumber(value: unknown, fallback: number) {
  const parsed = responseCode(value);
  return parsed && parsed > 0 ? Math.floor(parsed) : fallback;
}

export async function fetchTikTokAdsReport(input: {
  accessToken: string;
  advertiserId: string;
  startDate: string;
  endDate: string;
}) {
  const accessToken = input.accessToken.trim();
  const advertiserId = input.advertiserId.trim();
  if (!accessToken || !advertiserId || !isSafeDate(input.startDate) || !isSafeDate(input.endDate) || input.startDate > input.endDate) {
    throw new Error("TikTok Ads reporting request has invalid input");
  }

  const rows: TikTokAdsProviderReportRow[] = [];
  let page = 1;
  let totalPage = 1;
  const maxPages = 100;
  while (page <= totalPage && page <= maxPages) {
    const url = new URL(TIKTOK_ADS_REPORT_PATH, TIKTOK_ADS_API_BASE_URL);
    url.searchParams.set("report_type", REPORT_TYPE);
    url.searchParams.set("advertiser_id", advertiserId);
    url.searchParams.set("service_type", SERVICE_TYPE);
    url.searchParams.set("data_level", DATA_LEVEL);
    url.searchParams.set("dimensions", JSON.stringify(REPORT_DIMENSIONS));
    url.searchParams.set("metrics", JSON.stringify(REPORT_METRICS));
    url.searchParams.set("start_date", input.startDate);
    url.searchParams.set("end_date", input.endDate);
    url.searchParams.set("page", String(page));
    url.searchParams.set("page_size", "1000");

    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: { "Access-Token": accessToken, accept: "application/json" },
    });
    let payload: TikTokAdsReportResponse = {};
    try {
      payload = await response.json() as TikTokAdsReportResponse;
    } catch {
      // The normalized error below intentionally does not echo provider response data.
    }
    const code = responseCode(payload.code);
    if (response.status < 200 || response.status >= 300 || code !== 0) {
      throw new Error(`TikTok Ads reporting request failed (HTTP ${response.status}, code ${code ?? "unknown"})`);
    }
    const pageRows = payload.data?.list;
    if (!Array.isArray(pageRows)) throw new Error("TikTok Ads reporting response was malformed");
    rows.push(...pageRows.filter((row): row is TikTokAdsProviderReportRow => Boolean(row && typeof row === "object" && !Array.isArray(row))));
    const pageInfo = payload.data?.page_info;
    totalPage = pageNumber(pageInfo?.total_page, 1);
    const returnedPage = pageNumber(pageInfo?.page, page);
    if (returnedPage !== page && totalPage > 1) throw new Error("TikTok Ads reporting pagination was malformed");
    page += 1;
  }
  if (page > maxPages && page <= totalPage) throw new Error("TikTok Ads reporting pagination exceeded the safe limit");
  return rows;
}
