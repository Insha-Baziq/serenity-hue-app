"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, BarChart3, CalendarDays, CircleDollarSign, Download, Eye, FileText, Megaphone, Package, Printer, ShoppingBag, ShoppingCart, Sparkles, TrendingUp, Users, Video } from "lucide-react";
import { useState, useTransition, type ElementType, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ReportAreaChart, ReportBarChart, ReportDonut, type ReportChartPoint } from "@/components/report-charts";
import { formatMoney } from "@/lib/format";
import type { KpiDashboard, KpiPeriod } from "@/lib/kpi-dashboard";
import type { TikTokAffiliateDashboard } from "@/lib/tiktok-affiliate-dashboard";
import type { TikTokAdsConnectionState } from "@/lib/repository";
import type { TikTokAdsReport } from "@/lib/tiktok-ads-reporting";
import type { TikTokAdsReportState } from "@/lib/tiktok-ads-report-store";
import s from "./reports-workspace.module.css";

export type ReportId = "product" | "customer" | "orders" | "ads" | "affiliate";

type Props = {
  dashboard: KpiDashboard;
  affiliate: TikTokAffiliateDashboard;
  adsConnection: TikTokAdsConnectionState;
  adsReportState: TikTokAdsReportState;
  ads: TikTokAdsReport;
  initialReport?: ReportId;
};

type PeriodControl = { rangeKey: string; preset: string; start: string; end: string };

const reports: Array<{ id: ReportId; label: string; shortLabel: string }> = [
  { id: "product", label: "Product performance", shortLabel: "Product" },
  { id: "customer", label: "Customer performance", shortLabel: "Customer" },
  { id: "orders", label: "Orders & sales", shortLabel: "Orders" },
  { id: "ads", label: "TikTok Ads", shortLabel: "Ads" },
  { id: "affiliate", label: "TikTok Affiliate", shortLabel: "Affiliate" },
];

const number = (value: number) => value.toLocaleString("en-GB");
const compact = (value: number) => new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 1 }).format(value);
const percent = (value: number, digits = 1) => `${(value * 100).toFixed(digits)}%`;

function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function dayCount(range: KpiPeriod) {
  return Math.floor((Date.parse(range.end) - Date.parse(range.start)) / 86_400_000) + 1;
}

function presetFor(range: KpiPeriod) {
  if (range.allTime) return "all";
  const days = dayCount(range);
  return [30, 90].includes(days) ? String(days) : "custom";
}

function formatDate(date: string, year = false) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", ...(year ? { year: "numeric" as const } : {}), timeZone: "Europe/London" }).format(new Date(`${date}T12:00:00Z`));
}

function rangeLabel(range: KpiPeriod) {
  return `${formatDate(range.start, true)} – ${formatDate(range.end, true)}`;
}

function changeAgainst(current: number, previous: number | undefined) {
  if (previous === undefined || previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

function changeLabel(change: number | null) {
  if (change === null) return "No prior comparison";
  return `${change >= 0 ? "▲" : "▼"} ${Math.abs(change * 100).toFixed(1)}% vs. previous period`;
}

function chartData(data: Array<{ date: string; value: number }>): ReportChartPoint[] {
  return data.map((point) => ({ label: point.date, value: point.value }));
}

function areaData(dashboard: KpiDashboard, metric: "netSales" | "orders") {
  return chartData(dashboard.trend.map((point) => ({ date: point.date, value: point[metric] })));
}

function affiliateAreaData(affiliate: TikTokAffiliateDashboard) {
  return chartData(affiliate.trend.map((point) => ({ date: point.date, value: point.netSales })));
}

function adsMoney(value: number | null, currency: string | null) {
  if (value === null) return "Not reported";
  return currency ? formatMoney(value, currency) : "Currency not reported";
}

function IconTile({ icon: Icon }: { icon: ElementType }) {
  return <span className={s.iconTile}><Icon size={18} strokeWidth={1.7} aria-hidden="true" /></span>;
}

function MetricCard({ icon, label, value, note, change }: { icon: ElementType; label: string; value: string; note?: string; change?: string }) {
  return <article className={s.metricCard}><div className={s.metricTop}><IconTile icon={icon} /><span className={s.metricLabel}>{label}</span></div><strong className={s.metricValue}>{value}</strong>{change && <span className={s.metricDelta}>{change}</span>}{note && <small className={s.metricNote}>{note}</small>}</article>;
}

function Panel({ title, subtitle, children, className = "", action }: { title: string; subtitle?: string; children: ReactNode; className?: string; action?: ReactNode }) {
  return <section className={`${s.panel} ${className}`}><header className={s.panelHeader}><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</header>{children}</section>;
}

function PanelEmpty({ message }: { message: string }) {
  return <div className={s.panelEmpty}><BarChart3 size={23} strokeWidth={1.3} aria-hidden="true" /><span>{message}</span></div>;
}

function ReportHeader({ title, eyebrow: _eyebrow, range, freshness: _freshness, note, periodNote }: { title: string; eyebrow: string; range: KpiPeriod; freshness?: string | null; note: string; periodNote: string }) {
  void _eyebrow;
  void _freshness;
  const shortTitle = title.replace(/^Serenity Hue\s+/, "");
  return <header className={s.reportHeader}>
    <div className={s.reportBrandRow}>
      <div className={s.logoSlot}>
        <span className={s.logoFrame}><Image src="/serenity-hue-logo-black.png" alt="Serenity Hue by Shabina" fill sizes="104px" priority /></span>
      </div>
      <span className={s.brandCopy}>Skincare that<br />brings out a calmer,<br />brighter you.</span>
      <div className={s.mantra}>Beauty<br /><em>in Balance</em></div>
      <div className={s.periodBlock}><span>Report period</span><strong>{range.allTime ? "All recorded activity" : rangeLabel(range)}</strong><small>{periodNote}</small></div>
    </div>
    <div className={s.reportTitleRow}>
      <h1>Serenity Hue<br />{shortTitle}</h1>
      <p>{note}</p>
    </div>
  </header>;
}

function ReportFooter({ range }: { range: KpiPeriod }) {
  return <footer className={s.reportFooter}><div className={s.closingLockup}><strong>More Beauty<br /><em>Ahead</em></strong><span>Same kinder<br />brighter you.</span></div><div>Serenity Hue by Shabina</div><div>Beauty drives a brighter tomorrow</div><div>{range.allTime ? "All recorded activity" : rangeLabel(range)}</div></footer>;
}

function ProductReport({ dashboard }: { dashboard: KpiDashboard }) {
  const products = (dashboard.allProducts ?? dashboard.products).filter((product) => product.netUnits !== 0 || product.netRevenue !== 0).slice(0, 7);
  const topProduct = products[0];
  const channelData = dashboard.channels.map((channel) => ({ name: channel.channel === "shopify" ? "Shopify" : "TikTok Shop", value: channel.netSales }));
  const coverage = dashboard.restock.slice(0, 6).map((item) => ({ label: `${item.productTitle} · ${item.variantTitle}`, value: item.countedStock, secondary: Math.round(item.dailyDemand * 7) }));
  const trend = topProduct && dashboard.productTrends?.[topProduct.id] ? chartData(dashboard.productTrends[topProduct.id]!.map((point) => ({ date: point.date, value: point.netRevenue }))) : areaData(dashboard, "netSales");
  return <>
    <ReportHeader title="Serenity Hue Product Performance Report" eyebrow="Product performance · product growth" range={dashboard.range} freshness={dashboard.freshness} note="Sales insights · product growth · a more radiant tomorrow" periodNote="Beauty drives a brighter tomorrow" />
    <div className={`${s.kpiGrid} ${s.kpiGridFour}`}>
      <MetricCard icon={ShoppingBag} label="Net product sales" value={formatMoney(dashboard.metrics.netSales)} change={changeLabel(changeAgainst(dashboard.metrics.netSales, dashboard.previous?.metrics.netSales))} />
      <MetricCard icon={Package} label="Net units sold" value={number(dashboard.metrics.netUnits)} change={changeLabel(changeAgainst(dashboard.metrics.netUnits, dashboard.previous?.metrics.netUnits))} />
      <MetricCard icon={TrendingUp} label="Revenue per unit" value={dashboard.metrics.netUnits ? formatMoney(Math.round(dashboard.metrics.netSales / dashboard.metrics.netUnits)) : "Not available"} note="Net sales divided by net units" />
      <MetricCard icon={FileText} label="Products with activity" value={number(products.length)} note={`${number(dashboard.unassigned.netUnits)} units remain unmapped`} />
    </div>
    <div className={s.reportGrid}>
      <Panel title="Top-Selling Products" subtitle="By units sold" className={s.spanFive}><ReportBarChart data={products.slice(0, 5).map((product) => ({ label: product.title, value: product.netUnits }))} /></Panel>
      <Panel title="Product Revenue Ranking" subtitle="By net sales" className={s.spanFour}><ReportBarChart data={products.slice(0, 5).map((product) => ({ label: product.title, value: product.netRevenue }))} money colour="#c13a9b" /></Panel>
      <Panel title="Channel Contribution" subtitle="By net sales" className={s.spanThree}><ReportDonut data={channelData} centre={formatMoney(dashboard.metrics.netSales)} /></Panel>
      <Panel title="Product Sales Trend" subtitle="Monthly net sales" className={s.spanSeven}><ReportAreaChart data={trend} money /></Panel>
      <Panel title="Variant Performance" subtitle="Sell-through rate by variant" className={s.spanFive}><PanelEmpty message="Variant sell-through is not returned by the reporting source yet." /></Panel>
      <Panel title="Stock Coverage" subtitle="Counted variants · reorder signal" className={s.spanFive}><ReportBarChart data={coverage.map((item) => ({ label: item.label, value: item.value, secondary: item.secondary }))} colour="#437d67" secondaryColour="#d8781b" /></Panel>
      <Panel title="Physical vs Channel Stock" subtitle="Units" className={s.spanFour}><PanelEmpty message="Physical and allocated channel stock are not available in this report source." /></Panel>
      <Panel title="Attention Notes" subtitle="Visible data boundaries" className={s.spanThree}><div className={s.noteList}><p><strong>Unmapped product lines</strong> {number(dashboard.unassigned.netUnits)} units remain outside product rows.</p><p><strong>Restock runway</strong> appears only for counted variants with a stored demand signal.</p></div></Panel>
    </div>
    <ReportFooter range={dashboard.range} />
  </>;
}

function CustomerReport({ dashboard }: { dashboard: KpiDashboard }) {
  const { summary, topCustomers } = dashboard.customers;
  const channelData = dashboard.channels.map((channel) => ({ name: channel.channel === "shopify" ? "Shopify orders" : "TikTok orders", value: channel.orders }));
  return <>
    <ReportHeader title="Serenity Hue Customer Performance Report" eyebrow="Customers · lasting relationships" range={dashboard.range} freshness={dashboard.freshness} note="Real customers · lasting relationships · a more radiant tomorrow" periodNote="Beauty builds brighter connections" />
    <div className={`${s.kpiGrid} ${s.kpiGridFive}`}>
      <MetricCard icon={Users} label="Total active customers" value={number(summary.total)} change={changeLabel(changeAgainst(summary.total, undefined))} />
      <MetricCard icon={Users} label="New customers" value={number(summary.new)} note="One recorded order" />
      <MetricCard icon={TrendingUp} label="Repeat customers" value={number(summary.repeat)} note="More than one recorded order" />
      <MetricCard icon={CircleDollarSign} label="Top customer net spend" value={topCustomers[0] ? formatMoney(topCustomers[0].netSpend) : "Not available"} note="Highest ranked customer in the available sample" />
      <MetricCard icon={ShoppingBag} label="Average order value" value={formatMoney(dashboard.metrics.averageOrderValue)} change={changeLabel(changeAgainst(dashboard.metrics.averageOrderValue, dashboard.previous?.metrics.averageOrderValue))} />
    </div>
    <div className={s.reportGrid}>
      <Panel title="New vs Repeat Customers" subtitle="Share of total customers" className={s.spanFour}><ReportDonut data={[{ name: "New customers", value: summary.new }, { name: "Repeat customers", value: summary.repeat }]} centre={number(summary.total)} /></Panel>
      <Panel title="Top Customers by Spend" subtitle="Total spend" className={s.spanFive}><ReportBarChart data={topCustomers.slice(0, 5).map((customer) => ({ label: customer.name, value: customer.netSpend }))} money colour="#c13a9b" /></Panel>
      <Panel title="Shopify vs TikTok Customers" subtitle="Customer-period order share" className={s.spanThree}><ReportDonut data={channelData} centre={number(dashboard.metrics.orders)} /></Panel>
      <Panel title="Customer Activity Trend" subtitle="Monthly active customer proxy" className={s.spanSeven}><ReportAreaChart data={areaData(dashboard, "orders")} /></Panel>
      <Panel title="Repeat-Customer Contribution" subtitle="Share of identified customers" className={s.spanFive}><ReportDonut data={[{ name: "Repeat customers", value: summary.repeat }, { name: "New customers", value: summary.new }]} centre={percent(summary.total ? summary.repeat / summary.total : 0)} /><p className={s.mutedNote}>Revenue and order contribution by repeat customers is not returned by the current source.</p></Panel>
      <Panel title="Customer Value Distribution" subtitle="By total spend per customer" className={s.spanFour}><PanelEmpty message="Customer spend bands are not available in this report source." /></Panel>
      <Panel title="Channel Preference" subtitle="Preferred shopping channel" className={s.spanFour}><ReportBarChart data={channelData.map((item) => ({ label: item.name.replace(" orders", ""), value: item.value }))} money={false} colour="#c13a9b" /></Panel>
      <Panel title="Customer Health Indicators" subtitle="Derived only where definitions exist" className={s.spanFour}><div className={s.noteList}><p><strong>Identity coverage</strong> {number(summary.total)} customers were identified in the selected period.</p><p><strong>Retention and VIP rates</strong> are not reported without approved definitions.</p></div></Panel>
    </div>
    <ReportFooter range={dashboard.range} />
  </>;
}

function OrdersReport({ dashboard }: { dashboard: KpiDashboard }) {
  const channelData = dashboard.channels.map((channel) => ({ label: channel.channel === "shopify" ? "Shopify" : "TikTok Shop", value: channel.orders }));
  return <>
    <ReportHeader title="Serenity Hue Orders & Sales Report" eyebrow="Orders · channels · customer love" range={dashboard.range} freshness={dashboard.freshness} note="Orders · channels · customer love · a more radiant tomorrow" periodNote="Real orders · brighter people" />
    <div className={`${s.kpiGrid} ${s.kpiGridFour}`}>
      <MetricCard icon={ShoppingBag} label="Net merchandise sales" value={formatMoney(dashboard.metrics.netSales)} change={changeLabel(changeAgainst(dashboard.metrics.netSales, dashboard.previous?.metrics.netSales))} />
      <MetricCard icon={ShoppingCart} label="Paid orders" value={number(dashboard.metrics.orders)} change={changeLabel(changeAgainst(dashboard.metrics.orders, dashboard.previous?.metrics.orders))} />
      <MetricCard icon={TrendingUp} label="Average order value" value={formatMoney(dashboard.metrics.averageOrderValue)} change={changeLabel(changeAgainst(dashboard.metrics.averageOrderValue, dashboard.previous?.metrics.averageOrderValue))} />
      <MetricCard icon={Package} label="Net units sold" value={number(dashboard.metrics.netUnits)} change={changeLabel(changeAgainst(dashboard.metrics.netUnits, dashboard.previous?.metrics.netUnits))} />
    </div>
    <div className={s.reportGrid}>
      <Panel title="Orders by Channel" subtitle="Total orders & share" className={s.spanFive}><ReportBarChart data={channelData} money={false} /></Panel>
      <Panel title="Monthly Sales Trend" subtitle="Net merchandise sales" className={s.spanSeven}><ReportAreaChart data={areaData(dashboard, "netSales")} money /></Panel>
      <Panel title="Order Status" subtitle="By number of orders" className={s.spanFour}><div className={s.statusGrid}><div><span>Recorded orders</span><strong>{number(dashboard.metrics.orders)}</strong></div><div><span>Refund events</span><strong>{number(dashboard.dataQuality?.refundEvents ?? 0)}</strong></div><div><span>Cancelled orders</span><strong>{number(dashboard.dataQuality?.cancelledOrders ?? 0)}</strong></div><div><span>Unmapped units</span><strong>{number(dashboard.unassigned.netUnits)}</strong></div></div></Panel>
      <Panel title="Refund Impact" subtitle="Net sales impact" className={s.spanFour}><div className={s.comparisonList}><div><span>Net sales</span><strong>{formatMoney(dashboard.metrics.netSales)}</strong></div><div><span>Refund events</span><strong>{number(dashboard.dataQuality?.refundEvents ?? 0)}</strong></div></div><p className={s.mutedNote}>Recorded refund events are included where the source exposes them.</p></Panel>
      <Panel title="Fulfillment Status" subtitle="Of paid orders" className={s.spanFour}><PanelEmpty message="Fulfillment statuses are not returned by the KPI report source." /></Panel>
      <Panel title="Shipment Status" subtitle="Of fulfilled orders" className={s.spanFour}><PanelEmpty message="Shipment statuses are not returned by the KPI report source." /></Panel>
      <Panel title="Order Activity Heatmap" subtitle="Orders by day & hour" className={s.spanFive}><PanelEmpty message="Hourly order activity is not available in this report source." /></Panel>
      <Panel title="Quick Comparison" subtitle="Vs. previous period" className={s.spanThree}><div className={s.comparisonList}><div><span>Orders</span><strong>{number(dashboard.metrics.orders)}</strong></div><div><span>Net sales</span><strong>{formatMoney(dashboard.metrics.netSales)}</strong></div><div><span>AOV</span><strong>{formatMoney(dashboard.metrics.averageOrderValue)}</strong></div><div><span>Units sold</span><strong>{number(dashboard.metrics.netUnits)}</strong></div></div></Panel>
    </div>
    <ReportFooter range={dashboard.range} />
  </>;
}

function AdsReport({ ads, connection, state }: { ads: TikTokAdsReport; connection: TikTokAdsConnectionState; state: TikTokAdsReportState }) {
  const currency = ads.currency;
  const trend = ads.trend.map((point) => ({ label: point.date, value: point.spendMinor, secondary: point.attributedRevenueMinor ?? undefined }));
  const campaignRows = ads.breakdowns.campaign.filter((row) => row.attributedRevenueMinor !== null).sort((left, right) => (right.attributedRevenueMinor ?? 0) - (left.attributedRevenueMinor ?? 0)).slice(0, 6);
  const hasData = ads.rowCount > 0;
  const ctr = ads.metrics.impressions && ads.metrics.clicks !== null && ads.metrics.impressions > 0 ? ads.metrics.clicks / ads.metrics.impressions : null;
  return <>
    <ReportHeader title="Serenity Hue TikTok Ads Report" eyebrow="Creative beauty · real connections" range={ads.requestedRange as KpiPeriod} freshness={state.lastSuccessfulAt} note="Creative beauty · real connections · a more radiant tomorrow" periodNote="TikTok ads drive beauty discoveries" />
    {!hasData && <div className={s.reportNotice}><Megaphone size={18} aria-hidden="true" /><span>{connection.status === "not_configured" ? "TikTok Ads is not configured." : connection.status !== "connected" ? "TikTok Ads is not connected." : state.lastErrorMessage || "No TikTok Ads rows were reported in this period."}</span></div>}
    <div className={`${s.kpiGrid} ${s.kpiGridSix}`}>
      <MetricCard icon={Megaphone} label="Ad spend" value={adsMoney(ads.metrics.spendMinor, currency)} change={hasData ? "TikTok BASIC report" : undefined} />
      <MetricCard icon={ShoppingBag} label="Attributed revenue" value={adsMoney(ads.metrics.attributedRevenueMinor, currency)} />
      <MetricCard icon={ShoppingCart} label="Attributed purchases" value={ads.metrics.attributedPurchases === null ? "Not reported" : number(ads.metrics.attributedPurchases)} />
      <MetricCard icon={TrendingUp} label="ROAS" value={ads.metrics.roas === null ? "Not reported" : `${ads.metrics.roas.toFixed(2)}×`} />
      <MetricCard icon={Eye} label="Impressions" value={ads.metrics.impressions === null ? "Not reported" : compact(ads.metrics.impressions)} />
      <MetricCard icon={TrendingUp} label="Clicks" value={ads.metrics.clicks === null ? "Not reported" : compact(ads.metrics.clicks)} />
    </div>
    <div className={s.reportGrid}>
      <Panel title="Spend vs. Attributed Revenue Trend" subtitle="Monthly TikTok Ads performance" className={s.spanSeven}><ReportAreaChart data={trend} money colour="#d88a9e" secondaryColour="#6c285f" /></Panel>
      <Panel title="Spend vs. Revenue" subtitle="Campaign performance" className={s.spanFive}><ReportAreaChart data={campaignRows.map((row) => ({ label: row.name || row.id, value: row.spendMinor ?? 0, secondary: row.attributedRevenueMinor ?? undefined }))} money /></Panel>
      <Panel title="Campaign Ranking" subtitle="By TikTok-attributed revenue" className={s.spanFour}><ReportBarChart data={campaignRows.map((row) => ({ label: row.name || row.id, value: row.attributedRevenueMinor ?? 0 }))} money colour="#c13a9b" /></Panel>
      <Panel title="Ad-Group Performance" subtitle="Spend · purchases · ROAS" className={s.spanFour}>{ads.breakdowns.adgroup.length ? <div className={s.dataTable}><div className={s.dataHead}><span>Ad group</span><span>Spend</span><span>Revenue</span><span>ROAS</span></div>{ads.breakdowns.adgroup.slice(0, 8).map((row) => <div className={s.dataRow} key={row.id}><span>{row.name || row.id}</span><span>{adsMoney(row.spendMinor, row.currency || currency)}</span><strong>{adsMoney(row.attributedRevenueMinor, row.currency || currency)}</strong><span>{row.roas === null ? "—" : `${row.roas.toFixed(2)}×`}</span></div>)}</div> : <PanelEmpty message="TikTok did not return ad-group identifiers for this report." />}</Panel>
      <Panel title="ROAS Trend" subtitle="Monthly TikTok Ads ROAS" className={s.spanFour}><ReportAreaChart data={ads.trend.map((point) => ({ label: point.date, value: point.roas ?? 0 }))} /></Panel>
      <Panel title="Impressions → Clicks → Purchases" subtitle="TikTok Ads funnel (attributed)" className={s.spanFive}><div className={s.funnel}><div><strong>{ads.metrics.impressions === null ? "—" : compact(ads.metrics.impressions)}</strong><span>Impressions</span></div><div><strong>{ads.metrics.clicks === null ? "—" : compact(ads.metrics.clicks)}</strong><span>Clicks {ctr === null ? "" : `· ${percent(ctr)}`}</span></div><div><strong>{ads.metrics.attributedPurchases === null ? "—" : number(ads.metrics.attributedPurchases)}</strong><span>Purchases</span></div></div></Panel>
      <Panel title="Campaign Efficiency Matrix" subtitle="ROAS vs. CPC" className={s.spanThree}><div className={s.dataTable}><div className={s.dataHead}><span>Campaign</span><span>Spend</span><span>ROAS</span><span>Purchases</span></div>{campaignRows.slice(0, 5).map((row) => <div className={s.dataRow} key={`eff-${row.id}`}><span>{row.name || row.id}</span><span>{adsMoney(row.spendMinor, row.currency || currency)}</span><strong>{row.roas === null ? "—" : `${row.roas.toFixed(2)}×`}</strong><span>{row.attributedPurchases === null ? "—" : number(row.attributedPurchases)}</span></div>)}</div></Panel>
    </div>
    <p className={s.definitionNote}>{ads.metricDefinition}</p>
    <ReportFooter range={ads.requestedRange as KpiPeriod} />
  </>;
}

function AffiliateReport({ affiliate }: { affiliate: TikTokAffiliateDashboard }) {
  const creators = affiliate.affiliates.slice(0, 6);
  const products = affiliate.products.slice(0, 6);
  return <>
    <ReportHeader title="Serenity Hue TikTok Affiliate Report" eyebrow="Creators · content · conversions" range={affiliate.range} freshness={affiliate.status.lastSuccessfulAt} note="Creators · content · conversions · a more radiant tomorrow" periodNote="Real creators · real beauty impact" />
    <div className={`${s.kpiGrid} ${s.kpiGridSix}`}>
      <MetricCard icon={ShoppingBag} label="Affiliate-attributed sales" value={formatMoney(affiliate.metrics.netSales)} />
      <MetricCard icon={CircleDollarSign} label="Estimated commission" value={formatMoney(affiliate.metrics.estimatedCommission)} />
      <MetricCard icon={ShoppingCart} label="Attributed orders" value={number(affiliate.metrics.attributedOrders)} />
      <MetricCard icon={Package} label="Attributed units" value={number(affiliate.metrics.units)} />
      <MetricCard icon={Users} label="Active creators" value={number(affiliate.metrics.activeAffiliates)} />
      <MetricCard icon={Video} label="Published videos" value={number(affiliate.metrics.publishedVideos)} />
    </div>
    {affiliate.status.kind !== "fresh" && <div className={s.reportNotice}><Sparkles size={18} aria-hidden="true" /><span>{affiliate.status.message}</span></div>}
    <div className={s.reportGrid}>
      <Panel title="Creator Leaderboard" subtitle="By affiliate-attributed net sales" className={s.spanFive}><ReportBarChart data={creators.map((creator) => ({ label: creator.creator, value: creator.netSales }))} money colour="#c13a9b" /></Panel>
      <Panel title="Best-Performing Affiliate Products" subtitle="By attributed net sales" className={s.spanFour}><ReportBarChart data={products.map((product) => ({ label: product.product, value: product.netSales }))} money /></Panel>
      <Panel title="Key Affiliate Metrics" subtitle="Provider-reported" className={s.spanThree}><div className={s.statusGrid}><div><span>Average order</span><strong>{affiliate.metrics.attributedOrders ? formatMoney(Math.round(affiliate.metrics.netSales / affiliate.metrics.attributedOrders)) : "—"}</strong></div><div><span>Commission rate</span><strong>{affiliate.metrics.netSales ? percent(affiliate.metrics.estimatedCommission / affiliate.metrics.netSales) : "—"}</strong></div><div><span>Unreconciled GMV</span><strong>{formatMoney(affiliate.metrics.unreconciledGmv)}</strong></div></div></Panel>
      <Panel title="Videos vs Attributed Sales" subtitle="Published videos and attributed net sales" className={s.spanSeven}><ReportAreaChart data={affiliateAreaData(affiliate)} money /></Panel>
      <Panel title="Creator Efficiency" subtitle="Attributed net sales vs. published videos" className={s.spanFive}><div className={s.dataTable}><div className={s.dataHead}><span>Creator</span><span>Net sales</span><span>Orders</span><span>Videos</span></div>{creators.map((creator) => <div className={s.dataRow} key={creator.creatorId}><span>{creator.creator}</span><strong>{formatMoney(creator.netSales)}</strong><span>{number(creator.orders)}</span><span>{number(creator.publishedVideos)}</span></div>)}</div></Panel>
      <Panel title="Product by Creator Matrix" subtitle="Affiliate-attributed net sales" className={s.spanFive}><div className={s.matrixGrid}>{creators.slice(0, 5).map((creator) => <div key={creator.creatorId} className={s.matrixRow}><span>{creator.creator}</span><span>{creator.bestSellingProduct || "Product not reported"}</span><strong>{formatMoney(creator.netSales)}</strong></div>)}</div></Panel>
      <Panel title="Affiliate Trend" subtitle="Affiliate-attributed net sales" className={s.spanFour}><ReportAreaChart data={affiliateAreaData(affiliate)} money /></Panel>
      <Panel title="Reconciled vs Unreconciled GMV" subtitle="TikTok affiliate GMV" className={s.spanThree}><ReportDonut data={[{ name: "Reconciled GMV", value: Math.max(0, affiliate.metrics.netSales - affiliate.metrics.unreconciledGmv) }, { name: "Unreconciled GMV", value: affiliate.metrics.unreconciledGmv }]} centre={formatMoney(affiliate.metrics.netSales)} /><p className={s.mutedNote}>Unreconciled GMV remains excluded from net sales.</p></Panel>
    </div>
    <ReportFooter range={affiliate.range} />
  </>;
}

export function ReportsWorkspace({ dashboard, affiliate, adsConnection, adsReportState, ads, initialReport = "product" }: Props) {
  const router = useRouter();
  const [report, setReport] = useState<ReportId>(initialReport);
  const [isPending, startTransition] = useTransition();
  const range = dashboard.range;
  const rangeKey = `${range.start}:${range.end}:${range.allTime ? "all" : "range"}`;
  const [periodControl, setPeriodControl] = useState<PeriodControl>({ rangeKey, preset: presetFor(range), start: range.start, end: range.end });
  const controls = periodControl.rangeKey === rangeKey ? periodControl : { rangeKey, preset: presetFor(range), start: range.start, end: range.end };
  const invalidRange = !controls.start || !controls.end || controls.start > controls.end;

  function rangeHref(nextRange: KpiPeriod, nextReport = report) {
    const period = nextRange.allTime ? "period=all" : `start=${nextRange.start}&end=${nextRange.end}`;
    return `/analytics/reports?report=${nextReport}&${period}`;
  }

  function setRange(nextRange: KpiPeriod) {
    startTransition(() => router.push(rangeHref(nextRange)));
  }

  function chooseReport(nextReport: ReportId) {
    setReport(nextReport);
    try { window.history.replaceState(null, "", rangeHref(range, nextReport)); } catch { /* embedded browser */ }
  }

  function choosePreset(preset: string) {
    setPeriodControl({ ...controls, preset });
    if (preset === "custom") return;
    if (preset === "all") {
      setRange({ start: range.start, end: range.end, allTime: true });
      return;
    }
    setRange({ start: shiftDate(controls.end || range.end, -(Number(preset) - 1)), end: controls.end || range.end });
  }

  function applyCustomRange() {
    if (!invalidRange) setRange({ start: controls.start, end: controls.end });
  }

  function printReport() {
    window.print();
  }

  return <section className={`workspace ${s.workspace}`} aria-busy={isPending || undefined}>
    <div className={s.toolbar}>
      <div><Link href="/analytics" className={s.backLink}><ArrowLeft size={15} aria-hidden="true" /> Back to Analytics</Link><span className={s.toolbarKicker}>Serenity Hue visual reporting</span></div>
      <div className={s.toolbarActions}><button type="button" className={s.secondaryButton} onClick={printReport}><Printer size={15} aria-hidden="true" /> Print report</button><button type="button" className={s.primaryButton} title="Opens the browser print dialog; choose Save as PDF" onClick={printReport}><Download size={15} aria-hidden="true" /> Download PDF</button></div>
    </div>
    <header className={s.workspaceHeader}><div><h1>Reporting</h1><p>Print-ready visual reports generated from the selected period.</p></div><div className={s.controls}><div className={s.rangeGroup} role="group" aria-label="Reporting period"><button type="button" className={s.rangeButton} aria-pressed={controls.preset === "30"} onClick={() => choosePreset("30")}>Last 30 days</button><button type="button" className={s.rangeButton} aria-pressed={controls.preset === "90"} onClick={() => choosePreset("90")}>Last 90 days</button><button type="button" className={s.rangeButton} aria-pressed={controls.preset === "all"} onClick={() => choosePreset("all")}>All time</button></div><button type="button" className={s.customButton} aria-expanded={controls.preset === "custom"} onClick={() => choosePreset(controls.preset === "custom" ? presetFor(range) : "custom")}><CalendarDays size={15} aria-hidden="true" /> Custom dates</button></div></header>
    {controls.preset === "custom" && <div className={s.customRange}><label>From<input type="date" value={controls.start} max={controls.end} onChange={(event) => setPeriodControl({ ...controls, start: event.target.value })} /></label><label>To<input type="date" value={controls.end} min={controls.start} onChange={(event) => setPeriodControl({ ...controls, end: event.target.value })} /></label><Button size="compact" onClick={applyCustomRange} disabled={invalidRange || isPending}>Apply dates</Button>{invalidRange && <span className={s.customRangeError}>Choose a start date on or before the end date.</span>}</div>}
    <nav className={s.reportTabs} aria-label="Report type">{reports.map((item) => <button key={item.id} type="button" className={s.reportTab} aria-pressed={report === item.id} onClick={() => chooseReport(item.id)}><FileText size={15} aria-hidden="true" />{item.shortLabel}</button>)}</nav>
    <main className={s.reportPage} aria-label={`${reports.find((item) => item.id === report)?.label ?? "Report"} report`}>
      {report === "product" && <ProductReport dashboard={dashboard} />}
      {report === "customer" && <CustomerReport dashboard={dashboard} />}
      {report === "orders" && <OrdersReport dashboard={dashboard} />}
      {report === "ads" && <AdsReport ads={ads} connection={adsConnection} state={adsReportState} />}
      {report === "affiliate" && <AffiliateReport affiliate={affiliate} />}
    </main>
  </section>;
}
