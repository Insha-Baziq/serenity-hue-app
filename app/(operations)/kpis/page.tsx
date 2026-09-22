import { KpisWorkspace, type KpiView } from "@/components/kpis-workspace";
import { requirePageSession } from "@/lib/auth-guard";
import { unstable_cache } from "next/cache";
import {
  getKpiProductComparison,
  getTikTokAdsConnectionState,
  getTikTokAffiliateComparison,
  getTikTokAffiliateDashboard,
} from "@/lib/repository";
import { getTikTokAdsReport, getTikTokAdsReportState } from "@/lib/tiktok-ads-report-store";
import type { KpiPeriod } from "@/lib/kpi-dashboard";
import { getCachedKpiDashboard } from "@/lib/kpi-reporting-cache";
import { KPI_REPORTING_TIME_ZONE } from "@/lib/kpi-comparisons";
import { londonCalendarDate, resolveReportingPeriod } from "@/lib/reporting-period";

export const dynamic = "force-dynamic";

const getCachedKpiProductComparison = unstable_cache(
  async (spec: Parameters<typeof getKpiProductComparison>[0]) => getKpiProductComparison(spec),
  ["kpi-product-comparison-v1"],
  { revalidate: 300, tags: ["serenity-hue:kpi-reporting"] },
);

const getCachedTikTokAffiliateDashboard = unstable_cache(
  async (range: KpiPeriod) => getTikTokAffiliateDashboard(range),
  ["tiktok-affiliate-dashboard-v1"],
  { revalidate: 300, tags: ["serenity-hue:kpi-reporting"] },
);

const getCachedTikTokAffiliateComparison = unstable_cache(
  async (spec: Parameters<typeof getTikTokAffiliateComparison>[0]) => getTikTokAffiliateComparison(spec),
  ["tiktok-affiliate-comparison-v1"],
  { revalidate: 300, tags: ["serenity-hue:kpi-reporting"] },
);

/** Reporting tabs that may be linked to directly with `?view=`. */
const KPI_VIEWS: KpiView[] = ["overview", "products", "channels", "customers", "affiliates", "ads", "restock"];

function selectedRange(params: Record<string, string | string[] | undefined>): KpiPeriod {
  return resolveReportingPeriod(params).range;
}

export default async function KpisPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePageSession();
  const params = await searchParams;
  const range = selectedRange(params);
  const initialView = KPI_VIEWS.find((view) => view === params.view);
  const anchorDate = range.allTime ? londonCalendarDate() : range.end;
  const [dashboard, productWeekly, productMonthly, affiliateDashboard, affiliateWeekly, affiliateMonthly, adsConnection, adsReportState, adsReport] = await Promise.all([
    getCachedKpiDashboard(range),
    getCachedKpiProductComparison({ grain: "week", periodCount: 4, anchorDate, timeZone: KPI_REPORTING_TIME_ZONE }),
    getCachedKpiProductComparison({ grain: "month", periodCount: 3, anchorDate, timeZone: KPI_REPORTING_TIME_ZONE }),
    getCachedTikTokAffiliateDashboard(range),
    getCachedTikTokAffiliateComparison({ grain: "week", periodCount: 4, anchorDate, timeZone: KPI_REPORTING_TIME_ZONE }),
    getCachedTikTokAffiliateComparison({ grain: "month", periodCount: 3, anchorDate, timeZone: KPI_REPORTING_TIME_ZONE }),
    getTikTokAdsConnectionState(),
    getTikTokAdsReportState(),
    getTikTokAdsReport(range),
  ]);
  return (
    <KpisWorkspace
      dashboard={dashboard}
      productWeekly={productWeekly}
      productMonthly={productMonthly}
      affiliateDashboard={affiliateDashboard}
      affiliateWeekly={affiliateWeekly}
      affiliateMonthly={affiliateMonthly}
      adsConnection={adsConnection}
      adsReportState={adsReportState}
      adsReport={adsReport}
      initialView={initialView}
    />
  );
}
