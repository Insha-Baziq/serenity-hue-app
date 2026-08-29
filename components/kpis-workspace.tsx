"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3, CalendarDays, Package, PoundSterling, ShoppingBag, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatMoney, relativeTime } from "@/lib/format";
import type { KpiDashboard, KpiMetricSet, KpiPeriod } from "@/lib/kpi-dashboard";

type Props = { dashboard: KpiDashboard };
type TrendMode = "sales" | "orders";
type PeriodControl = { rangeKey: string; preset: string; start: string; end: string };

function dayCount(range: KpiPeriod) {
  return Math.floor((Date.parse(`${range.end}T00:00:00.000Z`) - Date.parse(`${range.start}T00:00:00.000Z`)) / 86_400_000) + 1;
}

function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function presetFor(range: KpiPeriod) {
  const days = dayCount(range);
  return days === 7 || days === 30 || days === 90 ? String(days) : "custom";
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" }).format(new Date(`${date}T12:00:00.000Z`));
}

function periodLabel(range: KpiPeriod) {
  const days = dayCount(range);
  return days === 1 ? "Today" : `Last ${days} days · including today`;
}

function comparison(value: number, previous: number) {
  if (!previous) return { text: "No prior activity", tone: "neutral" } as const;
  const percentage = ((value - previous) / Math.abs(previous)) * 100;
  return { text: `${percentage >= 0 ? "+" : ""}${percentage.toFixed(1)}% vs prior period`, tone: percentage >= 0 ? "up" : "down" } as const;
}

export function KpisWorkspace({ dashboard }: Props) {
  const router = useRouter();
  const dashboardRangeKey = `${dashboard.range.start}:${dashboard.range.end}`;
  const [periodControl, setPeriodControl] = useState<PeriodControl>(() => ({
    rangeKey: dashboardRangeKey,
    preset: presetFor(dashboard.range),
    start: dashboard.range.start,
    end: dashboard.range.end,
  }));
  const [trend, setTrend] = useState<TrendMode>("sales");
  const [isPending, startTransition] = useTransition();
  const controls = periodControl.rangeKey === dashboardRangeKey
    ? periodControl
    : { rangeKey: dashboardRangeKey, preset: presetFor(dashboard.range), start: dashboard.range.start, end: dashboard.range.end };
  const { preset, start, end } = controls;
  const invalidCustomRange = !start || !end || Date.parse(`${end}T00:00:00.000Z`) < Date.parse(`${start}T00:00:00.000Z`) || dayCount({ start, end }) > 365;
  const hasUnassigned = dashboard.unassigned.netUnits !== 0 || dashboard.unassigned.netRevenue !== 0;

  function setRange(next: KpiPeriod) {
    startTransition(() => router.push(`/kpis?start=${next.start}&end=${next.end}`));
  }

  function choosePreset(value: string) {
    setPeriodControl({ ...controls, preset: value });
    if (value === "custom") return;
    const count = Number(value);
    setRange({ start: shiftDate(dashboard.range.end, -(count - 1)), end: dashboard.range.end });
  }

  function applyCustomRange() {
    if (invalidCustomRange) return;
    setPeriodControl({ ...controls, preset: "custom" });
    setRange({ start, end });
  }

  const metricCards: Array<{ label: string; value: string; metric: keyof KpiMetricSet; icon: typeof PoundSterling; note: string }> = [
    { label: "Net sales", value: formatMoney(dashboard.metrics.netSales), metric: "netSales", icon: PoundSterling, note: "Merchandise only; excludes VAT and delivery" },
    { label: "Orders", value: dashboard.metrics.orders.toLocaleString("en-GB"), metric: "orders", icon: ShoppingBag, note: "Paid, non-cancelled orders" },
    { label: "AOV", value: formatMoney(dashboard.metrics.averageOrderValue), metric: "averageOrderValue", icon: TrendingUp, note: "Net merchandise sales ÷ paid orders" },
    { label: "Net units", value: dashboard.metrics.netUnits.toLocaleString("en-GB"), metric: "netUnits", icon: Package, note: "Sold units less refunds issued in period" },
  ];

  return <section className="workspace workspace--kpis" aria-busy={isPending || undefined}>
    <header className="kpis-header">
      <div>
        <p className="workspace-kicker">Business performance</p>
        <h1>KPIs</h1>
        <p>Merchandise performance across Shopify and TikTok Shop.</p>
      </div>
      <div className="kpis-controls">
        <label className="kpis-period-control">
          <span className="sr-only">Reporting period</span>
          <CalendarDays aria-hidden="true" />
          <select value={preset} onChange={(event) => choosePreset(event.target.value)}>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="custom">Custom range</option>
          </select>
        </label>
        {preset === "custom" && <div className="kpis-custom-range">
          <label>From<input type="date" value={start} max={end} onChange={(event) => setPeriodControl({ ...controls, start: event.target.value })} /></label>
          <label>To<input type="date" value={end} min={start} onChange={(event) => setPeriodControl({ ...controls, end: event.target.value })} /></label>
          <Button size="compact" variant="outline" disabled={isPending || invalidCustomRange} onClick={applyCustomRange}>Apply</Button>
        </div>}
        <p className="kpis-freshness">{dashboard.freshness ? `Data current ${relativeTime(dashboard.freshness)}` : "Awaiting first completed source sync"}</p>
      </div>
    </header>

    <section className="kpis-metric-strip" aria-label={`Key performance indicators for ${periodLabel(dashboard.range)}`}>
      {metricCards.map(({ label, value, metric, icon: Icon, note }) => {
        const change = comparison(dashboard.metrics[metric], dashboard.previous.metrics[metric]);
        return <article className="kpis-metric" key={metric} title={note}>
          <span className="kpis-metric__icon" aria-hidden="true"><Icon size={21} strokeWidth={1.7} /></span>
          <div><span>{label}</span><strong>{value}</strong><small className={`kpis-change kpis-change--${change.tone}`}>{change.tone === "up" && "↑ "}{change.tone === "down" && "↓ "}{change.text}</small></div>
        </article>;
      })}
    </section>

    <section className="kpis-panel kpis-trend-panel" aria-labelledby="sales-trend-title">
      <header className="kpis-panel__header">
        <div><h2 id="sales-trend-title">Sales trend</h2><p>{periodLabel(dashboard.range)} · Europe/London</p></div>
        <div className="kpis-segmented" role="group" aria-label="Trend measure">
          <button type="button" className={trend === "sales" ? "is-active" : ""} aria-pressed={trend === "sales"} onClick={() => setTrend("sales")}>Net sales</button>
          <button type="button" className={trend === "orders" ? "is-active" : ""} aria-pressed={trend === "orders"} onClick={() => setTrend("orders")}>Orders</button>
        </div>
      </header>
      {dashboard.trend.some((day) => trend === "sales" ? day.netSales !== 0 : day.orders !== 0) ? <div className="kpis-chart" role="img" aria-label={`Daily ${trend === "sales" ? "net merchandise sales" : "paid orders"} trend`}><ResponsiveContainer width="100%" height="100%"><BarChart data={dashboard.trend} margin={{ top: 12, right: 8, left: -18, bottom: 0 }}><CartesianGrid vertical={false} stroke="#eadfe2" strokeDasharray="3 3" /><XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={42} tickMargin={10} tick={{ fill: "#806a74", fontSize: 10 }} tickFormatter={formatDate} /><YAxis tickLine={false} axisLine={false} width={48} allowDecimals={trend === "sales"} tick={{ fill: "#806a74", fontSize: 10 }} tickFormatter={(value) => trend === "sales" ? `£${Math.round(Number(value) / 100)}` : String(value)} /><Tooltip cursor={{ fill: "#fbf3f6" }} contentStyle={{ border: "1px solid #ddcdd3", borderRadius: 8, background: "#fffefd", boxShadow: "0 14px 35px rgba(74, 33, 57, .12)", fontSize: 11 }} labelFormatter={(value) => typeof value === "string" ? formatDate(value) : ""} formatter={(value) => [trend === "sales" ? formatMoney(Number(value)) : Number(value).toLocaleString("en-GB"), trend === "sales" ? "Net sales" : "Orders"]} /><Bar dataKey={trend === "sales" ? "netSales" : "orders"} fill="#781450" radius={[3, 3, 0, 0]} maxBarSize={22} /></BarChart></ResponsiveContainer></div> : <EmptyState text="No qualifying sales or refunds were recorded in this period." />}
    </section>

    <div className="kpis-data-grid">
      <section className="kpis-panel" aria-labelledby="top-products-title">
        <header className="kpis-panel__header"><div><h2 id="top-products-title">Top physical products</h2><p>Ranked by net units sold. Mapped source lines only.</p></div></header>
        {dashboard.products.length || hasUnassigned ? <div className="kpis-table-scroll"><table className="kpis-table"><thead><tr><th>Physical product</th><th>Net units</th><th>Net revenue</th><th>Shopify</th><th>TikTok</th></tr></thead><tbody>{dashboard.products.map((product) => <tr key={product.id}><td><strong>{product.title}</strong></td><td>{product.netUnits.toLocaleString("en-GB")}</td><td>{formatMoney(product.netRevenue)}</td><td>{product.shopifyUnits.toLocaleString("en-GB")}</td><td>{product.tiktokUnits.toLocaleString("en-GB")}</td></tr>)}{hasUnassigned && <tr className="kpis-table__unassigned"><td><strong>Unassigned source lines</strong><small>No confirmed physical-product link</small></td><td>{dashboard.unassigned.netUnits.toLocaleString("en-GB")}</td><td>{formatMoney(dashboard.unassigned.netRevenue)}</td><td>—</td><td>—</td></tr>}</tbody></table></div> : <EmptyState text="Mapped product performance appears after a confirmed physical-product link and qualifying sales." />}
      </section>
      <section className="kpis-panel" aria-labelledby="channel-performance-title">
        <header className="kpis-panel__header"><div><h2 id="channel-performance-title">Channel performance</h2><p>Merchandise sales and operational order count.</p></div></header>
        <div className="kpis-table-scroll"><table className="kpis-table kpis-channel-table"><thead><tr><th>Channel</th><th>Net sales</th><th>Orders</th><th>AOV</th><th>Unit share</th></tr></thead><tbody>{dashboard.channels.map((channel) => <tr key={channel.channel}><td><span className={`kpis-channel kpis-channel--${channel.channel}`}><BarChart3 size={15} aria-hidden="true" />{channel.channel === "shopify" ? "Shopify" : "TikTok Shop"}</span></td><td>{formatMoney(channel.netSales)}</td><td>{channel.orders.toLocaleString("en-GB")}</td><td>{formatMoney(channel.averageOrderValue)}</td><td>{dashboard.metrics.netUnits ? `${(channel.unitShare * 100).toFixed(0)}%` : "—"}<small>{channel.netUnits.toLocaleString("en-GB")} units</small></td></tr>)}<tr className="kpis-table__total"><td>Total</td><td>{formatMoney(dashboard.metrics.netSales)}</td><td>{dashboard.metrics.orders.toLocaleString("en-GB")}</td><td>{formatMoney(dashboard.metrics.averageOrderValue)}</td><td>{dashboard.metrics.netUnits ? "100%" : "—"}<small>{dashboard.metrics.netUnits.toLocaleString("en-GB")} units</small></td></tr></tbody></table></div>
      </section>
    </div>
  </section>;
}

function EmptyState({ text }: { text: string }) {
  return <div className="kpis-empty"><Package aria-hidden="true" size={19} strokeWidth={1.5} /><p>{text}</p></div>;
}
