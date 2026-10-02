"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Download, Inbox, Link2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { VatConnectionsSheet } from "@/components/vat-connections-sheet";
import { VatInvoiceSheet } from "@/components/vat-invoice-sheet";
import { VatUploadDialog, type VatUploadTarget } from "@/components/vat-upload-dialog";
import { VatGetInvoicesDialog } from "@/components/vat-get-invoices-dialog";
import { useVatRun } from "@/components/use-vat-run";
import { getPageItems } from "@/lib/pagination";
import { formatVatMoney } from "@/lib/vat-money";
import { vatEmailLink, VAT_CATEGORY_LABELS, VAT_GET_REASON_LABELS, VAT_MONTH_NAMES, VAT_NOTE_LABELS, VAT_REMOVED_REASON_LABELS } from "@/lib/vat-rules";
import type { VatEmailRow, VatInvoiceRow, VatTab, VatWorkspaceData } from "@/lib/vat-types";
import styles from "./vat-workspace.module.css";

type Props = { data: VatWorkspaceData; notice: string | null; connectionError: string | null };

const TAB_LABELS: Record<VatTab, string> = { saved: "Invoices", to_get: "To get", ignored: "Ignored", removed: "Removed" };

export function formatVatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: value.length === 10 ? "UTC" : "Europe/London" }).format(date);
}

function monthLabel(month: string) {
  return `${VAT_MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

export function VatNoteChips({ notes }: { notes: string[] }) {
  const visible = notes.filter((note) => note in VAT_NOTE_LABELS || note in VAT_GET_REASON_LABELS);
  if (!visible.length) return null;
  return <span className={styles.chips}>{visible.map((note) => {
    const reason = VAT_GET_REASON_LABELS[note];
    const label = reason?.label ?? VAT_NOTE_LABELS[note].label;
    const tone = note === "extraction_failed" || note === "totals_dont_add_up" ? styles.chipError : note === "duplicate" || note === "unsure" ? styles.chipWarn : "";
    return <span key={note} className={`${styles.chip} ${tone}`} title={(reason ?? VAT_NOTE_LABELS[note]).help}>{label}</span>;
  })}</span>;
}

function InvoiceTable({ tab, rows, onOpen }: { tab: VatTab; rows: VatInvoiceRow[]; onOpen: (id: number) => void }) {
  const open = (id: number) => ({
    onClick: () => onOpen(id),
    onKeyDown: (event: React.KeyboardEvent) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(id); } },
    tabIndex: 0,
    role: "button" as const,
    "aria-label": "Open invoice details",
  });
  return <>
    <Table className={styles.table}>
      <TableHeader><TableRow>
        <TableHead>{tab === "removed" ? "Removed" : "Date"}</TableHead>
        <TableHead>Supplier</TableHead>
        <TableHead>{tab === "to_get" ? "What to do" : tab === "removed" ? "Reason" : "Invoice no"}</TableHead>
        {tab === "saved" && <><TableHead className={styles.amount}>Net</TableHead><TableHead className={styles.amount}>VAT</TableHead></>}
        <TableHead className={styles.amount}>Total</TableHead>
        <TableHead>{tab === "saved" ? "Notes" : tab === "removed" ? "By" : "Source"}</TableHead>
        <TableHead>Links</TableHead>
      </TableRow></TableHeader>
      <TableBody>{rows.map((row) => <TableRow key={row.id} {...open(row.id)}>
        <TableCell>{formatVatDate(tab === "removed" ? row.removedAt : row.invoiceDate)}</TableCell>
        <TableCell className={styles.supplierCell}><span className={styles.strong}>{row.supplierName ?? "Unknown supplier"}</span>{row.emailSubject && <span className={styles.muted} title={row.emailSubject}>{row.emailSubject}</span>}</TableCell>
        <TableCell>{tab === "to_get" ? <VatNoteChips notes={row.notes.filter((note) => note in VAT_GET_REASON_LABELS)} /> : tab === "removed" ? VAT_REMOVED_REASON_LABELS[row.removedReason ?? ""] ?? "—" : row.invoiceNumber ?? "—"}</TableCell>
        {tab === "saved" && <><TableCell className={styles.amount}>{formatVatMoney(row.netMinor, row.currency)}</TableCell><TableCell className={styles.amount}>{formatVatMoney(row.vatMinor, row.currency)}</TableCell></>}
        <TableCell className={styles.amount}>{formatVatMoney(row.grossMinor, row.currency)}</TableCell>
        <TableCell className={styles.notesCell}>{tab === "saved" ? <VatNoteChips notes={row.notes} /> : tab === "removed" ? row.removedBy ?? "—" : row.source === "manual" ? "Upload" : row.emailFrom ?? "Email"}</TableCell>
<TableCell onClick={(event) => event.stopPropagation()}><span className={styles.chips}>{row.emailId && <a className={styles.link} href={vatEmailLink(row.emailId)} target="_blank" rel="noreferrer">Email</a>}{row.dropboxUrl && <a className={styles.link} href={row.dropboxUrl} target="_blank" rel="noreferrer">File</a>}</span></TableCell>
      </TableRow>)}</TableBody>
    </Table>
    <div className={styles.mobileList}>{rows.map((row) => <button type="button" className={styles.mobileCard} key={row.id} onClick={() => onOpen(row.id)}>
      <span className={styles.mobileCardTop}><span className={styles.strong}>{row.supplierName ?? "Unknown supplier"}</span><span className={styles.amount}>{formatVatMoney(row.grossMinor, row.currency)}</span></span>
      <span className={styles.muted}>{formatVatDate(tab === "removed" ? row.removedAt : row.invoiceDate)}{row.invoiceNumber ? ` · ${row.invoiceNumber}` : ""}</span>
      {tab === "removed" ? <span className={styles.muted}>{VAT_REMOVED_REASON_LABELS[row.removedReason ?? ""] ?? ""}</span> : <VatNoteChips notes={row.notes} />}
    </button>)}</div>
  </>;
}

function EmailTable({ rows }: { rows: VatEmailRow[] }) {
  const status = (row: VatEmailRow) => row.status === "error"
    ? <span className={`${styles.chip} ${styles.chipError}`} title={row.error ?? undefined}>Couldn&apos;t process</span>
    : <span className={`${styles.chip} ${styles.chipQuiet}`}>{VAT_CATEGORY_LABELS[row.category ?? ""] ?? "Not a purchase"}</span>;
  return <>
    <Table className={styles.table}>
      <TableHeader><TableRow><TableHead>Received</TableHead><TableHead>From</TableHead><TableHead>Subject</TableHead><TableHead>Why</TableHead><TableHead>Inbox</TableHead></TableRow></TableHeader>
      <TableBody>{rows.map((row) => <TableRow key={row.id} style={{ cursor: "default" }}>
        <TableCell>{formatVatDate(row.receivedAt)}</TableCell>
        <TableCell><span className={styles.strong}>{row.fromName ?? row.fromEmail ?? "Unknown sender"}</span>{row.fromName && row.fromEmail && <span className={styles.muted}>{row.fromEmail}</span>}</TableCell>
        <TableCell>{row.subject ?? "(no subject)"}</TableCell>
        <TableCell>{status(row)}{row.decidedBy === "owner" && <span className={styles.muted}>Staff decision</span>}</TableCell>
        <TableCell>{row.inbox ?? "—"}</TableCell>
      </TableRow>)}</TableBody>
    </Table>
    <div className={styles.mobileList}>{rows.map((row) => <div className={styles.mobileCard} key={row.id}>
      <span className={styles.mobileCardTop}><span className={styles.strong}>{row.fromName ?? row.fromEmail ?? "Unknown sender"}</span><span className={styles.muted}>{formatVatDate(row.receivedAt)}</span></span>
      <span className={styles.muted}>{row.subject ?? "(no subject)"}</span>
      {status(row)}
    </div>)}</div>
  </>;
}

export function VatWorkspace({ data, notice, connectionError }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [openInvoiceId, setOpenInvoiceId] = useState<number | null>(null);
  const [uploadTarget, setUploadTarget] = useState<VatUploadTarget | null>(null);
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [getInvoicesOpen, setGetInvoicesOpen] = useState(false);
  const refreshList = useCallback(() => router.refresh(), [router]);
  const runController = useVatRun(refreshList);
  const activeRun = runController.run && ["listing", "processing", "paused"].includes(runController.run.status) ? runController.run : null;
  const { query, connections } = data;
  const dropboxReady = connections.dropbox.configured && connections.dropbox.connected;
  const years = [...new Set(data.months.map((month) => month.slice(0, 4)))];

  function href(next: Partial<typeof query>) {
    const merged = { ...query, page: 1, ...next };
    const params = new URLSearchParams();
    if (merged.tab !== "saved") params.set("tab", merged.tab);
    if (merged.month) params.set("month", merged.month);
    if (merged.page > 1) params.set("page", String(merged.page));
    return params.toString() ? `${pathname}?${params}` : pathname;
  }

  function navigate(next: Partial<typeof query>) {
    startTransition(() => router.push(href(next), { scroll: false }));
  }

  function refresh() {
    startTransition(() => router.refresh());
  }

  const monthFilters = query.tab === "saved" || query.tab === "ignored";
  const pageItems = getPageItems(query.page, data.pageCount);
  const rows = query.tab === "ignored" ? data.emails.length : data.invoices.length;

  return <section className="workspace workspace--vat">
    <header className={styles.header}>
      <div>
        <h1>VAT</h1>
        <p>Purchase invoices for the VAT return, shared by all staff.</p>
      </div>
      <div className={styles.headerActions}>
        <Button variant="outline" onClick={() => setConnectionsOpen(true)}><Link2 size={16} aria-hidden="true" /> Connections</Button>
        <Button variant="outline" onClick={() => setUploadTarget({ invoice: null })}><Upload size={16} aria-hidden="true" /> Upload invoice</Button>
        <Button variant="primary" onClick={() => setGetInvoicesOpen(true)}><Inbox size={16} aria-hidden="true" /> Get invoices</Button>
      </div>
    </header>

    {activeRun && <button type="button" className={activeRun.status === "paused" ? styles.warning : styles.notice} style={{ width: "100%", textAlign: "left", cursor: "pointer" }} onClick={() => setGetInvoicesOpen(true)}>
      <Inbox size={16} aria-hidden="true" />
      <span style={{ flex: 1 }}>
        {activeRun.status === "listing" ? "Getting invoices: finding emails…"
          : activeRun.status === "paused" ? `Getting invoices paused at ${activeRun.processed} of ${activeRun.total}. Open to resume.`
            : `Getting invoices: ${activeRun.processed} of ${activeRun.total} checked · ${activeRun.invoices} filed · ${activeRun.toGet} to get`}
        {activeRun.total > 0 && <progress max={activeRun.total} value={activeRun.processed} style={{ display: "block", width: "100%", marginTop: 6 }} aria-label="Get invoices progress" />}
      </span>
    </button>}
    {notice && <div className={styles.notice} role="status"><CheckCircle2 size={16} aria-hidden="true" />{notice}</div>}
    {connectionError && <div className={styles.errorNotice} role="alert"><AlertTriangle size={16} aria-hidden="true" />Connection not completed: {connectionError}</div>}
    {!dropboxReady && <div className={styles.warning} role="status">
      <AlertTriangle size={16} aria-hidden="true" />
      <span>{connections.dropbox.configured ? "Dropbox isn't connected." : "Dropbox isn't set up for this workspace yet."} Uploading documents and keeping file names in step are unavailable until the business Dropbox is connected. Records can still be reviewed and edited. <button type="button" className={styles.link} onClick={() => setConnectionsOpen(true)}>Open connections</button></span>
    </div>}
    {connections.dropbox.lastError && <div className={styles.errorNotice} role="alert"><AlertTriangle size={16} aria-hidden="true" />Dropbox needs reconnecting: {connections.dropbox.lastError}</div>}

    <div className={styles.toolbar}>
      <nav className={styles.tabs} aria-label="VAT lists">
        {(Object.keys(TAB_LABELS) as VatTab[]).map((tab) => <Link key={tab} className={styles.tab} href={href({ tab })} aria-current={query.tab === tab ? "page" : undefined} scroll={false}>
          {TAB_LABELS[tab]} <b>{data.counts[tab]}</b>
        </Link>)}
      </nav>
      <div className={styles.filters}>
        {monthFilters && <Select value={query.month ?? "all"} onValueChange={(value) => navigate({ month: value === "all" ? null : value })}>
          <SelectTrigger aria-label="Month"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All months</SelectItem>{data.months.map((month) => <SelectItem key={month} value={month}>{monthLabel(month)}</SelectItem>)}</SelectContent>
        </Select>}
        {years.map((year) => <a key={year} className="ui-button ui-button--outline ui-button--compact" href={`/api/vat/export?year=${year}`} download><Download size={14} aria-hidden="true" /> {year} log (CSV)</a>)}
      </div>
    </div>

    <div className={styles.panel} aria-busy={isPending} style={{ opacity: isPending ? 0.62 : 1 }}>
      {rows === 0
        ? <div className={styles.empty}>
            <strong>{query.tab === "saved" ? "No saved invoices for this view" : query.tab === "to_get" ? "Nothing to get" : query.tab === "ignored" ? "No ignored emails for this view" : "Nothing has been removed"}</strong>
            <span>{query.tab === "saved" ? "Upload an invoice, or import the existing VAT records." : query.tab === "to_get" ? "Purchases whose invoice must be fetched will appear here." : query.tab === "ignored" ? "Emails classified as not a purchase appear here once inbox data exists." : "Removed records stay here and can be restored."}</span>
          </div>
        : query.tab === "ignored" ? <EmailTable rows={data.emails} /> : <InvoiceTable tab={query.tab} rows={data.invoices} onOpen={setOpenInvoiceId} />}
      <footer className={styles.footer}>
        <span>{data.total ? `${(query.page - 1) * data.pageSize + 1}–${Math.min(query.page * data.pageSize, data.total)} of ${data.total}` : "0 records"}{query.month && monthFilters ? ` · ${monthLabel(query.month)}` : ""}</span>
        {data.pageCount > 1 && <div className="pagination" aria-label="VAT list pagination">
          <button type="button" onClick={() => navigate({ page: query.page - 1 })} disabled={query.page === 1} aria-label="Previous page"><ChevronLeft size={16} /></button>
          {pageItems.map((item, index) => item === "ellipsis" ? <span className="pagination-ellipsis" key={`ellipsis-${index}`}>…</span> : <button type="button" key={item} className={item === query.page ? "is-current" : ""} aria-current={item === query.page ? "page" : undefined} onClick={() => navigate({ page: item })}>{item}</button>)}
          <button type="button" onClick={() => navigate({ page: query.page + 1 })} disabled={query.page >= data.pageCount} aria-label="Next page"><ChevronRight size={16} /></button>
        </div>}
      </footer>
    </div>

    <VatInvoiceSheet
      invoiceId={openInvoiceId}
      dropboxReady={dropboxReady}
      onClose={() => setOpenInvoiceId(null)}
      onChanged={refresh}
      onUpload={(invoice) => { setOpenInvoiceId(null); setUploadTarget({ invoice }); }}
    />
    <VatUploadDialog target={uploadTarget} dropboxReady={dropboxReady} onClose={() => setUploadTarget(null)} onFiled={refresh} />
    <VatGetInvoicesDialog open={getInvoicesOpen} onOpenChange={setGetInvoicesOpen} controller={runController} />
    <VatConnectionsSheet open={connectionsOpen} onOpenChange={setConnectionsOpen} connections={connections} syncStartDate={data.syncStartDate} onChanged={refresh} />
  </section>;
}
