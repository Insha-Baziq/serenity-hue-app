"use client";

import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { activityLogPageLabel, activityLogQueryToParams, ACTIVITY_LOG_PAGE_SIZES, type ActivityLogQuery } from "@/lib/activity-log-query";
import type { ActivityLogPage, ActivityLogRow } from "@/lib/types";
import { getPageItems } from "@/lib/pagination";

type Props = { page: ActivityLogPage; query: ActivityLogQuery };

const domainOptions = [
  ["all", "All activity"], ["sync", "Syncs"], ["order", "Orders"], ["shipment", "Shipments"],
  ["inventory", "Inventory"], ["mapping", "Mappings"], ["packaging", "Packaging"], ["employee", "Employees"], ["labs", "Labs"],
] as const;

function eventLabel(value: string) {
  return value.split(".").map((part) => part.replaceAll("-", " ")).join(" · ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function sourceLabel(value: string, provider: string | null) {
  if (provider) return provider === "parcel2go" ? "Parcel2Go" : provider === "tiktok-ads" ? "TikTok Ads" : provider === "tiktok" ? "TikTok" : "Shopify";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatActivityTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function outcomeLabel(value: ActivityLogRow["outcome"]) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function detailValue(value: unknown) {
  if (Array.isArray(value)) return value.join(", ");
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function ActivityDetails({ row }: { row: ActivityLogRow }) {
  const entries = Object.entries(row.details);
  if (!entries.length) return <span className="activity-detail-empty">No additional details</span>;
  return <dl className="activity-details-list">{entries.map(([key, value]) => <div key={key}><dt>{key.replaceAll(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase())}</dt><dd>{detailValue(value)}</dd></div>)}</dl>;
}

function OutcomePill({ outcome }: { outcome: ActivityLogRow["outcome"] }) {
  return <span className={`activity-outcome activity-outcome--${outcome}`}><span aria-hidden="true" />{outcomeLabel(outcome)}</span>;
}

export function ActivityLogWorkspace({ page, query }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [searchInput, setSearchInput] = useState(query.q);
  const [syncedSearch, setSyncedSearch] = useState(query.q);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  if (syncedSearch !== query.q) {
    setSyncedSearch(query.q);
    setSearchInput(query.q);
  }

  function navigate(next: Partial<ActivityLogQuery>, replace = false) {
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    const merged: ActivityLogQuery = { ...query, q: searchInput, ...next };
    if (!("page" in next)) merged.page = 1;
    const params = activityLogQueryToParams(merged);
    const href = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    startTransition(() => replace ? router.replace(href, { scroll: false }) : router.push(href, { scroll: false }));
  }

  function onSearchChange(value: string) {
    setSearchInput(value);
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => navigate({ q: value }, true), 300);
  }

  const pageItems = getPageItems(page.page, page.pageCount);
  return (
    <section className="workspace workspace--activity-log">
      <header className="workspace-header activity-log-header">
        <div>
          <h1>Activity logs</h1>
          <p className="workspace-description">A concise record of meaningful application changes and provider sync outcomes from the last seven days.</p>
        </div>
        <div className="activity-log-retention"><span className="live-dot" aria-hidden="true" /> Retained for seven days</div>
      </header>

      <div className="activity-log-layout">
        <div className="activity-log-toolbar" aria-busy={isPending}>
          <label className="search-field activity-log-search">
            <Search size={18} strokeWidth={1.8} aria-hidden="true" />
            <span className="sr-only">Search activity logs</span>
            <Input value={searchInput} onChange={(event) => onSearchChange(event.target.value)} placeholder="Search summaries, events or actors" />
          </label>
          <div className="activity-log-filters">
            <Select value={query.domain} onValueChange={(value) => navigate({ domain: value as ActivityLogQuery["domain"] })}>
              <SelectTrigger aria-label="Activity domain"><SelectValue /></SelectTrigger>
              <SelectContent>{domainOptions.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={query.source} onValueChange={(value) => navigate({ source: value as ActivityLogQuery["source"] })}>
              <SelectTrigger aria-label="Activity source"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All sources</SelectItem><SelectItem value="manual">Manual</SelectItem><SelectItem value="scheduled">Scheduled</SelectItem><SelectItem value="webhook">Webhook</SelectItem><SelectItem value="provider">Provider</SelectItem></SelectContent>
            </Select>
            <Select value={query.outcome} onValueChange={(value) => navigate({ outcome: value as ActivityLogQuery["outcome"] })}>
              <SelectTrigger aria-label="Activity outcome"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All outcomes</SelectItem><SelectItem value="succeeded">Succeeded</SelectItem><SelectItem value="failed">Failed</SelectItem><SelectItem value="skipped">Skipped</SelectItem></SelectContent>
            </Select>
            <Select value={query.dateRange} onValueChange={(value) => navigate({ dateRange: value as ActivityLogQuery["dateRange"] })}>
              <SelectTrigger aria-label="Activity date range"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="7">Last seven days</SelectItem><SelectItem value="all">All retained</SelectItem></SelectContent>
            </Select>
            <label className="activity-filter-input"><span className="sr-only">Filter by provider</span><Input value={query.provider} onChange={(event) => navigate({ provider: event.target.value }, true)} placeholder="Provider" /></label>
            <label className="activity-filter-input"><span className="sr-only">Filter by actor</span><Input value={query.actor} onChange={(event) => navigate({ actor: event.target.value }, true)} placeholder="Actor" /></label>
          </div>
        </div>

        <Card className="activity-log-card" style={{ opacity: isPending ? 0.62 : 1 }}>
          <CardHeader className="activity-log-card__header"><div><CardTitle>Recent activity</CardTitle><CardDescription>{page.total ? `${page.total} event${page.total === 1 ? "" : "s"} match this view.` : "Business changes and sync outcomes will appear here."}</CardDescription></div><span className="activity-log-card__scope">Newest first</span></CardHeader>
          <CardContent className="activity-log-card__content">
            {page.rows.length ? <>
              <Table className="activity-log-table">
                <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Activity</TableHead><TableHead>Actor</TableHead><TableHead>Source</TableHead><TableHead>Outcome</TableHead><TableHead><span className="sr-only">Details</span></TableHead></TableRow></TableHeader>
                <TableBody>{page.rows.map((row) => <TableRow key={row.id}>
                  <TableCell className="activity-log-time">{formatActivityTime(row.occurredAt)}</TableCell>
                  <TableCell><div className="activity-log-summary"><strong>{row.summary}</strong><small>{eventLabel(row.eventName)}</small></div></TableCell>
                  <TableCell><div className="activity-log-actor"><strong>{row.actor.label}</strong><small>{row.actor.type}</small></div></TableCell>
                  <TableCell>{sourceLabel(row.source, row.provider)}</TableCell>
                  <TableCell><OutcomePill outcome={row.outcome} /></TableCell>
                  <TableCell><details className="activity-detail-disclosure"><summary>Details</summary><ActivityDetails row={row} /></details></TableCell>
                </TableRow>)}</TableBody>
              </Table>
              <div className="activity-log-mobile-list" aria-label="Recent activity">{page.rows.map((row) => <Card className="activity-log-mobile-card" key={row.id}>
                <CardHeader><div className="activity-log-mobile-card__top"><CardTitle>{row.summary}</CardTitle><OutcomePill outcome={row.outcome} /></div><CardDescription>{eventLabel(row.eventName)} · {formatActivityTime(row.occurredAt)}</CardDescription></CardHeader>
                <CardContent><div className="activity-log-mobile-meta"><span><small>Actor</small><strong>{row.actor.label}</strong></span><span><small>Source</small><strong>{sourceLabel(row.source, row.provider)}</strong></span></div><details className="activity-detail-disclosure"><summary>View details</summary><ActivityDetails row={row} /></details></CardContent>
              </Card>)}</div>
            </> : <div className="activity-log-empty"><strong>No activity matches these filters</strong><p>Try a broader search or return to the seven-day view.</p></div>}
          </CardContent>
          <footer className="table-footer activity-log-footer">
            <div className="page-size-control"><Select value={String(page.pageSize)} onValueChange={(value) => navigate({ pageSize: Number(value) as ActivityLogQuery["pageSize"] })}><SelectTrigger aria-label="Activity events per page"><SelectValue /></SelectTrigger><SelectContent>{ACTIVITY_LOG_PAGE_SIZES.map((size) => <SelectItem key={size} value={String(size)}>{size} per page</SelectItem>)}</SelectContent></Select></div>
            <div className="pagination" aria-label="Activity log pagination"><span className="pagination-summary">{activityLogPageLabel(page)}</span><button type="button" onClick={() => navigate({ page: page.page - 1 })} disabled={page.page === 1} aria-label="Previous page"><ChevronLeft size={16} /></button>{pageItems.map((item, index) => item === "ellipsis" ? <span className="pagination-ellipsis" key={`ellipsis-${index}`}>…</span> : <button type="button" key={item} className={item === page.page ? "is-current" : ""} aria-current={item === page.page ? "page" : undefined} onClick={() => navigate({ page: item })}>{item}</button>)}<button type="button" onClick={() => navigate({ page: page.page + 1 })} disabled={page.pageCount === 0 || page.page === page.pageCount} aria-label="Next page"><ChevronRight size={16} /></button></div>
          </footer>
        </Card>
      </div>
    </section>
  );
}
