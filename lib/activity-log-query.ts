import type { ActivityLogPage } from "@/lib/types";

export type ActivityEventDomain = "all" | "sync" | "order" | "shipment" | "inventory" | "mapping" | "packaging" | "employee" | "labs";
export type ActivityOutcomeFilter = "all" | "succeeded" | "failed" | "skipped";
export type ActivitySourceFilter = "all" | "manual" | "scheduled" | "webhook" | "provider";
export type ActivityDateRange = "7" | "all";

export type ActivityLogQuery = {
  q: string;
  domain: ActivityEventDomain;
  source: ActivitySourceFilter;
  provider: string;
  actor: string;
  outcome: ActivityOutcomeFilter;
  dateRange: ActivityDateRange;
  page: number;
  pageSize: number;
};

export const ACTIVITY_LOG_PAGE_SIZES = [25, 50, 100] as const;
export const ACTIVITY_LOG_DEFAULT_PAGE_SIZE = 50;

const DOMAINS: ActivityEventDomain[] = ["all", "sync", "order", "shipment", "inventory", "mapping", "packaging", "employee", "labs"];
const SOURCES: ActivitySourceFilter[] = ["all", "manual", "scheduled", "webhook", "provider"];
const OUTCOMES: ActivityOutcomeFilter[] = ["all", "succeeded", "failed", "skipped"];
const DATE_RANGES: ActivityDateRange[] = ["7", "all"];

type RawSearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export function parseActivityLogQuery(searchParams: RawSearchParams): ActivityLogQuery {
  const pageSizeRaw = Number(first(searchParams.pageSize));
  const pageRaw = Number(first(searchParams.page));
  const domain = first(searchParams.domain);
  const source = first(searchParams.source);
  const outcome = first(searchParams.outcome);
  const dateRange = first(searchParams.dateRange);

  return {
    q: first(searchParams.q),
    domain: DOMAINS.includes(domain as ActivityEventDomain) ? domain as ActivityEventDomain : "all",
    source: SOURCES.includes(source as ActivitySourceFilter) ? source as ActivitySourceFilter : "all",
    provider: first(searchParams.provider),
    actor: first(searchParams.actor),
    outcome: OUTCOMES.includes(outcome as ActivityOutcomeFilter) ? outcome as ActivityOutcomeFilter : "all",
    dateRange: DATE_RANGES.includes(dateRange as ActivityDateRange) ? dateRange as ActivityDateRange : "7",
    pageSize: ACTIVITY_LOG_PAGE_SIZES.includes(pageSizeRaw as typeof ACTIVITY_LOG_PAGE_SIZES[number]) ? pageSizeRaw as typeof ACTIVITY_LOG_PAGE_SIZES[number] : ACTIVITY_LOG_DEFAULT_PAGE_SIZE,
    page: Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1,
  };
}

export function activityLogQueryToParams(query: ActivityLogQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.q.trim()) params.set("q", query.q);
  if (query.domain !== "all") params.set("domain", query.domain);
  if (query.source !== "all") params.set("source", query.source);
  if (query.provider.trim()) params.set("provider", query.provider);
  if (query.actor.trim()) params.set("actor", query.actor);
  if (query.outcome !== "all") params.set("outcome", query.outcome);
  if (query.dateRange !== "7") params.set("dateRange", query.dateRange);
  if (query.pageSize !== ACTIVITY_LOG_DEFAULT_PAGE_SIZE) params.set("pageSize", String(query.pageSize));
  if (query.page > 1) params.set("page", String(query.page));
  return params;
}

export function activityLogPageLabel(page: ActivityLogPage) {
  if (!page.total) return "No activity in this view";
  const start = (page.page - 1) * page.pageSize + 1;
  const end = Math.min(page.total, page.page * page.pageSize);
  return `${start}–${end} of ${page.total}`;
}
