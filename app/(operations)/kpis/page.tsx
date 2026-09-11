import { KpisWorkspace, type KpiView } from "@/components/kpis-workspace";
import { requirePageSession } from "@/lib/auth-guard";
import { getKpiDashboard, getTikTokAdsConnectionState, getTikTokAffiliateDashboard } from "@/lib/repository";
import { getTikTokAdsReport, getTikTokAdsReportState } from "@/lib/tiktok-ads-report-store";
import type { KpiPeriod } from "@/lib/kpi-dashboard";

export const dynamic = "force-dynamic";

const REPORTING_TIME_ZONE = "Europe/London";

/** Reporting tabs that may be linked to directly with `?view=`. */
const KPI_VIEWS: KpiView[] = ["overview", "products", "channels", "customers", "affiliates", "ads", "restock"];

function londonToday() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: REPORTING_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function selectedRange(params: Record<string, string | string[] | undefined>): KpiPeriod {
  const endDate = londonToday();
  if (params.period === "all") return { start: endDate, end: endDate, allTime: true };
  const start = typeof params.start === "string" ? params.start : "";
  const end = typeof params.end === "string" ? params.end : "";
  const valid = isCalendarDate(start) && isCalendarDate(end);
  const duration = valid ? Date.parse(`${end}T00:00:00.000Z`) - Date.parse(`${start}T00:00:00.000Z`) : NaN;
  if (valid && Number.isFinite(duration) && duration >= 0) return { start, end };
  return { start: shiftDate(endDate, -29), end: endDate };
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
