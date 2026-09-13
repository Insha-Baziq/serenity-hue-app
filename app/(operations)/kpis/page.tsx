import { KpisWorkspace, type KpiView } from "@/components/kpis-workspace";
import { requirePageSession } from "@/lib/auth-guard";
import { getKpiDashboard, getTikTokAdsConnectionState, getTikTokAffiliateDashboard } from "@/lib/repository";
import { getTikTokAdsReport, getTikTokAdsReportState } from "@/lib/tiktok-ads-report-store";
import type { KpiPeriod } from "@/lib/kpi-dashboard";
import { resolveReportingPeriod } from "@/lib/reporting-period";

export const dynamic = "force-dynamic";

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
  const [dashboard, affiliateDashboard, adsConnection, adsReportState, adsReport] = await Promise.all([
    getKpiDashboard(range),
    getTikTokAffiliateDashboard(range),
    getTikTokAdsConnectionState(),
    getTikTokAdsReportState(),
    getTikTokAdsReport(range),
  ]);
  return <KpisWorkspace dashboard={dashboard} affiliateDashboard={affiliateDashboard} adsConnection={adsConnection} adsReportState={adsReportState} adsReport={adsReport} initialView={initialView} />;
}
