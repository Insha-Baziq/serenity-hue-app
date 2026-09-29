import type { KpiPeriod } from "./kpi-dashboard.ts";
import type { KpiReportScope } from "./kpi-report-query-plan.ts";

export const VISUAL_REPORT_IDS = ["product", "customer", "orders", "ads", "affiliate"] as const;
export type VisualReportId = (typeof VISUAL_REPORT_IDS)[number];
export type { KpiReportScope } from "./kpi-report-query-plan.ts";

export function resolveVisualReportId(value: unknown): VisualReportId {
  return typeof value === "string" && VISUAL_REPORT_IDS.some((report) => report === value)
    ? value as VisualReportId
    : "product";
}

export type VisualReportData<KpiData, AdsData, AffiliateData> =
  | { report: KpiReportScope; dashboard: KpiData }
  | { report: "ads"; ads: AdsData }
  | { report: "affiliate"; affiliate: AffiliateData };

export type VisualReportLoaders<KpiData, AdsData, AffiliateData> = {
  kpi: (range: KpiPeriod, scope: KpiReportScope) => Promise<KpiData>;
  ads: (range: KpiPeriod) => Promise<AdsData>;
  affiliate: (range: KpiPeriod) => Promise<AffiliateData>;
};

export async function loadVisualReport<KpiData, AdsData, AffiliateData>(
  report: VisualReportId,
  range: KpiPeriod,
  loaders: VisualReportLoaders<KpiData, AdsData, AffiliateData>,
): Promise<VisualReportData<KpiData, AdsData, AffiliateData>> {
  switch (report) {
    case "product":
    case "customer":
    case "orders":
      return { report, dashboard: await loaders.kpi(range, report) };
    case "ads":
      return { report, ads: await loaders.ads(range) };
    case "affiliate":
      return { report, affiliate: await loaders.affiliate(range) };
  }
}
