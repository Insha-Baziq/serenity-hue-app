import { ReportsWorkspace, type ReportId } from "@/components/reports-workspace";
import { requirePageSession } from "@/lib/auth-guard";
import { unstable_cache } from "next/cache";
import { getKpiDashboard, getTikTokAffiliateDashboard, getTikTokAdsConnectionState } from "@/lib/repository";
import { getTikTokAdsReport, getTikTokAdsReportState } from "@/lib/tiktok-ads-report-store";
import type { KpiPeriod } from "@/lib/kpi-dashboard";
import { resolveReportingPeriod } from "@/lib/reporting-period";

export const dynamic = "force-dynamic";

const REPORT_CACHE_SECONDS = 300;
const REPORT_CACHE_TAG = "serenity-hue:visual-reports";

const getCachedKpiDashboard = unstable_cache(
  async (range: KpiPeriod) => getKpiDashboard(range),
  ["visual-report-kpi-dashboard-v2"],
  { revalidate: REPORT_CACHE_SECONDS, tags: [REPORT_CACHE_TAG] },
);

const getCachedAffiliateDashboard = unstable_cache(
  async (range: KpiPeriod) => getTikTokAffiliateDashboard(range),
  ["visual-report-affiliate-dashboard-v1"],
  { revalidate: REPORT_CACHE_SECONDS, tags: [REPORT_CACHE_TAG] },
);

const REPORT_IDS: ReportId[] = ["product", "customer", "orders", "ads", "affiliate"];

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePageSession();
  const params = await searchParams;
  const range = resolveReportingPeriod(params).range;
  const initialReport = REPORT_IDS.find((report) => report === params.report) ?? "product";
  const [dashboard, affiliate, adsConnection, adsReportState, ads] = await Promise.all([
    getCachedKpiDashboard(range),
    getCachedAffiliateDashboard(range),
    getTikTokAdsConnectionState(),
    getTikTokAdsReportState(),
    getTikTokAdsReport(range),
  ]);

  return <ReportsWorkspace dashboard={dashboard} affiliate={affiliate} adsConnection={adsConnection} adsReportState={adsReportState} ads={ads} initialReport={initialReport} />;
}
