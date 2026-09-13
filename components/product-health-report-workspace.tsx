"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Download, ExternalLink } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/format";
import type { ProductHealthReport, ProductReportRow } from "@/lib/product-health-report";
import { shiftCalendarDate } from "@/lib/reporting-period";
import s from "./product-health-report-workspace.module.css";

type Props = { report: ProductHealthReport; catalogue: Array<{ id: string; title: string }> };

function dateLabel(date: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${date}T12:00:00.000Z`));
}

function periodLabel(range: ProductHealthReport["range"]) {
  return range.allTime ? "All recorded activity" : `${dateLabel(range.start)} – ${dateLabel(range.end)}`;
}

function delta(value: number, money = false) {
  const formatted = money ? formatMoney(Math.abs(value)) : Math.abs(value).toLocaleString("en-GB");
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${formatted}`;
}

function ProductTable({ products }: { products: ProductReportRow[] }) {
  return <>
    <div className={s.tableScroll}><table className={s.table}>
      <thead><tr><th>Physical product</th><th>Net units</th><th>Net revenue</th><th>vs previous</th><th>Physical stock</th><th>Shopify shown</th><th>TikTok shown</th><th>Days of cover</th></tr></thead>
      <tbody>{products.map((product) => <tr key={product.id}><td><Link href={`/inventory/products/${product.id}`}>{product.title}<ExternalLink aria-hidden="true" /></Link></td><td>{product.netUnits.toLocaleString("en-GB")}</td><td>{formatMoney(product.netRevenue)}</td><td>{product.comparison ? `${delta(product.comparison.netUnitsDelta)} units · ${delta(product.comparison.netRevenueDelta, true)}` : "Not available"}</td><td>{product.physicalStock === null ? "Not counted" : product.physicalStock.toLocaleString("en-GB")}</td><td>{product.channelQuantities.shopify === null ? "Not fetched" : product.channelQuantities.shopify.toLocaleString("en-GB")}</td><td>{product.channelQuantities.tiktok === null ? "Not fetched" : product.channelQuantities.tiktok.toLocaleString("en-GB")}</td><td title={product.coverageNote}>{product.daysOfCover === null ? "Not available" : `${product.daysOfCover.toLocaleString("en-GB")} days`}</td></tr>)}</tbody>
    </table></div>
    <div className={s.mobileProducts}>{products.map((product) => <details key={product.id}><summary><span>{product.title}</span><strong>{product.netUnits.toLocaleString("en-GB")} net units</strong></summary><dl><div><dt>Net revenue</dt><dd>{formatMoney(product.netRevenue)}</dd></div><div><dt>Previous period</dt><dd>{product.comparison ? `${delta(product.comparison.netUnitsDelta)} units · ${delta(product.comparison.netRevenueDelta, true)}` : "Not available"}</dd></div><div><dt>Physical stock</dt><dd>{product.physicalStock ?? "Not counted"}</dd></div><div><dt>Shopify shown</dt><dd>{product.channelQuantities.shopify ?? "Not fetched"}</dd></div><div><dt>TikTok shown</dt><dd>{product.channelQuantities.tiktok ?? "Not fetched"}</dd></div><div><dt>Days of cover</dt><dd>{product.daysOfCover === null ? "Not available" : `${product.daysOfCover} days`}</dd></div></dl></details>)}</div>
  </>;
}

export function ProductHealthReportWorkspace({ report, catalogue }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [custom, setCustom] = useState(false);
  function navigate(next: { start?: string; end?: string; all?: boolean; product?: string }) {
    const query = new URLSearchParams();
    const product = next.product === undefined ? (report.mode === "single" ? report.products[0]?.id : "") : next.product;
    if (product) query.set("product", product);
    if (next.all) query.set("period", "all");
    else { query.set("start", next.start ?? report.range.start); query.set("end", next.end ?? report.range.end); }
    startTransition(() => router.push(`/analytics/reports/products?${query}`));
  }

  function preset(days: number) { navigate({ start: shiftCalendarDate(report.range.end, -(days - 1)), end: report.range.end }); }

  return <section className={`workspace ${s.workspace}`} aria-busy={isPending || undefined}>
    <div className={s.screenToolbar}><Link href="/analytics/reports"><ArrowLeft aria-hidden="true" /> Reports</Link><Button variant="outline" onClick={() => window.print()}><Download aria-hidden="true" /> Export PDF</Button></div>
    <article className={s.report}>
      <header className={s.reportHeader}>
        <div className={s.brand}><Image src="/serenity-hue-logo-black.png" alt="Serenity Hue by Shabina" width={126} height={126} priority /></div>
        <div className={s.titleBlock}><p>Analytics report</p><h1>{report.title}</h1><p>{periodLabel(report.range)}{report.comparisonRange ? ` · compared with ${periodLabel(report.comparisonRange)}` : ""}</p></div>
        <dl className={s.metadata}><div><dt>Generated</dt><dd>{new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" }).format(new Date(report.generatedAt))}</dd></div><div><dt>Data current as of</dt><dd>{report.freshness ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" }).format(new Date(report.freshness)) : "Awaiting first successful sync"}</dd></div></dl>
      </header>

      <div className={s.controls} aria-label="Report controls">
        <label>Report scope<select value={report.mode === "single" ? report.products[0]?.id : ""} onChange={(event) => navigate({ product: event.target.value })}><option value="">All physical products</option>{catalogue.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label>
        <div className={s.periodControls} role="group" aria-label="Reporting period"><button onClick={() => preset(7)}>7 days</button><button onClick={() => preset(30)}>30 days</button><button onClick={() => preset(90)}>90 days</button><button onClick={() => navigate({ all: true })}>All time</button><button onClick={() => setCustom((value) => !value)} aria-expanded={custom}>Custom</button></div>
        {custom && <form className={s.custom} onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); navigate({ start: String(data.get("start")), end: String(data.get("end")) }); }}><label>From<input name="start" type="date" defaultValue={report.range.start} required /></label><label>To<input name="end" type="date" defaultValue={report.range.end} required /></label><Button size="compact" type="submit">Apply</Button></form>}
      </div>

      <section className={s.summary} aria-labelledby="report-summary"><div><p>Net merchandise revenue</p><strong>{formatMoney(report.metrics.netSales)}</strong><span>{report.previousMetrics ? `${delta(report.metrics.netSales - report.previousMetrics.netSales, true)} vs previous` : "No preceding all-time comparison"}</span></div><div><p>Net units</p><strong>{report.metrics.netUnits.toLocaleString("en-GB")}</strong><span>Refund-aware {report.mode === "single" ? "mapped product" : "mapped and unmapped"} units</span></div><div><p>{report.mode === "single" ? "Physical variants" : "Paid orders"}</p><strong>{report.mode === "single" ? report.products[0]?.variants.length.toLocaleString("en-GB") : report.metrics.orders?.toLocaleString("en-GB")}</strong><span>{report.mode === "single" ? "Active variants in this physical product" : "Cancelled orders excluded"}</span></div><div><p>{report.mode === "single" ? "Period-wide unmapped sales" : "Unmapped sales"}</p><strong>{report.unmappedSales.netUnits.toLocaleString("en-GB")}</strong><span>{formatMoney(report.unmappedSales.netRevenue)} retained in period totals</span></div></section>

      <section className={s.section}><div className={s.sectionHeading}><div><p>Factual summary</p><h2 id="report-summary">What changed in this period</h2></div></div><ul className={s.observations}>{report.observations.map((item) => <li key={item}>{item}</li>)}</ul></section>

      <section className={s.section}><div className={s.sectionHeading}><div><p>Overall product performance</p><h2>Product ranking and comparison</h2></div><span>Ranked by refund-aware net units, then net revenue</span></div>{report.products.length ? <ProductTable products={report.products} /> : <p className={s.empty}>No active physical products match this report selection.</p>}</section>

      <section className={s.section}><div className={s.sectionHeading}><div><p>Demand trend</p><h2>{report.range.allTime || report.trendGranularity === "bucket" ? "Monthly / bucketed product demand" : "Daily product demand"}</h2></div><span>Refund-aware mapped net units and merchandise revenue</span></div>{report.trend.length ? <><div className={s.chart} role="img" aria-label={`Mapped product demand across ${report.trend.length} reporting buckets`}>{report.trend.map((point) => <div key={point.date} title={`${dateLabel(point.date)} · ${point.netUnits} net units · ${formatMoney(point.netRevenue)}`}><span style={{ height: `${Math.max(2, Math.max(0, point.netUnits) / Math.max(1, Math.max(...report.trend.map((entry) => entry.netUnits))) * 100)}%` }} /><small>{point.date.slice(5)}</small></div>)}</div><details className={s.disclosure}><summary>View exact trend values</summary><div className={s.tableScroll}><table className={s.table}><thead><tr><th>Date / bucket</th><th>Net units</th><th>Net revenue</th></tr></thead><tbody>{report.trend.map((point) => <tr key={point.date}><td>{dateLabel(point.date)}</td><td>{point.netUnits}</td><td>{formatMoney(point.netRevenue)}</td></tr>)}</tbody></table></div></details></> : <p className={s.empty}>No mapped product demand was recorded for this selection and period.</p>}</section>

      <section className={s.section}><div className={s.sectionHeading}><div><p>Variants and channel listings</p><h2>Physical variant detail</h2></div><span>Physical quantities stay separate from channel-shown quantities</span></div><div className={s.detailGrid}>{report.products.map((product) => <details key={product.id} open={report.mode === "single"}><summary><span>{product.title}</span><strong>{product.variants.length} variant{product.variants.length === 1 ? "" : "s"}</strong></summary><div className={s.variantList}>{product.variants.map((variant) => <div key={variant.id}><div><strong>{variant.title}</strong><small>{variant.sku || "No SKU recorded"}</small></div><span>{variant.quantity === null ? "Not counted" : `${variant.quantity} physical`}</span><p>{variant.listings.length ? variant.listings.map((listing) => `${listing.channel === "shopify" ? "Shopify" : "TikTok"}: ${listing.title}${listing.kind === "bundle" ? ` bundle ×${listing.quantityPerSale}` : ""}`).join(" · ") : "No confirmed component mapping"}</p></div>)}</div></details>)}</div></section>

      <section className={s.section}><div className={s.sectionHeading}><div><p>Bundle components</p><h2>Related bundle channel listings</h2></div></div>{report.bundleListings.length ? <div className={s.bundleGrid}>{report.bundleListings.map((listing) => <article key={listing.id}><header><strong>{listing.title}</strong><span>{listing.channel === "shopify" ? "Shopify" : "TikTok"} · {listing.channelQuantity === null ? "quantity not fetched" : `${listing.channelQuantity} shown`}</span></header><ul>{listing.components.map((component) => <li key={component.id}>{component.itemTitle} · {component.variantTitle} × {component.quantityPerSale}</li>)}</ul></article>)}</div> : <p className={s.empty}>No confirmed bundle component mappings relate to this report selection.</p>}</section>

      <footer className={s.notes}><h2>Refunds, cancellations and data notes</h2><p>Net merchandise revenue and net units follow the KPI workspace: cancelled orders are excluded and refunds are applied on their processed London calendar date. Bundle sales are represented through confirmed physical-variant components. Uncertain mappings are never inferred.</p><dl><div><dt>Refund events in period</dt><dd>{report.dataQuality.refundEvents}</dd></div><div><dt>Refunded units in period</dt><dd>{report.dataQuality.refundedUnits}</dd></div><div><dt>Cancelled orders excluded</dt><dd>{report.dataQuality.cancelledOrders}</dd></div><div><dt>Uncertain channel listings</dt><dd>{report.dataNotes.uncertainListings}</dd></div><div><dt>Unmapped channel listings</dt><dd>{report.dataNotes.unmappedListings}</dd></div><div><dt>Uncounted physical products in scope</dt><dd>{report.dataNotes.uncountedProducts}</dd></div></dl></footer>
    </article>
  </section>;
}
