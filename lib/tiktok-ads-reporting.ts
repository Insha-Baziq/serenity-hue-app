const TIKTOK_ADS_API_BASE_URL = "https://business-api.tiktok.com";
const TIKTOK_ADS_REPORT_PATH = "/open_api/v1.3/report/integrated/get/";
const REPORT_TYPE = "BASIC";
const SERVICE_TYPE = "AUCTION";
const DEFAULT_DATA_LEVEL = "AUCTION_ADVERTISER";
const DEFAULT_HISTORY_START_DATE = "2026-04-01";

export type TikTokAdsDataLevel =
  | "AUCTION_ADVERTISER"
  | "AUCTION_CAMPAIGN"
  | "AUCTION_ADGROUP"
  | "AUCTION_AD";

type ReportLevelConfig = {
  dataLevel: TikTokAdsDataLevel;
  idKey: string;
  nameKey: string;
  dimensions: readonly string[];
  attributes: readonly string[];
};

const REPORT_LEVELS: Record<TikTokAdsDataLevel, ReportLevelConfig> = {
  AUCTION_ADVERTISER: {
    dataLevel: "AUCTION_ADVERTISER",
    idKey: "advertiser_id",
    nameKey: "advertiser_name",
    dimensions: ["advertiser_id", "stat_time_day"],
    attributes: ["advertiser_name"],
  },
  AUCTION_CAMPAIGN: {
    dataLevel: "AUCTION_CAMPAIGN",
    idKey: "campaign_id",
    nameKey: "campaign_name",
    dimensions: ["campaign_id", "stat_time_day"],
    attributes: ["campaign_name"],
  },
  AUCTION_ADGROUP: {
    dataLevel: "AUCTION_ADGROUP",
    idKey: "adgroup_id",
    nameKey: "adgroup_name",
    dimensions: ["adgroup_id", "stat_time_day"],
    attributes: ["campaign_id", "campaign_name", "adgroup_name"],
  },
  AUCTION_AD: {
    dataLevel: "AUCTION_AD",
    idKey: "ad_id",
    nameKey: "ad_name",
    dimensions: ["ad_id", "stat_time_day"],
    attributes: ["campaign_id", "campaign_name", "adgroup_id", "adgroup_name", "ad_name"],
  },
};

const REPORT_METRICS = [
  "currency",
  "spend",
  "total_onsite_shopping_value",
  "shop_total_purchase_by_order_submission",
  "impressions",
  "clicks",
] as const;

const ADS_METRIC_DEFINITION = "Spend, shopping value, and purchases are reported by TikTok's BASIC Ads report. They are not joined to Shopify or ordinary TikTok Shop orders.";

export type TikTokAdsProviderReportRow = {
  dimensions?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
};

type TikTokAdsReportResponse = {
  code?: unknown;
  message?: unknown;
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
  reportType: string;
  serviceType: string;
  dataLevel: TikTokAdsDataLevel;
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

export type TikTokAdsReportPeriod = {
  start: string;
  end: string;
  allTime?: boolean;
};

export type TikTokAdsDailyReport = {
  date: string;
  spendMinor: number;
  attributedRevenueMinor: number | null;
  attributedPurchases: number | null;
  impressions: number | null;
  clicks: number | null;
  roas: number | null;
};

export type TikTokAdsBreakdown = {
  dataLevel: Exclude<TikTokAdsDataLevel, "AUCTION_ADVERTISER">;
  id: string;
  name: string | null;
  currency: string | null;
  spendMinor: number | null;
  attributedRevenueMinor: number | null;
  attributedPurchases: number | null;
  roas: number | null;
  rowCount: number;
};

export type TikTokAdsProductAttributionRow = {
  productId: string;
  productName: string | null;
  currency: string | null;
  spendMinor: number | null;
  attributedRevenueMinor: number | null;
  attributedPurchases: number | null;
  rowCount: number;
};

export type TikTokAdsProductAttribution = {
  status: "available" | "unavailable";
  reason: string;
  rows: TikTokAdsProductAttributionRow[];
};

export type TikTokAdsReport = {
  requestedRange: TikTokAdsReportPeriod;
  effectiveRange: TikTokAdsReportPeriod | null;
  advertiserId: string | null;
  advertiserName: string | null;
  currency: string | null;
  reportTypes: string[];
  dataLevels: TikTokAdsDataLevel[];
  attributionWindow: string | null;
  metricDefinition: string;
  metrics: {
    spendMinor: number | null;
    attributedRevenueMinor: number | null;
    attributedPurchases: number | null;
    impressions: number | null;
    clicks: number | null;
    roas: number | null;
  };
  trend: TikTokAdsDailyReport[];
  rowCount: number;
  attributionEvidenceRows: number;
  earliestReportDate: string | null;
  latestReportDate: string | null;
  breakdowns: {
    campaign: TikTokAdsBreakdown[];
    adgroup: TikTokAdsBreakdown[];
    ad: TikTokAdsBreakdown[];
  };
  productAttribution: TikTokAdsProductAttribution;
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

export function tiktokAdsHistoryStartDate() {
  const configured = process.env.TIKTOK_ADS_HISTORY_START_DATE?.trim() ?? "";
  return isSafeDate(configured) ? configured : DEFAULT_HISTORY_START_DATE;
}

export function tiktokAdsReportingWindow(now = new Date(), kind: "baseline" | "rolling" = "rolling"): TikTokAdsReportingWindow {
  const endDate = londonDate(now);
  const historyStartDate = tiktokAdsHistoryStartDate();
  const retainedBeforeDate = historyStartDate;
  return {
    kind,
    startDate: kind === "baseline"
      ? historyStartDate
      : shiftDate(endDate, -6) < historyStartDate ? historyStartDate : shiftDate(endDate, -6),
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

function reportCalendarDate(value: unknown) {
  const text = textValue(value);
  const date = text.slice(0, 10);
  return isSafeDate(date) && (text.length === 10 || /^[ T]\d{2}:\d{2}:\d{2}/.test(text.slice(10))) ? date : "";
}

function shiftReportingDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function reportDateRanges(startDate: string, endDate: string) {
  const ranges: Array<{ startDate: string; endDate: string }> = [];
  let start = startDate;
  // TikTok's synchronous daily reports reject broad date ranges. Keep each
  // request to at most 30 inclusive calendar days, then combine the rows.
  while (start <= endDate) {
    const end = shiftReportingDate(start, 29) < endDate ? shiftReportingDate(start, 29) : endDate;
    ranges.push({ startDate: start, endDate: end });
    start = shiftReportingDate(end, 1);
  }
  return ranges;
}

function primitiveRecord(value: unknown): Record<string, string> {
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

function nullableSum(values: Array<number | null | undefined>) {
  let total = 0;
  let observed = false;
  for (const value of values) {
    if (value === null || value === undefined) continue;
    total += value;
    observed = true;
  }
  return observed ? total : null;
}

function dataLevel(input: TikTokAdsDataLevel | undefined) {
  return input && input in REPORT_LEVELS ? input : DEFAULT_DATA_LEVEL;
}

function isBreakdownLevel(value: TikTokAdsDataLevel): value is Exclude<TikTokAdsDataLevel, "AUCTION_ADVERTISER"> {
  return value !== "AUCTION_ADVERTISER";
}

export function normalizeTikTokAdsReportRows(input: {
  advertiserId: string;
  fetchedAt: string;
  rows: TikTokAdsProviderReportRow[];
  dataLevel?: TikTokAdsDataLevel;
}) {
  const records: TikTokAdsReportRecord[] = [];
  let skippedRows = 0;
  const advertiserId = input.advertiserId.trim();
  const level = dataLevel(input.dataLevel);
  const config = REPORT_LEVELS[level];

  for (const row of input.rows) {
    const dimensions = primitiveRecord(row.dimensions);
    const metrics = primitiveRecord(row.metrics);
    const rowAdvertiserId = dimensions.advertiser_id ?? "";
    const reportDate = reportCalendarDate(dimensions.stat_time_day);
    const providerId = dimensions[config.idKey] ?? metrics[config.idKey] ?? "";
    const currency = (metrics.currency ?? dimensions.currency ?? "").trim().toUpperCase();
    const spendMinor = minorUnits(metrics.spend);
    const attributedRevenueMinor = optionalMetric(metrics, "total_onsite_shopping_value", minorUnits);
    const attributedPurchases = optionalMetric(metrics, "shop_total_purchase_by_order_submission", nonNegativeInteger);
    const impressions = optionalMetric(metrics, "impressions", nonNegativeInteger);
    const clicks = optionalMetric(metrics, "clicks", nonNegativeInteger);

    if (
      !advertiserId
      || (rowAdvertiserId && rowAdvertiserId !== advertiserId)
      || (level === "AUCTION_ADVERTISER" && providerId !== advertiserId)
      || (level !== "AUCTION_ADVERTISER" && !providerId)
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

    const normalizedDimensions: Record<string, string> = { ...dimensions, stat_time_day: reportDate };
    if (level !== "AUCTION_ADVERTISER" && !normalizedDimensions[config.idKey]) normalizedDimensions[config.idKey] = providerId;
    const dimensionKey = Object.keys(normalizedDimensions).sort().map((key) => `${key}=${normalizedDimensions[key]}`).join("|");
    records.push({
      id: `tiktok-ads:${advertiserId}:${SERVICE_TYPE}:${level}:${dimensionKey}`,
      advertiserId,
      reportDate,
      reportType: REPORT_TYPE,
      serviceType: SERVICE_TYPE,
      dataLevel: level,
      dimensionKey,
      providerCurrency: currency,
      spendMinor,
      attributedRevenueMinor,
      attributedPurchases,
      impressions,
      clicks,
      sourceDimensions: normalizedDimensions,
      sourceMetrics: metrics,
      attributionWindow: textValue(metrics.attribution_window) || null,
      fetchedAt: input.fetchedAt,
    });
  }

  return { records, skippedRows };
}

function currencyFor(records: TikTokAdsReportRecord[]) {
  const currencies = [...new Set(records.map((record) => record.providerCurrency).filter(Boolean))];
  return currencies.length === 1 ? currencies[0] : null;
}

function metricTotals(records: TikTokAdsReportRecord[]) {
  const currency = currencyFor(records);
  return {
    currency,
    spendMinor: currency ? records.reduce((total, record) => total + record.spendMinor, 0) : null,
    attributedRevenueMinor: currency ? nullableSum(records.map((record) => record.attributedRevenueMinor)) : null,
    attributedPurchases: nullableSum(records.map((record) => record.attributedPurchases)),
    impressions: nullableSum(records.map((record) => record.impressions)),
    clicks: nullableSum(records.map((record) => record.clicks)),
  };
}

function roas(spendMinor: number | null, attributedRevenueMinor: number | null) {
  return spendMinor !== null && spendMinor > 0 && attributedRevenueMinor !== null
    ? attributedRevenueMinor / spendMinor
    : null;
}

function nameFor(record: TikTokAdsReportRecord) {
  const config = REPORT_LEVELS[record.dataLevel];
  return record.sourceMetrics[config.nameKey] ?? record.sourceDimensions[config.nameKey] ?? null;
}

function aggregateBreakdowns(records: TikTokAdsReportRecord[], range: TikTokAdsReportPeriod) {
  const groups = new Map<string, TikTokAdsReportRecord[]>();
  for (const record of records) {
    if (!isBreakdownLevel(record.dataLevel) || record.reportDate < range.start || record.reportDate > range.end) continue;
    const id = record.sourceDimensions[REPORT_LEVELS[record.dataLevel].idKey] ?? record.dimensionKey;
    const key = `${record.dataLevel}:${id}`;
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  const result: TikTokAdsBreakdown[] = [];
  for (const grouped of groups.values()) {
    const first = grouped[0];
    const totals = metricTotals(grouped);
    result.push({
      dataLevel: first.dataLevel as Exclude<TikTokAdsDataLevel, "AUCTION_ADVERTISER">,
      id: first.sourceDimensions[REPORT_LEVELS[first.dataLevel].idKey] ?? first.dimensionKey,
      name: nameFor(first),
      currency: totals.currency,
      spendMinor: totals.spendMinor,
      attributedRevenueMinor: totals.attributedRevenueMinor,
      attributedPurchases: totals.attributedPurchases,
      roas: roas(totals.spendMinor, totals.attributedRevenueMinor),
      rowCount: grouped.length,
    });
  }
  return result.sort((left, right) => (right.attributedRevenueMinor ?? -1) - (left.attributedRevenueMinor ?? -1) || left.id.localeCompare(right.id));
}

function aggregateProducts(records: TikTokAdsReportRecord[], range: TikTokAdsReportPeriod): TikTokAdsProductAttribution {
  const groups = new Map<string, TikTokAdsReportRecord[]>();
  for (const record of records) {
    if (record.reportDate < range.start || record.reportDate > range.end) continue;
    const productId = record.sourceDimensions.product_id ?? record.sourceMetrics.product_id;
    if (!productId) continue;
    groups.set(productId, [...(groups.get(productId) ?? []), record]);
  }
  const rows: TikTokAdsProductAttributionRow[] = [];
  for (const grouped of groups.values()) {
    const first = grouped[0];
    const totals = metricTotals(grouped);
    const productId = first.sourceDimensions.product_id ?? first.sourceMetrics.product_id ?? "";
    rows.push({
      productId,
      productName: first.sourceDimensions.product_name ?? first.sourceMetrics.product_name ?? null,
      currency: totals.currency,
      spendMinor: totals.spendMinor,
      attributedRevenueMinor: totals.attributedRevenueMinor,
      attributedPurchases: totals.attributedPurchases,
      rowCount: grouped.length,
    });
  }
  rows.sort((left, right) => (right.attributedRevenueMinor ?? -1) - (left.attributedRevenueMinor ?? -1) || left.productId.localeCompare(right.productId));
  return rows.length
    ? { status: "available", reason: "TikTok returned product identifiers with the selected report rows.", rows }
    : { status: "unavailable", reason: "TikTok did not supply product-level attribution for the selected report.", rows: [] };
}

export function aggregateTikTokAdsReportRows(
  records: TikTokAdsReportRecord[],
  range: TikTokAdsReportPeriod,
  metadata: { advertiserId?: string; advertiserName?: string | null } = {},
): TikTokAdsReport {
  const filtered = records
    .filter((record) => record.reportDate >= range.start && record.reportDate <= range.end)
    .sort((left, right) => left.reportDate.localeCompare(right.reportDate) || left.dimensionKey.localeCompare(right.dimensionKey));
  const advertiserRecords = filtered.filter((record) => record.dataLevel === "AUCTION_ADVERTISER");
  const summaryRecords = advertiserRecords.length ? advertiserRecords : filtered.filter((record) => record.dataLevel === DEFAULT_DATA_LEVEL);
  const totals = metricTotals(summaryRecords);
  const daily = new Map<string, TikTokAdsDailyReport>();

  for (const record of summaryRecords) {
    const current = daily.get(record.reportDate) ?? {
      date: record.reportDate,
      spendMinor: 0,
      attributedRevenueMinor: null,
      attributedPurchases: null,
      impressions: null,
      clicks: null,
      roas: null,
    };
    current.spendMinor += record.spendMinor;
    current.attributedRevenueMinor = nullableSum([current.attributedRevenueMinor, record.attributedRevenueMinor]);
    current.attributedPurchases = nullableSum([current.attributedPurchases, record.attributedPurchases]);
    current.impressions = nullableSum([current.impressions, record.impressions]);
    current.clicks = nullableSum([current.clicks, record.clicks]);
    current.roas = roas(current.spendMinor, current.attributedRevenueMinor);
    daily.set(record.reportDate, current);
  }

  const reportTypes = [...new Set(filtered.map((record) => record.reportType).filter(Boolean))].sort();
  const dataLevels = [...new Set(filtered.map((record) => record.dataLevel))].sort();
  const attributionWindows = [...new Set(filtered.map((record) => record.attributionWindow).filter(Boolean))];
  const advertiserName = metadata.advertiserName?.trim() || summaryRecords.map((record) => record.sourceMetrics.advertiser_name).find(Boolean) || null;
  const advertiserId = metadata.advertiserId?.trim() || summaryRecords[0]?.advertiserId || filtered[0]?.advertiserId || null;
  const breakdowns = aggregateBreakdowns(filtered, range);

  return {
    requestedRange: range,
    effectiveRange: filtered.length ? range : null,
    advertiserId,
    advertiserName,
    currency: totals.currency,
    reportTypes,
    dataLevels,
    attributionWindow: attributionWindows.length === 1 ? attributionWindows[0] ?? null : null,
    metricDefinition: ADS_METRIC_DEFINITION,
    metrics: {
      spendMinor: totals.spendMinor,
      attributedRevenueMinor: totals.attributedRevenueMinor,
      attributedPurchases: totals.attributedPurchases,
      impressions: totals.impressions,
      clicks: totals.clicks,
      roas: roas(totals.spendMinor, totals.attributedRevenueMinor),
    },
    trend: [...daily.values()],
    rowCount: summaryRecords.length,
    attributionEvidenceRows: summaryRecords.filter((record) => record.attributedRevenueMinor !== null || record.attributedPurchases !== null).length,
    earliestReportDate: summaryRecords[0]?.reportDate ?? null,
    latestReportDate: summaryRecords.at(-1)?.reportDate ?? null,
    breakdowns: {
      campaign: breakdowns.filter((record) => record.dataLevel === "AUCTION_CAMPAIGN"),
      adgroup: breakdowns.filter((record) => record.dataLevel === "AUCTION_ADGROUP"),
      ad: breakdowns.filter((record) => record.dataLevel === "AUCTION_AD"),
    },
    productAttribution: aggregateProducts(filtered, range),
  };
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
  dataLevel?: TikTokAdsDataLevel;
}) {
  const accessToken = input.accessToken.trim();
  const advertiserId = input.advertiserId.trim();
  const level = dataLevel(input.dataLevel);
  const config = REPORT_LEVELS[level];
  if (!accessToken || !advertiserId || !isSafeDate(input.startDate) || !isSafeDate(input.endDate) || input.startDate > input.endDate) {
    throw new Error("TikTok Ads reporting request has invalid input");
  }

  const rows: TikTokAdsProviderReportRow[] = [];
  const maxPages = 100;
  for (const range of reportDateRanges(input.startDate, input.endDate)) {
    let page = 1;
    let totalPage = 1;
    while (page <= totalPage && page <= maxPages) {
      const url = new URL(TIKTOK_ADS_REPORT_PATH, TIKTOK_ADS_API_BASE_URL);
      url.searchParams.set("report_type", REPORT_TYPE);
      url.searchParams.set("advertiser_id", advertiserId);
      url.searchParams.set("service_type", SERVICE_TYPE);
      url.searchParams.set("data_level", level);
      url.searchParams.set("dimensions", JSON.stringify(config.dimensions));
      url.searchParams.set("metrics", JSON.stringify([...REPORT_METRICS, ...config.attributes]));
      url.searchParams.set("start_date", range.startDate);
      url.searchParams.set("end_date", range.endDate);
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
        console.warn("[tiktok-ads-api-error]", {
          httpStatus: response.status,
          code: code ?? "unknown",
          message: typeof payload.message === "string" ? payload.message.slice(0, 300) : undefined,
        });
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
  }
  return rows;
}

export function tiktokAdsReportLevelConfigs() {
  return Object.values(REPORT_LEVELS).map((config) => ({
    dataLevel: config.dataLevel,
    dimensions: [...config.dimensions],
    attributes: [...config.attributes],
  }));
}
