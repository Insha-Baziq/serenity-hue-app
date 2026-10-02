"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { ChartContainer } from "@/components/ui/chart";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getPageItems } from "@/lib/pagination";
import { formatVatMoney } from "@/lib/vat-money";
import { VAT_MONTH_NAMES } from "@/lib/vat-rules";
import type { VatSummaryData, VatSummaryQuery } from "@/lib/vat-types";
import styles from "./vat-workspace.module.css";

const PRESETS: Array<[VatSummaryQuery["preset"], string]> = [
  ["month", "Month"], ["last_month", "Last month"], ["quarter", "This quarter"], ["year", "This year"], ["all", "All time"], ["custom", "Custom range"],
];
const SUPPLIERS_PER_PAGE = 10;
const plum = "#6c285f";
const rose = "#ead8e1";

const monthLabel = (month: string, short = false) => {
  const name = VAT_MONTH_NAMES[Number(month.slice(5, 7)) - 1];
  return short ? `${name.slice(0, 3)} ${month.slice(2, 4)}` : `${name} ${month.slice(0, 4)}`;
};
const pounds = (minor: number) => formatVatMoney(minor, "GBP");

export function VatSummary({ data, months }: { data: VatSummaryData; months: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const { query, totals } = data;
  const [from, setFrom] = useState(query.from ?? "");
  const [to, setTo] = useState(query.to ?? "");
  const [supplierPage, setSupplierPage] = useState(1);

  function go(next: Partial<VatSummaryQuery>) {
    const merged = { ...query, ...next };
    const params = new URLSearchParams({ tab: "summary", period: merged.preset });
    if (merged.preset === "month") params.set("month", merged.month);
    if (merged.preset === "custom") {
      if (merged.from) params.set("from", merged.from);
      if (merged.to) params.set("to", merged.to);
    }
    setSupplierPage(1);
    startTransition(() => router.push(`${pathname}?${params}`, { scroll: false }));
  }

  const monthChoices = months.includes(query.month) ? months : [query.month, ...months];
  const chartData = data.byMonth.map((row) => ({ label: monthLabel(row.month, true), net: row.netMinor / 100, vat: row.vatMinor / 100 }));
  const monthTotal = data.byMonth.reduce((sum, row) => ({
    invoices: sum.invoices + row.invoices, netMinor: sum.netMinor + row.netMinor, vatMinor: sum.vatMinor + row.vatMinor, grossMinor: sum.grossMinor + row.grossMinor,
  }), { invoices: 0, netMinor: 0, vatMinor: 0, grossMinor: 0 });
  const pageCount = Math.max(1, Math.ceil(data.bySupplier.length / SUPPLIERS_PER_PAGE));
  const page = Math.min(supplierPage, pageCount);
  const suppliers = data.bySupplier.slice((page - 1) * SUPPLIERS_PER_PAGE, page * SUPPLIERS_PER_PAGE);

  return <div aria-busy={isPending} style={{ opacity: isPending ? 0.62 : 1 }}>
    <div className={styles.summaryControls}>
      <div className={styles.chipRow} role="group" aria-label="Period">
        {PRESETS.map(([preset, label]) => <button key={preset} type="button" className={styles.periodChip} aria-pressed={query.preset === preset} onClick={() => go({ preset })}>{label}</button>)}
      </div>
      <div className={styles.filters}>
        {query.preset === "month" && <Select value={query.month} onValueChange={(month) => go({ month })}>
          <SelectTrigger aria-label="Month" className={styles.monthSelect}><SelectValue /></SelectTrigger>
          <SelectContent>{monthChoices.map((month) => <SelectItem key={month} value={month}>{monthLabel(month)}</SelectItem>)}</SelectContent>
        </Select>}
        {query.preset === "custom" && <form className={styles.rangeForm} onSubmit={(event) => { event.preventDefault(); go({ from: from || null, to: to || null }); }}>
          <Input className={styles.input} type="date" value={from} onChange={(event) => setFrom(event.target.value)} aria-label="From" />
          <span className={styles.muted}>to</span>
          <Input className={styles.input} type="date" value={to} onChange={(event) => setTo(event.target.value)} aria-label="To" />
          <Button type="submit" variant="outline" className={styles.control}>Apply</Button>
        </form>}
      </div>
    </div>

    <div className={styles.metricGrid}>
      <div className={`${styles.metric} ${styles.metricLead}`}>
        <span className={styles.kicker}>VAT paid</span>
        <strong>{pounds(totals.vatMinor)}</strong>
        <span className={styles.muted}>{totals.estimatedVatMinor ? `${pounds(totals.estimatedVatMinor)} estimated at 20% where no VAT was shown` : data.range.label}</span>
      </div>
      <div className={styles.metric}><span className={styles.kicker}>Net spend</span><strong>{pounds(totals.netMinor)}</strong><span className={styles.muted}>Before VAT</span></div>
      <div className={styles.metric}><span className={styles.kicker}>Total paid</span><strong>{pounds(totals.grossMinor)}</strong><span className={styles.muted}>Including VAT</span></div>
      <div className={styles.metric}><span className={styles.kicker}>Invoices</span><strong>{totals.invoices}</strong><span className={styles.muted}>Approved · {data.range.label}</span></div>
    </div>

    <div className={styles.summaryGrid}>
      <section className={styles.summaryPanel}>
        <div className={styles.panelHead}>
          <h3 className={styles.panelTitle}>VAT by month</h3>
          <div className={styles.legend}><span><i style={{ background: rose }} />Net</span><span><i style={{ background: plum }} />VAT</span></div>
        </div>
        {chartData.length ? <div className={styles.summaryChart}>
          <ChartContainer id="vat-by-month" config={{ net: { label: "Net", color: rose }, vat: { label: "VAT", color: plum } }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap="34%" barGap={3}>
                <CartesianGrid stroke="#f1eaee" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: "#9a8d94", fontSize: 11 }} axisLine={false} tickLine={false} dy={6} />
                <YAxis tickFormatter={(value: number) => `£${Math.round(value).toLocaleString("en-GB")}`} tick={{ fill: "#a89da2", fontSize: 10 }} axisLine={false} tickLine={false} width={52} tickCount={4} />
                <Tooltip formatter={(value: unknown, name: unknown) => [`£${Number(value).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, name === "vat" ? "VAT" : "Net"]} cursor={{ fill: "#fbf3f7" }} contentStyle={{ border: "1px solid #e7dce2", borderRadius: 8, background: "#fffefd", fontSize: 12 }} />
                <Bar dataKey="net" name="net" fill={rose} radius={[2, 2, 0, 0]} maxBarSize={16} />
                <Bar dataKey="vat" name="vat" fill={plum} radius={[2, 2, 0, 0]} maxBarSize={16} />
              </BarChart>
            </ResponsiveContainer>
          </ChartContainer>
        </div> : <div className={styles.empty}><strong>No approved invoices in this period</strong></div>}
        {data.byMonth.length > 0 && <Table className={styles.summaryTable}>
          <TableHeader><TableRow><TableHead>Month</TableHead><TableHead className={styles.amount}>Invoices</TableHead><TableHead className={styles.amount}>Net</TableHead><TableHead className={styles.amount}>VAT</TableHead><TableHead className={styles.amount}>Total</TableHead></TableRow></TableHeader>
          <TableBody>
            {data.byMonth.map((row) => <TableRow key={row.month}><TableCell>{monthLabel(row.month)}</TableCell><TableCell className={styles.amount}>{row.invoices}</TableCell><TableCell className={styles.amount}>{pounds(row.netMinor)}</TableCell><TableCell className={styles.amount}>{pounds(row.vatMinor)}</TableCell><TableCell className={styles.amount}>{pounds(row.grossMinor)}</TableCell></TableRow>)}
            {data.byMonth.length > 1 && <TableRow className={styles.totalRow}><TableCell>Total</TableCell><TableCell className={styles.amount}>{monthTotal.invoices}</TableCell><TableCell className={styles.amount}>{pounds(monthTotal.netMinor)}</TableCell><TableCell className={styles.amount}>{pounds(monthTotal.vatMinor)}</TableCell><TableCell className={styles.amount}>{pounds(monthTotal.grossMinor)}</TableCell></TableRow>}
          </TableBody>
        </Table>}
      </section>

      <section className={styles.summaryPanel}>
        <div className={styles.panelHead}>
          <h3 className={styles.panelTitle}>VAT by supplier</h3>
          <span className={styles.panelSub}>Ranked by VAT</span>
        </div>
        {suppliers.length ? <>
          <Table className={styles.summaryTable}>
            <TableHeader><TableRow><TableHead>Supplier</TableHead><TableHead className={styles.amount}>Invoices</TableHead><TableHead className={styles.amount}>Net</TableHead><TableHead className={styles.amount}>VAT</TableHead><TableHead className={styles.amount}>Total</TableHead></TableRow></TableHeader>
            <TableBody>
              {suppliers.map((row) => <TableRow key={row.supplier}><TableCell>{row.supplier}</TableCell><TableCell className={styles.amount}>{row.invoices}</TableCell><TableCell className={styles.amount}>{pounds(row.netMinor)}</TableCell><TableCell className={styles.amount}>{pounds(row.vatMinor)}</TableCell><TableCell className={styles.amount}>{pounds(row.grossMinor)}</TableCell></TableRow>)}
              <TableRow className={styles.totalRow}><TableCell>All suppliers ({data.bySupplier.length})</TableCell><TableCell className={styles.amount}>{totals.invoices}</TableCell><TableCell className={styles.amount}>{pounds(totals.netMinor)}</TableCell><TableCell className={styles.amount}>{pounds(totals.vatMinor)}</TableCell><TableCell className={styles.amount}>{pounds(totals.grossMinor)}</TableCell></TableRow>
            </TableBody>
          </Table>
          <footer className={styles.summaryFooter}>
            <span>{(page - 1) * SUPPLIERS_PER_PAGE + 1}–{Math.min(page * SUPPLIERS_PER_PAGE, data.bySupplier.length)} of {data.bySupplier.length} suppliers</span>
            {pageCount > 1 && <div className="pagination" aria-label="Supplier pagination">
              <button type="button" onClick={() => setSupplierPage(page - 1)} disabled={page === 1} aria-label="Previous page"><ChevronLeft size={16} /></button>
              {getPageItems(page, pageCount).map((item, index) => item === "ellipsis"
                ? <span className="pagination-ellipsis" key={`ellipsis-${index}`}>…</span>
                : <button type="button" key={item} className={item === page ? "is-current" : ""} aria-current={item === page ? "page" : undefined} onClick={() => setSupplierPage(item)}>{item}</button>)}
              <button type="button" onClick={() => setSupplierPage(page + 1)} disabled={page === pageCount} aria-label="Next page"><ChevronRight size={16} /></button>
            </div>}
          </footer>
        </> : <div className={styles.empty}><strong>No approved invoices in this period</strong></div>}
      </section>
    </div>

    <div className={styles.summaryNote}>
      <span>
        Only approved invoices in pounds are counted.
        {data.awaitingReview > 0 && <> <b>{data.awaitingReview} waiting for review</b> {data.awaitingReview === 1 ? "is" : "are"} not included.</>}
        {data.foreign.length > 0 && <> Other currencies, not converted: {data.foreign.map((row) => `${formatVatMoney(row.grossMinor, row.currency)} (${row.invoices})`).join(", ")}.</>}
      </span>
      {data.awaitingReview > 0 && <Link className={`ui-button ui-button--outline ${styles.linkButton}`} href="/vat?review=1">Review now</Link>}
    </div>
  </div>;
}
