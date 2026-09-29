import { ReportsWorkspace } from "@/components/reports-workspace";
import { requirePageSession } from "@/lib/auth-guard";
import { unstable_cache } from "next/cache";
import { getTikTokAffiliateDashboard, getTikTokAdsConnectionState } from "@/lib/repository";
import { getTikTokAdsReport, getTikTokAdsReportState } from "@/lib/tiktok-ads-report-store";
import { getCachedKpiDashboard } from "@/lib/kpi-reporting-cache";
import type { KpiPeriod } from "@/lib/kpi-dashboard";
import { loadVisualReport, resolveVisualReportId } from "@/lib/visual-report-loader";
import { resolveReportingPeriod } from "@/lib/reporting-period";

export const dynamic = "force-dynamic";

const REPORT_CACHE_TAG = "serenity-hue:visual-reports";

const getCachedAffiliateDashboard = unstable_cache(
  async (range: KpiPeriod) => getTikTokAffiliateDashboard(range),
  ["visual-report-affiliate-dashboard-v1"],
  { revalidate: 300, tags: [REPORT_CACHE_TAG] },
);

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePageSession();
  const params = await searchParams;
  const range = resolveReportingPeriod(params).range;
  const report = resolveVisualReportId(params.report);
  const reportData = await loadVisualReport(report, range, {
    kpi: (selectedRange, scope) => getCachedKpiDashboard(selectedRange, scope),
    affiliate: (selectedRange) => getCachedAffiliateDashboard(selectedRange),
    ads: async (selectedRange) => {
      const adsPromise = getTikTokAdsReport(selectedRange);
      const adsConnection = await getTikTokAdsConnectionState();
      const [ads, adsReportState] = await Promise.all([
        adsPromise,
        getTikTokAdsReportState(adsConnection),
      ]);
      return { ads, adsConnection, adsReportState };
    },
  });

  if (reportData.report === "ads") {
    return <ReportsWorkspace report="ads" range={range} {...reportData.ads} />;
  }
  return <ReportsWorkspace {...reportData} range={range} />;
}
