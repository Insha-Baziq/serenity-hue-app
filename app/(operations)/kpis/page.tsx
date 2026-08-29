import { KpisWorkspace } from "@/components/kpis-workspace";
import { requirePageSession } from "@/lib/auth-guard";
import { getKpiDashboard } from "@/lib/repository";
import type { KpiPeriod } from "@/lib/kpi-dashboard";

export const dynamic = "force-dynamic";

const REPORTING_TIME_ZONE = "Europe/London";

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

function selectedRange(params: Record<string, string | string[] | undefined>): KpiPeriod {
  const start = typeof params.start === "string" ? params.start : "";
  const end = typeof params.end === "string" ? params.end : "";
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end);
  const duration = valid ? Date.parse(`${end}T00:00:00.000Z`) - Date.parse(`${start}T00:00:00.000Z`) : NaN;
  if (valid && Number.isFinite(duration) && duration >= 0 && duration < 365 * 86_400_000) return { start, end };
  const endDate = londonToday();
  return { start: shiftDate(endDate, -29), end: endDate };
}

export default async function KpisPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePageSession();
  const range = selectedRange(await searchParams);
  const dashboard = await getKpiDashboard(range);
  return <KpisWorkspace dashboard={dashboard} />;
}
