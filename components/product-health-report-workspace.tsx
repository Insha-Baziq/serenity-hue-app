"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Download, ExternalLink } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/format";
import type { ProductHealthReport, ProductReportRow } from "@/lib/product-health-report";
import { shiftCalendarDate } from "@/lib/reporting-period";
import s from "./product-health-report-workspace.module.css";

type Props = { report: ProductHealthReport; catalogue: Array<{ id: string; title: string }> };

function dateLabel(date: string, short = false) {
  return new Intl.DateTimeFormat("en-GB", short ? { day: "numeric", month: "short", timeZone: "Europe/London" } : { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" }).format(new Date(`${date}T12:00:00.000Z`));
}

function periodLabel(range: ProductHealthReport["range"]) {
  return range.allTime ? "All recorded activity" : `${dateLabel(range.start)} – ${dateLabel(range.end)}`;
}

function signed(value: number, money = false) {
  const formatted = money ? formatMoney(Math.abs(value)) : Math.abs(value).toLocaleString("en-GB");
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${formatted}`;
}

function percentageChange(current: number, previous: number) {
  if (previous === 0) return current === 0 ? "No change" : "New vs previous";
  const change = ((current - previous) / Math.abs(previous)) * 100;
  return `${change > 0 ? "+" : change < 0 ? "−" : ""}${Math.abs(change).toFixed(1)}% vs previous`;
}

function Metric({ label, value, note, emphasis = false }: { label: string; value: string; note: string; emphasis?: boolean }) {
  return <div className={`${s.metric} ${emphasis ? s.metricEmphasis : ""}`}><p>{label}</p><strong>{value}</strong><span>{note}</span></div>;
}

function TrendChart({ report }: { report: ProductHealthReport }) {
  const width = 720;
  const height = 230;
  const left = 36;
  const right = 14;
  const top = 18;
  const bottom = 34;
  const values = report.trend.map((point) => point.netUnits);
  const min = Math.min(0, ...values);
  const max = Math.max(1, ...values);
  const spread = Math.max(1, max - min);
  const x = (index: number) => left + (index / Math.max(1, report.trend.length - 1)) * (width - left - right);
  const y = (value: number) => top + ((max - value) / spread) * (height - top - bottom);
  const points = report.trend.map((point, index) => `${x(index)},${y(point.netUnits)}`).join(" ");
  const area = report.trend.length ? `${left},${y(0)} ${points} ${x(report.trend.length - 1)},${y(0)}` : "";
  const labelIndexes = [...new Set([0, Math.floor((report.trend.length - 1) / 2), report.trend.length - 1])].filter((index) => index >= 0);

  return <>
    <div className={s.trendChart} role="img" aria-label={`Net units over ${report.trend.length} reporting intervals, from ${values[0] ?? 0} to ${values.at(-1) ?? 0}`}>
      <svg viewBox={`0 0 ${width} ${height}`} aria-hidden="true" preserveAspectRatio="none">
        {[0, 0.5, 1].map((position) => <line key={position} x1={left} x2={width - right} y1={top + position * (height - top - bottom)} y2={top + position * (height - top - bottom)} className={s.gridLine} />)}
        <line x1={left} x2={width - right} y1={y(0)} y2={y(0)} className={s.zeroLine} />
        {area && <polygon points={area} className={s.trendArea} />}
        {points && <polyline points={points} className={s.trendLine} />}
        {report.trend.map((point, index) => <circle key={point.date} cx={x(index)} cy={y(point.netUnits)} r="3.5" className={s.trendPoint}><title>{`${dateLabel(point.date)}: ${point.netUnits} net units, ${formatMoney(point.netRevenue)}`}</title></circle>)}
        {labelIndexes.map((index) => <text key={index} x={x(index)} y={height - 8} textAnchor={index === 0 ? "start" : index === report.trend.length - 1 ? "end" : "middle"}>{dateLabel(report.trend[index].date, true)}</text>)}
      </svg>
    </div>
    <details className={s.dataDisclosure}><summary>Show chart data</summary><div className={s.tableScroll}><table className={s.compactTable}><thead><tr><th>Date / bucket</th><th>Net units</th><th>Net revenue</th></tr></thead><tbody>{report.trend.map((point) => <tr key={point.date}><td>{dateLabel(point.date)}</td><td>{point.netUnits.toLocaleString("en-GB")}</td><td>{formatMoney(point.netRevenue)}</td></tr>)}</tbody></table></div></details>
  </>;
}

function ContributionChart({ products }: { products: ProductReportRow[] }) {
  const leaders = [...products].filter((product) => product.netRevenue > 0).sort((a, b) => b.netRevenue - a.netRevenue).slice(0, 6);
  const max = Math.max(1, ...leaders.map((product) => product.netRevenue));
  if (!leaders.length) return <p className={s.empty}>No positive mapped product revenue was recorded for this period.</p>;
  return <div className={s.contributionChart}>{leaders.map((product, index) => <div className={s.contributionRow} key={product.id}>
    <div className={s.contributionLabel}><span>{index + 1}</span><b>{product.title}</b><strong>{formatMoney(product.netRevenue)}</strong></div>
    <div className={s.barTrack}><span style={{ width: `${Math.max(2, (product.netRevenue / max) * 100)}%` }} /></div>
    <small>{product.revenueShare.toFixed(1)}% of mapped revenue · {product.netUnits.toLocaleString("en-GB")} units</small>
  </div>)}</div>;
}

function ProductLedger({ products }: { products: ProductReportRow[] }) {
  return <>
    <div className={s.tableScroll}><table className={s.ledgerTable}>
      <thead><tr><th>Rank</th><th>Physical product</th><th>Net revenue</th><th>Share</th><th>Net units</th><th>Units / day</th><th>Period change</th><th>Physical stock</th><th>Days of cover</th></tr></thead>
      <tbody>{products.map((product, index) => <tr key={product.id}><td>{index + 1}</td><td><Link href={`/inventory/products/${product.id}`}>{product.title}<ExternalLink aria-hidden="true" /></Link></td><td>{formatMoney(product.netRevenue)}</td><td>{product.revenueShare.toFixed(1)}%</td><td>{product.netUnits.toLocaleString("en-GB")}</td><td>{product.unitsPerDay.toLocaleString("en-GB", { maximumFractionDigits: 2 })}</td><td>{product.comparison ? <span className={product.comparison.netUnitsDelta > 0 ? s.positive : product.comparison.netUnitsDelta < 0 ? s.negative : ""}>{signed(product.comparison.netUnitsDelta)} units<br /><small>{signed(product.comparison.netRevenueDelta, true)}</small></span> : "Not available"}</td><td>{product.physicalStock === null ? "Not counted" : product.physicalStock.toLocaleString("en-GB")}</td><td title={product.coverageNote}>{product.daysOfCover === null ? "Not available" : product.daysOfCover > 3650 ? "10+ years" : `${product.daysOfCover.toLocaleString("en-GB")} days`}</td></tr>)}</tbody>
    </table></div>
    <div className={s.mobileLedger}>{products.map((product, index) => <details key={product.id}><summary><span><b>{index + 1}</b>{product.title}</span><strong>{formatMoney(product.netRevenue)}</strong></summary><dl><div><dt>Revenue share</dt><dd>{product.revenueShare.toFixed(1)}%</dd></div><div><dt>Net units</dt><dd>{product.netUnits}</dd></div><div><dt>Units / day</dt><dd>{product.unitsPerDay}</dd></div><div><dt>Period change</dt><dd>{product.comparison ? `${signed(product.comparison.netUnitsDelta)} units` : "Not available"}</dd></div><div><dt>Physical stock</dt><dd>{product.physicalStock ?? "Not counted"}</dd></div><div><dt>Days of cover</dt><dd>{product.daysOfCover === null ? "Not available" : product.daysOfCover > 3650 ? "10+ years" : `${product.daysOfCover} days`}</dd></div></dl></details>)}</div>
  </>;
}

export function ProductHealthReportWorkspace({ report, catalogue }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [custom, setCustom] = useState(false);
  const currentProduct = report.mode === "single" ? report.products[0] : null;
  const channelTotal = report.portfolio.channelUnits.shopify + report.portfolio.channelUnits.tiktok;
  const channelShare = channelTotal > 0 ? (report.portfolio.channelUnits.shopify / channelTotal) * 100 : 0;
  const bundleCounts = useMemo(() => ({ shopify: report.bundleListings.filter((item) => item.channel === "shopify").length, tiktok: report.bundleListings.filter((item) => item.channel === "tiktok").length }), [report.bundleListings]);

  function navigate(next: { start?: string; end?: string; all?: boolean; product?: string }) {
    const query = new URLSearchParams();
    const product = next.product === undefined ? currentProduct?.id : next.product;
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
        <div className={s.brand}><Image src="/serenity-hue-logo-black.png" alt="Serenity Hue by Shabina" width={112} height={112} priority /></div>
        <div className={s.titleBlock}><p>Product performance · {report.mode === "single" ? report.products[0]?.title ?? "single product" : "portfolio"}</p><h1>Product Health Report</h1><p>{periodLabel(report.range)}{report.comparisonRange ? ` · previous ${periodLabel(report.comparisonRange)}` : ""}</p></div>
        <dl className={s.metadata}><div><dt>Generated</dt><dd>{new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" }).format(new Date(report.generatedAt))}</dd></div><div><dt>Data current as of</dt><dd>{report.freshness ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" }).format(new Date(report.freshness)) : "Awaiting first successful sync"}</dd></div></dl>
      </header>

      <div className={s.controls} aria-label="Report controls">
        <label>Product scope<select value={currentProduct?.id ?? ""} onChange={(event) => navigate({ product: event.target.value })}><option value="">All physical products</option>{catalogue.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label>
        <div><span className={s.controlLabel}>Reporting period</span><div className={s.periodControls} role="group" aria-label="Reporting period"><button onClick={() => preset(7)}>7 days</button><button onClick={() => preset(30)}>30 days</button><button onClick={() => preset(90)}>90 days</button><button onClick={() => navigate({ all: true })}>All time</button><button onClick={() => setCustom((value) => !value)} aria-expanded={custom}>Custom</button></div></div>
        {custom && <form className={s.custom} onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); navigate({ start: String(data.get("start")), end: String(data.get("end")) }); }}><label>From<input name="start" type="date" defaultValue={report.range.start} required /></label><label>To<input name="end" type="date" defaultValue={report.range.end} required /></label><Button size="compact" type="submit">Apply</Button></form>}
      </div>

      <nav className={s.reportNav} aria-label="Report sections"><a href="#overview">Overview</a><a href="#performance">Performance</a><a href="#inventory-position">Inventory position</a><a href="#appendix">Detail & notes</a></nav>

      <section className={s.overview} id="overview" aria-labelledby="overview-heading">
        <div className={s.sectionHeading}><div><p>Period at a glance</p><h2 id="overview-heading">Commercial overview</h2></div><span>{report.portfolio.reportingDays} London calendar days · refund-aware</span></div>
        <div className={s.metrics}>
          <Metric emphasis label="Net merchandise revenue" value={formatMoney(report.metrics.netSales)} note={report.previousMetrics ? percentageChange(report.metrics.netSales, report.previousMetrics.netSales) : "No preceding all-time comparison"} />
          <Metric label="Net units" value={report.metrics.netUnits.toLocaleString("en-GB")} note={report.previousMetrics ? percentageChange(report.metrics.netUnits, report.previousMetrics.netUnits) : "Refund-aware units"} />
          <Metric label={currentProduct ? "Average daily units" : "Paid orders"} value={currentProduct ? currentProduct.unitsPerDay.toLocaleString("en-GB", { maximumFractionDigits: 2 }) : report.metrics.orders?.toLocaleString("en-GB") ?? "Not available"} note={currentProduct ? "Across the selected period" : report.previousMetrics?.orders ? percentageChange(report.metrics.orders ?? 0, report.previousMetrics.orders) : "Cancelled orders excluded"} />
          <Metric label={currentProduct ? "Physical stock" : "Average order value"} value={currentProduct ? currentProduct.physicalStock?.toLocaleString("en-GB") ?? "Not counted" : report.metrics.averageOrderValue === null ? "Not available" : formatMoney(report.metrics.averageOrderValue)} note={currentProduct ? currentProduct.coverageNote : report.previousMetrics?.averageOrderValue ? percentageChange(report.metrics.averageOrderValue ?? 0, report.previousMetrics.averageOrderValue) : "Net merchandise revenue / paid orders"} />
        </div>
        <div className={s.readout}>
          <div><span>Products with sales</span><strong>{report.portfolio.sellingProducts} <small>of {report.portfolio.totalProducts}</small></strong><p>Physical products with positive mapped net units.</p></div>
          <div><span>Leading product</span><strong>{report.portfolio.topProduct?.title ?? "No positive revenue"}</strong><p>{report.portfolio.topProduct ? `${report.portfolio.topProduct.revenueShare.toFixed(1)}% of mapped product revenue` : "No contribution share available"}</p></div>
          <div><span>Unmapped sales</span><strong>{report.unmappedSales.netUnits.toLocaleString("en-GB")} units</strong><p>{formatMoney(report.unmappedSales.netRevenue)} retained in period totals.</p></div>
          <div><span>Mapped channel demand</span><strong>{report.portfolio.channelUnits.shopify.toLocaleString("en-GB")} / {report.portfolio.channelUnits.tiktok.toLocaleString("en-GB")}</strong><p>Shopify / TikTok net units.</p></div>
        </div>
      </section>

      <section className={s.section} id="performance" aria-labelledby="performance-heading">
        <div className={s.sectionHeading}><div><p>Performance</p><h2 id="performance-heading">Demand and product contribution</h2></div><span>Current period · exact values remain available below each visual</span></div>
        <div className={s.visualGrid}>
          <article className={s.visualPanel}><header><div><h3>Net units over time</h3><p>{report.trendGranularity === "bucket" ? `Grouped into ${report.trendIntervalDays}-day reporting intervals` : "Daily refund-aware mapped demand"}</p></div><strong>{report.portfolio.mappedNetUnits.toLocaleString("en-GB")}</strong></header>{report.trend.length ? <TrendChart report={report} /> : <p className={s.empty}>No mapped product demand was recorded for this selection.</p>}</article>
          <article className={s.visualPanel}><header><div><h3>{currentProduct ? "Channel contribution" : "Revenue contribution"}</h3><p>{currentProduct ? "Mapped net units by order channel" : "Top physical products by mapped net revenue"}</p></div><strong>{currentProduct ? `${channelTotal.toLocaleString("en-GB")} units` : formatMoney(report.portfolio.mappedNetRevenue)}</strong></header>{currentProduct ? <div className={s.channelSplit}><div className={s.splitBar} aria-label={`Shopify ${report.portfolio.channelUnits.shopify} units, TikTok ${report.portfolio.channelUnits.tiktok} units`}><span style={{ width: `${channelShare}%` }} /><i /></div><dl><div><dt>Shopify</dt><dd>{report.portfolio.channelUnits.shopify.toLocaleString("en-GB")} <small>{channelTotal ? `${channelShare.toFixed(1)}%` : "—"}</small></dd></div><div><dt>TikTok Shop</dt><dd>{report.portfolio.channelUnits.tiktok.toLocaleString("en-GB")} <small>{channelTotal ? `${(100 - channelShare).toFixed(1)}%` : "—"}</small></dd></div></dl></div> : <ContributionChart products={report.products} />}</article>
        </div>
        <div className={s.ledgerHeading}><div><h3>Product performance ledger</h3><p>Ranked by net units, then net merchandise revenue.</p></div><span>{report.products.length} physical product{report.products.length === 1 ? "" : "s"}</span></div>
        {report.products.length ? <ProductLedger products={report.products} /> : <p className={s.empty}>No active physical products match this report selection.</p>}
      </section>

      <section className={s.section} id="inventory-position" aria-labelledby="inventory-heading">
        <div className={s.sectionHeading}><div><p>Inventory position</p><h2 id="inventory-heading">Counted stock and channel exposure</h2></div><span>Channel-shown quantities are listing settings, not physical stock</span></div>
        <div className={s.boundaryNote}><strong>Three separate quantities</strong><p>Physical stock is what has been counted. Shopify shown and TikTok shown are the quantities currently exposed on each channel. They are intentionally not combined.</p></div>
        <div className={s.tableScroll}><table className={s.inventoryTable}><thead><tr><th>Physical product</th><th>Physical stock</th><th>Shopify shown</th><th>TikTok shown</th><th>Mapped listings</th><th>Days of cover</th></tr></thead><tbody>{report.products.map((product) => { const listingIds = new Set(product.variants.flatMap((variant) => variant.listings.map((listing) => listing.id))); return <tr key={product.id}><td>{product.title}</td><td>{product.physicalStock === null ? "Not counted" : product.physicalStock.toLocaleString("en-GB")}</td><td>{product.channelQuantities.shopify === null ? "Not fetched" : product.channelQuantities.shopify.toLocaleString("en-GB")}</td><td>{product.channelQuantities.tiktok === null ? "Not fetched" : product.channelQuantities.tiktok.toLocaleString("en-GB")}</td><td>{listingIds.size.toLocaleString("en-GB")}</td><td><strong>{product.daysOfCover === null ? "Not available" : product.daysOfCover > 3650 ? "10+ years" : `${product.daysOfCover.toLocaleString("en-GB")} days`}</strong><small>{product.coverageNote}</small></td></tr>; })}</tbody></table></div>
      </section>

      <section className={s.section} id="appendix" aria-labelledby="appendix-heading">
        <div className={s.sectionHeading}><div><p>Detail and evidence</p><h2 id="appendix-heading">Report appendix</h2></div><span>Open only the records needed for review</span></div>
        <div className={s.appendixList}>
          <details open={report.mode === "single"}><summary><span>Physical variant detail</span><strong>{report.products.reduce((total, product) => total + product.variants.length, 0)} variants</strong></summary><div className={s.appendixBody}>{report.products.map((product) => <section className={s.variantGroup} key={product.id}><h3>{product.title}</h3><div className={s.tableScroll}><table className={s.compactTable}><thead><tr><th>Variant</th><th>SKU</th><th>Physical stock</th><th>Confirmed listing relationship</th></tr></thead><tbody>{product.variants.map((variant) => <tr key={variant.id}><td>{variant.title}</td><td>{variant.sku || "Not recorded"}</td><td>{variant.quantity === null ? "Not counted" : variant.quantity.toLocaleString("en-GB")}</td><td>{variant.listings.length ? variant.listings.map((listing) => `${listing.channel === "shopify" ? "Shopify" : "TikTok"}: ${listing.title}${listing.kind === "bundle" ? ` ×${listing.quantityPerSale}` : ""}`).join(" · ") : "No confirmed component mapping"}</td></tr>)}</tbody></table></div></section>)}</div></details>
          <details><summary><span>Bundle listing composition</span><strong>{report.bundleListings.length} listings · {bundleCounts.shopify} Shopify · {bundleCounts.tiktok} TikTok</strong></summary><div className={s.appendixBody}>{report.bundleListings.length ? <div className={s.tableScroll}><table className={s.compactTable}><thead><tr><th>Channel</th><th>Bundle listing</th><th>Shown quantity</th><th>Physical components per sale</th></tr></thead><tbody>{report.bundleListings.map((listing) => <tr key={listing.id}><td>{listing.channel === "shopify" ? "Shopify" : "TikTok Shop"}</td><td>{listing.title}</td><td>{listing.channelQuantity === null ? "Not fetched" : listing.channelQuantity.toLocaleString("en-GB")}</td><td>{listing.components.map((component) => `${component.itemTitle} · ${component.variantTitle} ×${component.quantityPerSale}`).join("; ")}</td></tr>)}</tbody></table></div> : <p className={s.empty}>No confirmed bundle component mappings relate to this report selection.</p>}</div></details>
          <details><summary><span>Method and data quality</span><strong>{report.dataQuality.refundEvents + report.dataQuality.cancelledOrders} period adjustments</strong></summary><div className={s.methodBody}><p>Net merchandise revenue and net units follow the KPI workspace: cancelled orders are excluded and refunds are applied on their processed London calendar date. Bundle sales use confirmed physical-variant components. Uncertain mappings are never inferred.</p><dl><div><dt>Refund events</dt><dd>{report.dataQuality.refundEvents}</dd></div><div><dt>Refunded units</dt><dd>{report.dataQuality.refundedUnits}</dd></div><div><dt>Cancelled orders excluded</dt><dd>{report.dataQuality.cancelledOrders}</dd></div><div><dt>Uncertain listings</dt><dd>{report.dataNotes.uncertainListings}</dd></div><div><dt>Unmapped listings</dt><dd>{report.dataNotes.unmappedListings}</dd></div><div><dt>Uncounted products</dt><dd>{report.dataNotes.uncountedProducts}</dd></div></dl></div></details>
        </div>
      </section>

      <footer className={s.reportFooter}><Image src="/serenity-hue-logo-black.png" alt="" width={52} height={52} /><p>Serenity Hue Operations · Product Health Report</p><span>{periodLabel(report.range)}</span></footer>
    </article>
  </section>;
}
