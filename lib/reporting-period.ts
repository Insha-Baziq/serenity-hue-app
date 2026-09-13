import type { KpiPeriod } from "./kpi-dashboard.ts";

export type ReportingSearchParams = Record<string, string | string[] | undefined>;

const REPORTING_TIME_ZONE = "Europe/London";
const DAY_MS = 86_400_000;

export function londonCalendarDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: REPORTING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function shiftCalendarDate(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function precedingRange(range: KpiPeriod): KpiPeriod {
  const days = Math.floor((Date.parse(`${range.end}T00:00:00.000Z`) - Date.parse(`${range.start}T00:00:00.000Z`)) / DAY_MS) + 1;
  return { start: shiftCalendarDate(range.start, -days), end: shiftCalendarDate(range.start, -1) };
}

/** Normalizes the shared KPI/report query contract into an inclusive London calendar period. */
export function resolveReportingPeriod(params: ReportingSearchParams, now = new Date()): { range: KpiPeriod; comparison: KpiPeriod | null } {
  const today = londonCalendarDate(now);
  if (params.period === "all") return { range: { start: today, end: today, allTime: true }, comparison: null };
  const start = typeof params.start === "string" ? params.start : "";
  const end = typeof params.end === "string" ? params.end : "";
  const valid = isCalendarDate(start) && isCalendarDate(end) && Date.parse(`${end}T00:00:00.000Z`) >= Date.parse(`${start}T00:00:00.000Z`);
  const range = valid ? { start, end } : { start: shiftCalendarDate(today, -29), end: today };
  return { range, comparison: precedingRange(range) };
}
