"use client";

// KPI reporting, migrated from the approved Claude Design Studio composition.
// Seven reporting tabs share one period control: Overview, Products, Channels,
// Customers, TikTok Affiliates, TikTok Ads and Restock.
//
// Every figure on this surface comes from the server-provided dashboards. Where
// a provider withholds a value the cell says so instead of substituting a zero,
// and sections whose series the reporting layer cannot produce are omitted
// rather than illustrated.
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { BarChart3, CalendarDays, ChevronDown, CircleHelp, Megaphone, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatMoney, relativeTime } from "@/lib/format";
import type { KpiDashboard, KpiPeriod, KpiRestockPlan } from "@/lib/kpi-dashboard";
import { rankTikTokAffiliates, type AffiliateRankingMode, type TikTokAffiliateDashboard } from "@/lib/tiktok-affiliate-dashboard";
import type { TikTokAdsConnectionState } from "@/lib/repository";
import type { TikTokAdsReportState } from "@/lib/tiktok-ads-report-store";
import type { TikTokAdsReport } from "@/lib/tiktok-ads-reporting";
import s from "./kpis-workspace.module.css";

export type KpiView = "overview" | "products" | "channels" | "customers" | "affiliates" | "ads" | "restock";

type Props = {
  dashboard: KpiDashboard;
  affiliateDashboard: TikTokAffiliateDashboard;
  adsConnection: TikTokAdsConnectionState;
  adsReportState: TikTokAdsReportState;
  adsReport: TikTokAdsReport;
  initialView?: KpiView;
};

type PeriodControl = { rangeKey: string; preset: string; start: string; end: string };

const CHANNEL_COLOUR: Record<"shopify" | "tiktok", string> = {
  shopify: "var(--plum-dark)",
  tiktok: "var(--plum)",
};

const number = (value: number) => value.toLocaleString("en-GB");
const percent = (value: number, digits = 1) => `${(value * 100).toFixed(digits)}%`;

function dayCount(range: KpiPeriod) {
  return Math.floor((Date.parse(range.end) - Date.parse(range.start)) / 86_400_000) + 1;
}

function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function presetFor(range: KpiPeriod) {
  if (range.allTime) return "all";
  const days = dayCount(range);
  return [7, 30, 90].includes(days) ? String(days) : "custom";
}

function formatDate(date: string, year = false) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    ...(year ? { year: "numeric" as const } : {}),
    timeZone: "Europe/London",
  }).format(new Date(`${date}T12:00:00Z`));
}

function rangeLabel(range: KpiPeriod) {
  return `${formatDate(range.start, true)} – ${formatDate(range.end, true)}`;
}

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join("") || "–";
}

/** Percentage change against the preceding period, or null when it cannot be stated. */
function changeAgainst(current: number, previous: number | undefined) {
  if (previous === undefined || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function deltaLabel(change: number | null) {
  if (change === null) return "—";
  const rounded = Math.abs(change) >= 100 ? change.toFixed(0) : change.toFixed(1);
  return `${change > 0 ? "+" : ""}${rounded}%`;
}

/** Evenly spaced polyline points for a sparkline or chart series. */
function polyline(values: number[], width: number, height: number, min: number, max: number) {
  if (values.length === 0) return "";
  const span = max - min || 1;
  if (values.length === 1) {
    const y = height - ((values[0]! - min) / span) * height;
    return `0,${y.toFixed(1)} ${width},${y.toFixed(1)}`;
  }
  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - ((value - min) / span) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function Sparkline({ values, colour }: { values: number[]; colour: string }) {
  if (values.length < 2 || values.every((value) => value === values[0])) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className={s.metricSpark} aria-hidden="true" focusable="false">
      <polyline
        points={polyline(values, 100, 26, min, max)}
        fill="none"
        stroke={colour}
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function Panel({
  title,
  subtitle,
  actions,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`${s.panel} ${className}`}>
      <header className={s.panelHeader}>
        <div className={s.panelHeading}>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {actions}
      </header>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <div className={s.empty}>
      <BarChart3 size={24} strokeWidth={1.4} aria-hidden="true" />
      <p>{children}</p>
    </div>
  );
}

function MetricCard({
  label,
  value,
  note,
  change,
  spark,
  sparkColour = "var(--line-strong)",
  muted = false,
}: {
  label: string;
  value: string;
  note: string;
  change?: number | null;
  spark?: number[];
  sparkColour?: string;
  muted?: boolean;
}) {
  const deltaClass = change === null || change === undefined ? "" : change < 0 ? s.metricDeltaDown : s.metricDeltaUp;
  return (
    <article className={s.metricCard}>
      <div className={s.metricTop}>
        <span className={s.metricLabel}>{label}</span>
        {change !== undefined && (
          <span className={`${s.metricDelta} ${deltaClass}`} title="Change against the preceding period">
            {deltaLabel(change)}
          </span>
        )}
      </div>
      <div className={`${s.metricValue} ${muted ? s.metricValueMuted : ""}`}>{value}</div>
      {spark && <Sparkline values={spark} colour={sparkColour} />}
      <p className={s.metricNote}>{note}</p>
    </article>
  );
}

function ChartDataDisclosure({ children }: { children: ReactNode }) {
  return (
    <details className={s.reportingNotes}>
      <summary>
        View chart data
        <ChevronDown size={15} aria-hidden="true" />
      </summary>
      <div>{children}</div>
    </details>
  );
}

/**
 * The design's filled timeline. The prior series is drawn only when the
 * reporting layer produced one, so an all-time view shows a single line rather
 * than an invented comparison.
 */
function TrendChart({
  title,
  subtitle,
  current,
  prior,
  labels,
  currentLegend,
  formatValue,
  actions,
  disclosure,
}: {
  title: string;
  subtitle: string;
  current: number[];
  prior?: number[];
  labels: string[];
  currentLegend: string;
  formatValue: (value: number) => string;
  actions?: ReactNode;
  disclosure?: ReactNode;
}) {
  const series = prior && prior.length ? [...current, ...prior] : current;
  const hasData = current.some((value) => value !== 0);
  const rawMin = Math.min(0, ...series);
  const rawMax = Math.max(...series, 0);
  const pad = (rawMax - rawMin || 1) * 0.08;
  const min = rawMin - pad;
  const max = rawMax + pad;
  const currentPoints = polyline(current, 720, 190, min, max);
  const priorPoints = prior && prior.length ? polyline(prior, 720, 190, min, max) : "";
  const areaPath = currentPoints ? `M${currentPoints.split(" ").join(" L")} L720,199 L0,199 Z` : "";
  const peak = hasData ? formatValue(Math.max(...current)) : "";

  return (
    <Panel
      title={title}
      subtitle={subtitle}
      className={s.chartPanel}
      actions={
        actions ?? (
          <div className={s.chartLegend}>
            <span>
              <i style={{ background: "var(--plum)" }} />
              {currentLegend}
            </span>
            {priorPoints && (
              <span>
                <i style={{ background: "var(--line-strong)" }} />
                Preceding period
              </span>
            )}
          </div>
        )
      }
    >
      {hasData ? (
        <div className={s.chartFrame}>
          <svg
            viewBox="0 0 720 210"
            preserveAspectRatio="none"
            className={s.chartSvg}
            role="img"
            aria-label={`${title}. Highest point ${peak}.`}
          >
            <line x1="0" y1="10" x2="720" y2="10" stroke="var(--canvas-muted)" strokeWidth="1" />
            <line x1="0" y1="73" x2="720" y2="73" stroke="var(--canvas-muted)" strokeWidth="1" />
            <line x1="0" y1="136" x2="720" y2="136" stroke="var(--canvas-muted)" strokeWidth="1" />
            <line x1="0" y1="199" x2="720" y2="199" stroke="var(--line)" strokeWidth="1" />
            {areaPath && <path d={areaPath} fill="var(--magenta-soft)" opacity="0.75" />}
            {priorPoints && (
              <polyline
                points={priorPoints}
                fill="none"
                stroke="var(--line-strong)"
                strokeWidth="2"
                strokeDasharray="4 4"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            )}
            <polyline
              points={currentPoints}
              fill="none"
              stroke="var(--plum)"
              strokeWidth="2.4"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          <div className={s.chartAxis}>
            {labels.map((label, index) => (
              <span key={`${label}-${index}`}>{label}</span>
            ))}
          </div>
        </div>
      ) : (
        <Empty>No activity was recorded in this period, so there is nothing to plot.</Empty>
      )}
      {disclosure && <ChartDataDisclosure>{disclosure}</ChartDataDisclosure>}
    </Panel>
  );
}

/** Six or fewer evenly spaced axis labels drawn from the real bucket dates. */
function axisLabels(points: Array<{ date: string }>) {
  if (points.length === 0) return [];
  const wanted = Math.min(6, points.length);
  const step = (points.length - 1) / Math.max(1, wanted - 1);
  return Array.from({ length: wanted }, (_, index) => formatDate(points[Math.round(index * step)]!.date));
}

function urgencyStyle(urgency: KpiRestockPlan["urgency"]) {
  return urgency === "overdue"
    ? { colour: "var(--red)", wash: "var(--red-soft)", border: "#f6d9dc", label: "Overdue" }
    : { colour: "var(--orange)", wash: "var(--orange-soft)", border: "#f3ddbe", label: "Due soon" };
}

/* ── Overview ─────────────────────────────────────────────────────────── */

function OverviewView({ dashboard, onNavigate }: { dashboard: KpiDashboard; onNavigate: (view: KpiView) => void }) {
  const { metrics, previous, trend, previousTrend, channels, products, restock, customers } = dashboard;
  const salesSeries = trend.map((point) => point.netSales);
  const orderSeries = trend.map((point) => point.orders);
  const aovSeries = trend.map((point) => (point.orders ? Math.round(point.netSales / point.orders) : 0));
  const topProducts = products.slice(0, 5);
  const maxRevenue = Math.max(1, ...topProducts.map((product) => Math.abs(product.netRevenue)));
  const urgent = restock.slice(0, 4);
  const interval = dashboard.trendIntervalDays;
  const unitsPerOrder = metrics.orders ? (metrics.netUnits / metrics.orders).toFixed(2) : "0";

  return (
    <>
      <div className={s.metricGrid}>
        <MetricCard
          label="Net sales"
          value={formatMoney(metrics.netSales)}
          note="Merchandise sales, excluding VAT and delivery, net of refunds"
          change={changeAgainst(metrics.netSales, previous?.metrics.netSales)}
          spark={salesSeries}
          sparkColour="var(--plum)"
        />
        <MetricCard
          label="Orders"
          value={number(metrics.orders)}
          note="Paid, non-cancelled orders"
          change={changeAgainst(metrics.orders, previous?.metrics.orders)}
          spark={orderSeries}
        />
        <MetricCard
          label="Average order value"
          value={formatMoney(metrics.averageOrderValue)}
          note="Net sales divided by paid orders"
          change={changeAgainst(metrics.averageOrderValue, previous?.metrics.averageOrderValue)}
          spark={aovSeries}
        />
        <MetricCard
          label="Net units"
          value={number(metrics.netUnits)}
          note={`${unitsPerOrder} units per order`}
          change={changeAgainst(metrics.netUnits, previous?.metrics.netUnits)}
        />
      </div>

      <div className={s.primaryGrid}>
        <TrendChart
          title="Net sales trend"
          subtitle={`${interval > 1 ? `${interval}-day intervals` : "Daily"} · Europe/London · excludes cancelled, net of refunds`}
          current={salesSeries}
          prior={previousTrend.map((point) => point.netSales)}
          labels={axisLabels(trend)}
          currentLegend="This period"
          formatValue={formatMoney}
          disclosure={
            <div className={s.tableScroll}>
              <table className={s.table}>
                <thead>
                  <tr>
                    <th>{interval > 1 ? "Interval begins" : "Date"}</th>
                    <th className={s.numeric}>Net sales</th>
                    <th className={s.numeric}>Orders</th>
                  </tr>
                </thead>
                <tbody>
                  {trend.map((point) => (
                    <tr key={point.date}>
                      <td>{formatDate(point.date, true)}</td>
                      <td className={s.numeric}>{formatMoney(point.netSales)}</td>
                      <td className={s.numeric}>{number(point.orders)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          }
        />

        <Panel title="Channel mix" subtitle="Unit share of net units">
          {metrics.netUnits !== 0 ? (
            <div className={s.channelList}>
              {channels.map((channel) => (
                <div key={channel.channel} className={s.channelRow}>
                  <div className={s.channelRowTop}>
                    <strong>{channel.channel === "shopify" ? "Shopify" : "TikTok Shop"}</strong>
                    <span>{percent(channel.unitShare)}</span>
                  </div>
                  <div className={s.track}>
                    <div
                      className={s.trackFill}
                      style={{
                        width: percent(Math.max(0, channel.unitShare)),
                        background: CHANNEL_COLOUR[channel.channel],
                      }}
                    />
                  </div>
                  <p className={s.channelMeta}>
                    {formatMoney(channel.netSales)} · {number(channel.orders)} orders · {formatMoney(channel.averageOrderValue)} AOV
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <Empty>No units were sold on either channel in this period.</Empty>
          )}
        </Panel>
      </div>

      <div className={s.splitGrid}>
        <Panel
          title="Top products"
          subtitle="Ranked by net revenue in this period"
          actions={
            <button type="button" className={s.linkButton} onClick={() => onNavigate("products")}>
              All products →
            </button>
          }
        >
          {topProducts.length ? (
            <div className={s.rankList}>
              {topProducts.map((product) => (
                <div key={product.id} className={s.rankRow}>
                  <span className={s.rankTitle} title={product.title}>
                    {product.title}
                  </span>
                  <span className={s.rankValue}>{formatMoney(product.netRevenue)}</span>
                  <div className={s.rankTrack}>
                    <div
                      className={`${s.rankTrackFill} ${product.netRevenue < 0 ? s.rankTrackFillNegative : ""}`}
                      style={{ width: percent(Math.abs(product.netRevenue) / maxRevenue) }}
                    />
                  </div>
                  <span className={s.rankNote}>{number(product.netUnits)} units</span>
                </div>
              ))}
            </div>
          ) : (
            <Empty>No product sold in this period, so there is nothing to rank.</Empty>
          )}
        </Panel>

        <Panel
          title="Needs reordering"
          subtitle="Physical variants whose cover runs out inside their lead time"
          actions={
            <button type="button" className={s.linkButton} onClick={() => onNavigate("restock")}>
              Restock plan →
            </button>
          }
        >
          {urgent.length ? (
            <div className={s.urgentList}>
              {urgent.map((item) => {
                const style = urgencyStyle(item.urgency);
                return (
                  <div key={item.variantId} className={s.urgentRow} style={{ borderColor: style.border, background: style.wash }}>
                    <div className={s.urgentRowCopy}>
                      <strong title={`${item.productTitle} · ${item.variantTitle}`}>
                        {item.productTitle} · {item.variantTitle}
                      </strong>
                      <span>
                        {number(item.countedStock)} on hand · {item.dailyDemand.toFixed(1)}/day
                      </span>
                    </div>
                    <div className={s.urgentRowMeta}>
                      <strong style={{ color: style.colour }}>Reorder {formatDate(item.reorderBy)}</strong>
                      <span>Stockout {formatDate(item.forecastStockout)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <Empty>
              No counted variant is forecast to run out inside its lead time. Only variants with a counted stock level, a
              recorded lead time and recent demand are planned.
            </Empty>
          )}
        </Panel>
      </div>

      <Panel title="Customers" subtitle="Buyers with a qualifying order in this period">
        <div className={s.splitList}>
          <div className={s.splitRow}>
            <span className={s.splitRowLabel}>
              <i className={s.dot} style={{ background: "var(--plum)" }} />
              New customers
            </span>
            <span className={s.splitRowValue}>
              <strong>{number(customers.summary.new)}</strong>
              <span>{customers.summary.total ? percent(customers.summary.new / customers.summary.total) : "—"}</span>
            </span>
          </div>
          <div className={s.splitRow}>
            <span className={s.splitRowLabel}>
              <i className={s.dot} style={{ background: "var(--rose)" }} />
              Repeat customers
            </span>
            <span className={s.splitRowValue}>
              <strong>{number(customers.summary.repeat)}</strong>
              <span>{customers.summary.total ? percent(customers.summary.repeat / customers.summary.total) : "—"}</span>
            </span>
          </div>
        </div>
      </Panel>
    </>
  );
}

/* ── Products ─────────────────────────────────────────────────────────── */

function ProductsView({ dashboard }: { dashboard: KpiDashboard }) {
  const { products, unassigned, metrics } = dashboard;
  const topShare = products.length && metrics.netSales ? products[0]!.netRevenue / metrics.netSales : null;
  const hasUnassigned = unassigned.netUnits !== 0 || unassigned.netRevenue !== 0;

  return (
    <>
      <div className={s.tableCard}>
        <div className={s.tableCardHeader}>
          <div>
            <h2>Product performance</h2>
            <p>{products.length ? `${number(products.length)} products with sales in this period · sorted by net units` : "Sorted by net units"}</p>
          </div>
          <dl className={s.tableTotals}>
            <div>
              <dt>Net revenue</dt>
              <dd>{formatMoney(metrics.netSales)}</dd>
            </div>
            <div>
              <dt>Net units</dt>
              <dd>{number(metrics.netUnits)}</dd>
            </div>
            <div>
              <dt>Top product share</dt>
              <dd>{topShare === null ? "—" : percent(topShare)}</dd>
            </div>
          </dl>
        </div>
        {products.length ? (
          <div className={s.tableScroll}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Product</th>
                  <th className={s.numeric}>Net units</th>
                  <th className={s.numeric}>Net revenue</th>
                  <th className={s.numeric}>Shopify units</th>
                  <th className={s.numeric}>TikTok units</th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => (
                  <tr key={product.id}>
                    <td>
                      <span className={s.cellTitle} title={product.title}>
                        {product.title}
                      </span>
                    </td>
                    <td className={s.numeric}>{number(product.netUnits)}</td>
                    <td className={`${s.numeric} ${s.strong}`}>{formatMoney(product.netRevenue)}</td>
                    <td className={`${s.numeric} ${s.muted}`}>{number(product.shopifyUnits)}</td>
                    <td className={`${s.numeric} ${s.muted}`}>{number(product.tiktokUnits)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>No product recorded a sale in this period.</Empty>
        )}
      </div>

      {hasUnassigned && (
        <p className={s.statusNotice} role="status">
          <strong>Sales without a mapped physical product.</strong> {number(unassigned.netUnits)} units worth{" "}
          {formatMoney(unassigned.netRevenue)} are counted in the totals above but cannot be attributed to a catalogue row
          until their channel listing is mapped.
        </p>
      )}
    </>
  );
}

/* ── Channels ─────────────────────────────────────────────────────────── */

function ChannelsView({ dashboard }: { dashboard: KpiDashboard }) {
  const { channels, metrics } = dashboard;
  const hasUnits = metrics.netUnits > 0;

  return (
    <>
      <div className={s.channelCardGrid}>
        {channels.map((channel) => {
          const name = channel.channel === "shopify" ? "Shopify" : "TikTok Shop";
          return (
            <article key={channel.channel} className={s.channelCard}>
              <div className={s.channelCardTop}>
                <i className={s.dot} style={{ background: CHANNEL_COLOUR[channel.channel] }} />
                {name}
              </div>
              <div className={s.channelCardValue}>{formatMoney(channel.netSales)}</div>
              <dl className={s.channelStats}>
                <div>
                  <dt>Orders</dt>
                  <dd>{number(channel.orders)}</dd>
                </div>
                <div>
                  <dt>AOV</dt>
                  <dd>{formatMoney(channel.averageOrderValue)}</dd>
                </div>
                <div>
                  <dt>Net units</dt>
                  <dd>{number(channel.netUnits)}</dd>
                </div>
                <div>
                  <dt>Unit share</dt>
                  <dd>{hasUnits ? percent(channel.unitShare) : "—"}</dd>
                </div>
              </dl>
            </article>
          );
        })}
      </div>

      <Panel title="Share of net units" subtitle="How this period's units divide across the two sales channels">
        {hasUnits ? (
          <>
            <div className={s.shareBar}>
              {channels
                .filter((channel) => channel.unitShare > 0)
                .map((channel) => (
                  <span
                    key={channel.channel}
                    style={{ width: percent(channel.unitShare), background: CHANNEL_COLOUR[channel.channel] }}
                  >
                    {channel.unitShare >= 0.08 ? percent(channel.unitShare, 0) : ""}
                  </span>
                ))}
            </div>
            <div className={s.shareLegend}>
              {channels.map((channel) => (
                <span key={channel.channel}>
                  <i className={s.swatch} style={{ background: CHANNEL_COLOUR[channel.channel] }} />
                  {channel.channel === "shopify" ? "Shopify" : "TikTok Shop"} · {number(channel.netUnits)} units
                </span>
              ))}
            </div>
          </>
        ) : (
          <Empty>No units were sold in this period, so there is no share to divide.</Empty>
        )}
        <p className={s.panelNote}>
          Shopify and TikTok Shop display stock independently by design. A difference between the two channels is a
          deliberate merchandising decision, not a reconciliation error.
        </p>
      </Panel>
    </>
  );
}

/* ── Customers ────────────────────────────────────────────────────────── */

function CustomersView({ dashboard }: { dashboard: KpiDashboard }) {
  const { customers } = dashboard;
  const { summary, topCustomers } = customers;
  const newShare = summary.total ? summary.new / summary.total : 0;
  const repeatShare = summary.total ? summary.repeat / summary.total : 0;

  return (
    <div className={s.customerGrid}>
      <Panel title="New vs repeat" subtitle="Customers with a qualifying order in this period">
        {summary.total ? (
          <>
            <div className={s.splitBar}>
              <div style={{ width: percent(newShare), background: "var(--plum)" }} />
              <div style={{ width: percent(repeatShare), background: "var(--rose)" }} />
            </div>
            <div className={s.splitList}>
              <div className={s.splitRow}>
                <span className={s.splitRowLabel}>
                  <i className={s.dot} style={{ background: "var(--plum)" }} />
                  New customers
                </span>
                <span className={s.splitRowValue}>
                  <strong>{number(summary.new)}</strong>
                  <span>{percent(newShare)}</span>
                </span>
              </div>
              <div className={s.splitRow}>
                <span className={s.splitRowLabel}>
                  <i className={s.dot} style={{ background: "var(--rose)" }} />
                  Repeat customers
                </span>
                <span className={s.splitRowValue}>
                  <strong>{number(summary.repeat)}</strong>
                  <span>{percent(repeatShare)}</span>
                </span>
              </div>
              <div className={s.splitRow}>
                <span className={s.splitRowLabel}>
                  <i className={s.dot} style={{ background: "var(--line-strong)" }} />
                  Total
                </span>
                <span className={s.splitRowValue}>
                  <strong>{number(summary.total)}</strong>
                  <span>100%</span>
                </span>
              </div>
            </div>
            <p className={s.panelNote}>
              A customer counts as repeat once more than one of their recorded orders is matched to them. Only safely
              identified customers are grouped; ambiguous contact details stay separate.
            </p>
          </>
        ) : (
          <Empty>No identified customer placed a qualifying order in this period.</Empty>
        )}
      </Panel>

      <div className={s.tableCard}>
        <div className={s.tableCardHeader}>
          <div>
            <h2>Highest net spend</h2>
            <p>Qualifying orders exclude cancelled and unpaid orders; spend is net of refunds</p>
          </div>
        </div>
        {topCustomers.length ? (
          <div className={s.tableScroll}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th className={s.numeric}>Net spend</th>
                  <th className={s.numeric}>Qual. orders</th>
                  <th className={s.numeric}>Latest purchase</th>
                </tr>
              </thead>
              <tbody>
                {topCustomers.map((customer) => {
                  const repeat = customer.qualifyingOrders > 1;
                  return (
                    <tr key={`${customer.name}-${customer.latestPurchase}-${customer.netSpend}`}>
                      <td>
                        <span className={s.customerCell}>
                          <span className={s.initials} aria-hidden="true">
                            {initialsOf(customer.name)}
                          </span>
                          <span className={s.cellTitle} title={customer.name}>
                            {customer.name}
                          </span>
                          <span className={`${s.tag} ${repeat ? s.tagRepeat : s.tagNew}`}>{repeat ? "Repeat" : "New"}</span>
                        </span>
                      </td>
                      <td className={`${s.numeric} ${s.strong}`}>{formatMoney(customer.netSpend)}</td>
                      <td className={`${s.numeric} ${s.muted}`}>{number(customer.qualifyingOrders)}</td>
                      <td className={`${s.numeric} ${s.muted}`}>{formatDate(customer.latestPurchase, true)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>No identified customer placed a qualifying order in this period.</Empty>
        )}
      </div>
    </div>
  );
}

/* ── Restock ──────────────────────────────────────────────────────────── */

function RestockView({ dashboard }: { dashboard: KpiDashboard }) {
  const { restock } = dashboard;
  const overdue = restock.filter((item) => item.urgency === "overdue");
  const dueSoon = restock.filter((item) => item.urgency === "due-soon");
  const earliest = [...restock].sort((left, right) => left.forecastStockout.localeCompare(right.forecastStockout))[0];

  return (
    <>
      <div className={s.restockSummary}>
        <article className={s.restockCard} style={{ borderColor: "#f6d9dc", background: "var(--red-soft)" }}>
          <div className={s.restockCardTop} style={{ color: "var(--red)" }}>
            <i className={s.dot} style={{ background: "var(--red)" }} />
            Reorder overdue
          </div>
          <div className={s.restockCardValue}>{number(overdue.length)}</div>
          <p className={s.restockCardNote}>The reorder date has already passed for these variants.</p>
        </article>
        <article className={s.restockCard} style={{ borderColor: "#f3ddbe", background: "var(--orange-soft)" }}>
          <div className={s.restockCardTop} style={{ color: "var(--orange)" }}>
            <i className={s.dot} style={{ background: "var(--orange)" }} />
            Due within 30 days
          </div>
          <div className={s.restockCardValue}>{number(dueSoon.length)}</div>
          <p className={s.restockCardNote}>Order these inside the next month to avoid running out.</p>
        </article>
        <article className={s.restockCard}>
          <div className={s.restockCardTop} style={{ color: "var(--ink-soft)" }}>
            <i className={s.dot} style={{ background: "var(--ink-faint)" }} />
            Earliest forecast stockout
          </div>
          <div className={s.restockCardValue}>{earliest ? formatDate(earliest.forecastStockout) : "—"}</div>
          <p className={s.restockCardNote}>
            {earliest ? `${earliest.productTitle} · ${earliest.variantTitle}` : "No variant is currently forecast to run out."}
          </p>
        </article>
      </div>

      <div className={s.tableCard}>
        <div className={s.tableCardHeader}>
          <div>
            <h2>Restock plan</h2>
            <p>Daily demand from the trailing 90 days, net of refunds · sorted by reorder date</p>
          </div>
        </div>
        {restock.length ? (
          <div className={s.tableScroll}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Variant</th>
                  <th className={s.numeric}>Counted</th>
                  <th className={s.numeric}>Daily demand</th>
                  <th className={s.numeric}>Stockout</th>
                  <th className={s.numeric}>Reorder by</th>
                  <th className={s.numeric}>Urgency</th>
                </tr>
              </thead>
              <tbody>
                {restock.map((item) => {
                  const style = urgencyStyle(item.urgency);
                  return (
                    <tr key={item.variantId}>
                      <td>
                        <span className={s.customerCell}>
                          <i className={s.rail} style={{ background: style.colour }} />
                          <span>
                            <span className={s.cellTitle} title={item.productTitle}>
                              {item.productTitle}
                            </span>
                            <span className={s.faint}>{item.variantTitle}</span>
                          </span>
                        </span>
                      </td>
                      <td className={`${s.numeric} ${s.muted}`}>{number(item.countedStock)}</td>
                      <td className={`${s.numeric} ${s.muted}`}>{item.dailyDemand.toFixed(1)}</td>
                      <td className={s.numeric}>{formatDate(item.forecastStockout, true)}</td>
                      <td className={`${s.numeric} ${s.strong}`}>{formatDate(item.reorderBy, true)}</td>
                      <td className={s.numeric}>
                        <span className={s.urgencyPill} style={{ background: style.wash, color: style.colour }}>
                          {style.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>
            No variant needs reordering inside the next 30 days. A variant is planned only when it has a counted stock
            level, a recorded lead time and at least 30 days of sales history.
          </Empty>
        )}
        <p className={s.panelNote} style={{ padding: "16px 26px" }}>
          This plan reads the counted physical catalogue. It does not change stock, place orders, or alter either
          channel&apos;s displayed quantity.
        </p>
      </div>
    </>
  );
}

/* ── TikTok affiliates ────────────────────────────────────────────────── */

function AffiliatesView({ dashboard }: { dashboard: TikTokAffiliateDashboard }) {
  const [ranking, setRanking] = useState<AffiliateRankingMode>("revenue");
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const { metrics } = dashboard;

  const ranked = rankTikTokAffiliates(dashboard.affiliates, ranking);
  const filtered = ranked.filter((affiliate) => affiliate.creator.toLowerCase().includes(search.trim().toLowerCase()));
  const rows = showAll ? filtered : filtered.slice(0, 10);
  const averageOrder = metrics.attributedOrders ? metrics.netSales / metrics.attributedOrders : 0;
  const videosPerCreator = metrics.activeAffiliates ? (metrics.publishedVideos / metrics.activeAffiliates).toFixed(1) : "0";

  return (
    <>
      {dashboard.status.kind !== "fresh" && (
        <p className={s.statusNotice} role="status">
          {dashboard.status.message}
        </p>
      )}

      <div className={s.affiliateGrid}>
        <article className={s.affiliateCard}>
          <span className={s.metricLabel}>Affiliate net sales</span>
          <div className={s.affiliateCardValue}>{formatMoney(metrics.netSales)}</div>
          <p className={s.adKpiNote}>Attributed sales from linked TikTok orders</p>
        </article>
        <article className={s.affiliateCard}>
          <span className={s.metricLabel}>Estimated commission</span>
          <div className={s.affiliateCardValue}>{formatMoney(metrics.estimatedCommission)}</div>
          <p className={s.adKpiNote}>Creator commission reported by TikTok</p>
        </article>
        <article className={s.affiliateCard}>
          <span className={s.metricLabel}>Attributed orders</span>
          <div className={s.affiliateCardValue}>{number(metrics.attributedOrders)}</div>
          <p className={s.adKpiNote}>{formatMoney(Math.round(averageOrder))} average order value</p>
        </article>
        <article className={s.affiliateCard}>
          <span className={s.metricLabel}>Active affiliates</span>
          <div className={s.affiliateCardValue}>{number(metrics.activeAffiliates)}</div>
          <p className={s.adKpiNote}>Creators with attributed sales in this period</p>
        </article>
        <article className={s.affiliateCard}>
          <span className={s.metricLabel}>Published videos</span>
          <div className={s.affiliateCardValue}>{number(metrics.publishedVideos)}</div>
          <p className={s.adKpiNote}>{videosPerCreator} videos per active creator</p>
        </article>
        <article className={`${s.affiliateCard} ${metrics.unreconciledGmv ? s.affiliateCardAttention : ""}`}>
          <span className={s.metricLabel}>Unreconciled GMV</span>
          <div className={`${s.affiliateCardValue} ${metrics.unreconciledGmv ? s.affiliateCardValueAttention : ""}`}>
            {formatMoney(metrics.unreconciledGmv)}
          </div>
          <p className={s.adKpiNote}>Affiliate sales not yet matched to an order</p>
        </article>
      </div>

      <TrendChart
        title="Affiliate sales"
        subtitle={`${dashboard.trendIntervalDays > 1 ? `${dashboard.trendIntervalDays}-day intervals` : "Daily"} · attributed, net of refunds`}
        current={dashboard.trend.map((point) => point.netSales)}
        labels={axisLabels(dashboard.trend)}
        currentLegend="Attributed net sales"
        formatValue={formatMoney}
        disclosure={
          <div className={s.tableScroll}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th className={s.numeric}>Net sales</th>
                  <th className={s.numeric}>Order lines</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.trend.map((point) => (
                  <tr key={point.date}>
                    <td>{formatDate(point.date, true)}</td>
                    <td className={s.numeric}>{formatMoney(point.netSales)}</td>
                    <td className={s.numeric}>{number(point.orders)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        }
      />

      <div className={s.tableCard}>
        <div className={s.tableCardHeader}>
          <div>
            <h2>Creator leaderboard</h2>
            <p>Active creators with attributed sales in this period</p>
          </div>
          <div className={s.adsRefresh}>
            {metrics.unreconciledGmv > 0 && (
              <span className={s.noticePill}>{formatMoney(metrics.unreconciledGmv)} GMV awaiting reconciliation</span>
            )}
            <div className={s.segmented} role="group" aria-label="Rank creators by">
              {(["revenue", "orders", "commission"] as const).map((mode) => (
                <button key={mode} type="button" aria-pressed={ranking === mode} onClick={() => setRanking(mode)}>
                  {mode === "revenue" ? "Revenue" : mode === "orders" ? "Orders" : "Commission"}
                </button>
              ))}
            </div>
            <label className={s.search}>
              <Search size={15} aria-hidden="true" />
              <input
                type="search"
                value={search}
                placeholder="Search creators"
                aria-label="Search creators"
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
          </div>
        </div>
        {rows.length ? (
          <>
            <div className={s.tableScroll}>
              <table className={s.table}>
                <thead>
                  <tr>
                    <th>Creator</th>
                    <th className={s.numeric}>Videos</th>
                    <th className={s.numeric}>Net sales</th>
                    <th className={s.numeric}>Commission</th>
                    <th className={s.numeric}>Orders</th>
                    <th className={s.numeric}>Units</th>
                    <th>Best selling product</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((affiliate) => (
                    <tr key={affiliate.creator}>
                      <td>
                        <span className={s.cellTitle} title={affiliate.creator}>
                          {affiliate.creator}
                        </span>
                      </td>
                      <td className={`${s.numeric} ${s.muted}`}>{number(affiliate.publishedVideos)}</td>
                      <td className={`${s.numeric} ${s.strong}`}>{formatMoney(affiliate.netSales)}</td>
                      <td className={`${s.numeric} ${s.muted}`}>{formatMoney(affiliate.estimatedCommission)}</td>
                      <td className={`${s.numeric} ${s.muted}`}>{number(affiliate.orders)}</td>
                      <td className={`${s.numeric} ${s.muted}`}>{number(affiliate.units)}</td>
                      <td className={s.muted}>
                        <span className={s.cellTitle}>{affiliate.bestSellingProduct ?? "—"}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filtered.length > rows.length && (
              <div style={{ padding: "16px 26px" }}>
                <Button size="compact" variant="outline" onClick={() => setShowAll(true)}>
                  Show all {number(filtered.length)} creators
                </Button>
              </div>
            )}
          </>
        ) : (
          <Empty>
            {search
              ? "No creator matches that search in this period."
              : "No creator recorded attributed sales in this period."}
          </Empty>
        )}
      </div>

      {dashboard.products.length > 0 && (
        <div className={s.tableCard}>
          <div className={s.tableCardHeader}>
            <div>
              <h2>Products sold by affiliates</h2>
              <p>Attributed product performance, net of refunds</p>
            </div>
          </div>
          <div className={s.tableScroll}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Product</th>
                  <th className={s.numeric}>Net sales</th>
                  <th className={s.numeric}>Units</th>
                  <th className={s.numeric}>Orders</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.products.map((product) => (
                  <tr key={product.product}>
                    <td>
                      <span className={s.cellTitle} title={product.product}>
                        {product.product}
                      </span>
                    </td>
                    <td className={`${s.numeric} ${s.strong}`}>{formatMoney(product.netSales)}</td>
                    <td className={`${s.numeric} ${s.muted}`}>{number(product.units)}</td>
                    <td className={`${s.numeric} ${s.muted}`}>{number(product.orders)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <details className={s.reportingNotes}>
        <summary>
          <CircleHelp size={15} aria-hidden="true" />
          About this affiliate report
          <ChevronDown size={15} aria-hidden="true" />
        </summary>
        <div>
          <p>{dashboard.historyNote}</p>
          <p>
            Affiliate figures come from TikTok&apos;s affiliate reporting and are attributed to the creator TikTok names.
            They overlap with, and are not added to, the TikTok Shop totals on the other tabs.
          </p>
        </div>
      </details>
    </>
  );
}

/* ── TikTok ads ───────────────────────────────────────────────────────── */

function AdsRefreshButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function refresh() {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/tiktok-ads/refresh", { method: "POST" });
      const body = (await response.json()) as { message?: string };
      setMessage(body.message ?? (response.ok ? "TikTok Ads report refreshed." : "TikTok Ads report could not be refreshed."));
      if (response.ok) router.refresh();
    } catch {
      setMessage("TikTok Ads report could not be refreshed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={s.adsRefresh}>
      <Button size="compact" onClick={refresh} disabled={pending}>
        {pending ? "Refreshing…" : "Refresh report"}
      </Button>
      {message && <span className={s.adsRefreshMessage}>{message}</span>}
    </div>
  );
}

function adsMoney(value: number | null, currency: string | null, hasRows: boolean) {
  if (value === null) return hasRows ? "Not supplied" : "—";
  return currency ? formatMoney(value, currency) : "Mixed currencies";
}

function adsCount(value: number | null, hasRows: boolean) {
  return value === null ? (hasRows ? "Not supplied" : "—") : number(value);
}

function roasColour(roas: number | null) {
  if (roas === null) return "var(--ink-faint)";
  if (roas >= 4) return "var(--green)";
  if (roas >= 3) return "var(--orange)";
  return "var(--red)";
}

type AdsLevel = "advertiser" | "campaign" | "adgroup" | "ad" | "product";

function AdsView({
  connection,
  state,
  report,
}: {
  connection: TikTokAdsConnectionState;
  state: TikTokAdsReportState;
  report: TikTokAdsReport;
}) {
  const [level, setLevel] = useState<AdsLevel>("campaign");

  if (connection.status !== "connected") {
    const copy =
      connection.status === "reconnect_required"
        ? {
            title: "TikTok Ads needs to be reconnected",
            detail: "The saved authorization is no longer active. Reconnect to resume official ad reporting.",
          }
        : connection.status === "not_configured"
          ? {
              title: "TikTok Ads is not configured",
              detail: "Add the server-side Ads app credentials and advertiser ID before connecting this tab.",
            }
          : {
              title: "Connect TikTok Ads",
              detail: "Authorize the selected advertiser so this tab can report official TikTok ad performance.",
            };
    return (
      <div className={s.adsState}>
        <div className={s.adsStateIcon}>
          <Megaphone size={25} strokeWidth={1.5} aria-hidden="true" />
        </div>
        <div>
          <h2>{copy.title}</h2>
          <p>{copy.detail}</p>
          <p className={s.adsTrustNote}>
            Revenue and purchases appear only when TikTok attributes them to an ad. They are not joined to Shopify or
            ordinary TikTok Shop orders.
          </p>
        </div>
        {connection.status !== "not_configured" && (
          <Link className={s.actionLink} href="/api/tiktok-ads/authorize">
            {connection.status === "reconnect_required" ? "Reconnect TikTok Ads" : "Connect TikTok Ads"}
          </Link>
        )}
      </div>
    );
  }

  const hasRows = report.rowCount > 0;
  const { metrics } = report;
  const cpm = metrics.impressions && metrics.spendMinor !== null ? (metrics.spendMinor / metrics.impressions) * 1000 : null;
  const cpc = metrics.clicks && metrics.spendMinor !== null ? metrics.spendMinor / metrics.clicks : null;
  const ctr = metrics.clicks !== null && metrics.impressions ? metrics.clicks / metrics.impressions : null;
  const costPerPurchase =
    metrics.attributedPurchases && metrics.spendMinor !== null ? metrics.spendMinor / metrics.attributedPurchases : null;

  const advertiserRow = {
    id: report.advertiserId ?? "advertiser",
    name: report.advertiserName ?? "TikTok Ads account",
    spendMinor: metrics.spendMinor,
    attributedRevenueMinor: metrics.attributedRevenueMinor,
    attributedPurchases: metrics.attributedPurchases,
    impressions: metrics.impressions,
    roas: metrics.roas,
  };

  const breakdownRows =
    level === "advertiser"
      ? hasRows
        ? [advertiserRow]
        : []
      : level === "product"
        ? report.productAttribution.rows.map((row) => ({
            id: row.productId,
            name: row.productName ?? row.productId,
            spendMinor: row.spendMinor,
            attributedRevenueMinor: row.attributedRevenueMinor,
            attributedPurchases: row.attributedPurchases,
            impressions: null as number | null,
            roas:
              row.spendMinor && row.attributedRevenueMinor !== null ? row.attributedRevenueMinor / row.spendMinor : null,
          }))
        : report.breakdowns[level].map((row) => ({
            id: row.id,
            name: row.name ?? row.id,
            spendMinor: row.spendMinor,
            attributedRevenueMinor: row.attributedRevenueMinor,
            attributedPurchases: row.attributedPurchases,
            impressions: null as number | null,
            roas: row.roas,
          }));

  const levelLabels: Record<AdsLevel, string> = {
    advertiser: "Advertiser",
    campaign: "Campaign",
    adgroup: "Ad group",
    ad: "Ad",
    product: "Product",
  };

  const statusNotice =
    state.status === "failed" ? (
      <p className={s.statusNotice} role="alert">
        The latest report could not be refreshed. Existing results remain unchanged. Try refreshing again.
      </p>
    ) : state.status === "first_run" ? (
      <p className={s.statusNotice} role="status">
        Ads reporting is connected. Refresh to load results for this period.
      </p>
    ) : !hasRows ? (
      <p className={s.statusNotice} role="status">
        <strong>No ad activity in this period.</strong> TikTok returned no ad results for{" "}
        {rangeLabel(report.requestedRange)}.
      </p>
    ) : state.status === "stale" ? (
      <p className={s.statusNotice} role="status">
        The latest refresh is still being retried. Showing the last successful results.
      </p>
    ) : state.status === "partial" ? (
      <p className={s.statusNotice} role="status">
        Some detail rows were unavailable in the latest refresh. Account totals remain available.
      </p>
    ) : null;

  return (
    <>
      <div className={s.adsAccountBar}>
        <div className={s.adsAccountInfo}>
          <strong>{report.advertiserName ?? "TikTok Ads account"}</strong>
          <span>
            {hasRows && report.effectiveRange ? rangeLabel(report.effectiveRange) : "Awaiting reported results"}
            {report.attributionWindow ? ` · ${report.attributionWindow}` : ""}
          </span>
        </div>
        <AdsRefreshButton />
      </div>

      {statusNotice}

      <div className={s.adsGrid}>
        <div className={s.roasCard}>
          <div>
            <div className={s.roasLabel}>Return on ad spend</div>
            <div className={`${s.roasValue} ${metrics.roas === null ? s.roasValueUnavailable : ""}`}>
              {metrics.roas === null ? (hasRows ? "Not supplied" : "—") : `${metrics.roas.toFixed(2)}×`}
            </div>
          </div>
          <div className={s.roasRows}>
            <div className={s.roasRow}>
              <span>Spend</span>
              <strong>{adsMoney(metrics.spendMinor, report.currency, hasRows)}</strong>
            </div>
            <div className={s.roasRow}>
              <span>Attributed revenue</span>
              <strong>{adsMoney(metrics.attributedRevenueMinor, report.currency, hasRows)}</strong>
            </div>
            <div className={s.roasRow}>
              <span>Attributed purchases</span>
              <strong>{adsCount(metrics.attributedPurchases, hasRows)}</strong>
            </div>
          </div>
        </div>

        <div className={s.adKpiGrid}>
          <article className={s.adKpiCard}>
            <span className={s.metricLabel}>Ad spend</span>
            <div className={s.adKpiValue}>{adsMoney(metrics.spendMinor, report.currency, hasRows)}</div>
            <p className={s.adKpiNote}>Spend reported for ads in this period</p>
          </article>
          <article className={s.adKpiCard}>
            <span className={s.metricLabel}>Attributed revenue</span>
            <div className={s.adKpiValue}>{adsMoney(metrics.attributedRevenueMinor, report.currency, hasRows)}</div>
            <p className={s.adKpiNote}>Shopping value TikTok attributes to these ads</p>
          </article>
          <article className={s.adKpiCard}>
            <span className={s.metricLabel}>Attributed purchases</span>
            <div className={s.adKpiValue}>{adsCount(metrics.attributedPurchases, hasRows)}</div>
            <p className={s.adKpiNote}>
              {costPerPurchase === null ? "Cost per purchase not available" : `${adsMoney(Math.round(costPerPurchase), report.currency, hasRows)} per purchase`}
            </p>
          </article>
          <article className={s.adKpiCard}>
            <span className={s.metricLabel}>Impressions</span>
            <div className={s.adKpiValue}>{adsCount(metrics.impressions, hasRows)}</div>
            <p className={s.adKpiNote}>
              {cpm === null ? "CPM not available" : `${adsMoney(Math.round(cpm), report.currency, hasRows)} CPM`}
            </p>
          </article>
          <article className={s.adKpiCard}>
            <span className={s.metricLabel}>Clicks</span>
            <div className={s.adKpiValue}>{adsCount(metrics.clicks, hasRows)}</div>
            <p className={s.adKpiNote}>
              {ctr === null ? "CTR not available" : `${percent(ctr, 2)} CTR`}
              {cpc === null ? "" : ` · ${adsMoney(Math.round(cpc), report.currency, hasRows)} CPC`}
            </p>
          </article>
        </div>
      </div>

      <TrendChart
        title="Ad performance over time"
        subtitle="Daily ad spend reported by TikTok"
        current={report.trend.map((point) => point.spendMinor)}
        labels={axisLabels(report.trend)}
        currentLegend="Ad spend"
        formatValue={(value) => adsMoney(value, report.currency, hasRows)}
        disclosure={
          <div className={s.tableScroll}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th className={s.numeric}>Ad spend</th>
                  <th className={s.numeric}>Attributed revenue</th>
                  <th className={s.numeric}>Purchases</th>
                  <th className={s.numeric}>ROAS</th>
                </tr>
              </thead>
              <tbody>
                {report.trend.map((point) => (
                  <tr key={point.date}>
                    <td>{formatDate(point.date, true)}</td>
                    <td className={s.numeric}>{adsMoney(point.spendMinor, report.currency, hasRows)}</td>
                    <td className={s.numeric}>{adsMoney(point.attributedRevenueMinor, report.currency, hasRows)}</td>
                    <td className={s.numeric}>{adsCount(point.attributedPurchases, hasRows)}</td>
                    <td className={s.numeric}>{point.roas === null ? "—" : `${point.roas.toFixed(2)}×`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        }
      />

      <div className={s.tableCard}>
        <div className={s.tableCardHeader}>
          <div>
            <h2>Breakdown</h2>
            <p>Compare the advertiser total against campaigns, ad groups, ads and products</p>
          </div>
          <div className={s.segmented} role="group" aria-label="Breakdown level">
            {(["advertiser", "campaign", "adgroup", "ad", "product"] as const).map((option) => (
              <button key={option} type="button" aria-pressed={level === option} onClick={() => setLevel(option)}>
                {levelLabels[option]}
              </button>
            ))}
          </div>
        </div>
        {level === "product" && report.productAttribution.status !== "available" ? (
          <Empty>{report.productAttribution.reason}</Empty>
        ) : breakdownRows.length ? (
          <div className={s.tableScroll}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>{levelLabels[level]}</th>
                  <th className={s.numeric}>Spend</th>
                  <th className={s.numeric}>Attr. revenue</th>
                  <th className={s.numeric}>Purchases</th>
                  <th className={s.numeric}>Impressions</th>
                  <th className={s.numeric}>ROAS</th>
                </tr>
              </thead>
              <tbody>
                {breakdownRows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <span className={s.cellTitle} title={row.name}>
                        {row.name}
                      </span>
                    </td>
                    <td className={`${s.numeric} ${s.muted}`}>{adsMoney(row.spendMinor, report.currency, hasRows)}</td>
                    <td className={`${s.numeric} ${s.strong}`}>
                      {adsMoney(row.attributedRevenueMinor, report.currency, hasRows)}
                    </td>
                    <td className={`${s.numeric} ${s.muted}`}>{adsCount(row.attributedPurchases, hasRows)}</td>
                    <td className={`${s.numeric} ${s.muted}`}>
                      {row.impressions === null ? "—" : number(row.impressions)}
                    </td>
                    <td className={s.numeric} style={{ color: roasColour(row.roas), fontWeight: 700 }}>
                      {row.roas === null ? "—" : `${row.roas.toFixed(2)}×`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>TikTok returned no rows at this level for the selected period.</Empty>
        )}
        <p className={s.panelNote} style={{ padding: "16px 26px" }}>
          {report.metricDefinition}
        </p>
      </div>
    </>
  );
}

/* ── Workspace ────────────────────────────────────────────────────────── */

const TABS: Array<{ id: KpiView; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "products", label: "Products" },
  { id: "channels", label: "Channels" },
  { id: "customers", label: "Customers" },
  { id: "affiliates", label: "TikTok Affiliates" },
  { id: "ads", label: "TikTok Ads" },
  { id: "restock", label: "Restock" },
];

export function KpisWorkspace({
  dashboard,
  affiliateDashboard,
  adsConnection,
  adsReportState,
  adsReport,
  initialView = "overview",
}: Props) {
  const router = useRouter();
  const rangeKey = `${dashboard.range.start}:${dashboard.range.end}:${dashboard.range.allTime ? "all" : "range"}`;
  const [periodControl, setPeriodControl] = useState<PeriodControl>({
    rangeKey,
    preset: presetFor(dashboard.range),
    start: dashboard.range.start,
    end: dashboard.range.end,
  });
  const [view, setView] = useState<KpiView>(initialView);
  const [isPending, startTransition] = useTransition();

  // Re-sync the control when the server hands back a different range than the
  // one this control last staged, without an effect.
  const controls =
    periodControl.rangeKey === rangeKey
      ? periodControl
      : { rangeKey, preset: presetFor(dashboard.range), start: dashboard.range.start, end: dashboard.range.end };
  const invalidRange = !controls.start || !controls.end || controls.start > controls.end;

  const freshness =
    view === "affiliates"
      ? affiliateDashboard.status.lastSuccessfulAt
      : view === "ads"
        ? adsReportState.lastSuccessfulAt
        : dashboard.freshness;
  const freshnessLabel =
    view === "ads" && adsConnection.status !== "connected"
      ? adsConnection.status === "not_configured"
        ? "Ads not configured"
        : "Ads not connected"
      : freshness
        ? `updated ${relativeTime(freshness)}`
        : "awaiting first sync";

  const periodSentence = [
    dashboard.range.allTime ? "All recorded activity" : rangeLabel(dashboard.range),
    dashboard.previous ? "compared with the preceding period" : null,
    freshnessLabel,
  ]
    .filter(Boolean)
    .join(" · ");

  const overdueCount = dashboard.restock.filter((item) => item.urgency === "overdue").length;

  function rangeHref(range: KpiPeriod, nextView: KpiView) {
    const period = range.allTime ? "period=all" : `start=${range.start}&end=${range.end}`;
    return `/kpis?view=${nextView}&${period}`;
  }

  function setRange(range: KpiPeriod) {
    startTransition(() => router.push(rangeHref(range, view)));
  }

  function chooseView(next: KpiView) {
    setView(next);
    // Keep the address bar in step without paying for a server round trip.
    try {
      window.history.replaceState(null, "", rangeHref(dashboard.range, next));
    } catch {
      /* history is unavailable in some embedded contexts; the tab still works */
    }
  }

  function choosePreset(preset: string) {
    setPeriodControl({ ...controls, preset });
    if (preset === "custom") return;
    if (preset === "all") {
      setRange({ start: dashboard.range.start, end: dashboard.range.end, allTime: true });
      return;
    }
    const end = controls.end || dashboard.range.end;
    setRange({ start: shiftDate(end, -(Number(preset) - 1)), end });
  }

  function applyCustomRange() {
    if (invalidRange) return;
    setRange({ start: controls.start, end: controls.end });
  }

  return (
    <section className={`workspace ${s.workspace}`} aria-busy={isPending || undefined}>
      <header className={s.header}>
        <div className={s.headerCopy}>
          <span className={s.kicker}>Operations</span>
          <h1>Performance</h1>
          <p className={s.periodSentence}>{periodSentence}</p>
        </div>
        <div className={s.controls}>
          <div className={s.rangeGroup} role="group" aria-label="Reporting period">
            {[
              { value: "7", label: "7 days" },
              { value: "30", label: "30 days" },
              { value: "90", label: "90 days" },
              { value: "all", label: "All time" },
            ].map((option) => (
              <button
                key={option.value}
                type="button"
                className={s.rangeButton}
                aria-pressed={controls.preset === option.value}
                onClick={() => choosePreset(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={s.customButton}
            aria-expanded={controls.preset === "custom"}
            onClick={() => choosePreset(controls.preset === "custom" ? presetFor(dashboard.range) : "custom")}
          >
            <CalendarDays size={15} aria-hidden="true" />
            Custom dates
          </button>
        </div>
      </header>

      {controls.preset === "custom" && (
        <div className={s.customRange}>
          <label>
            From
            <input
              type="date"
              value={controls.start}
              max={controls.end}
              onChange={(event) => setPeriodControl({ ...controls, start: event.target.value })}
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={controls.end}
              min={controls.start}
              onChange={(event) => setPeriodControl({ ...controls, end: event.target.value })}
            />
          </label>
          <Button size="compact" onClick={applyCustomRange} disabled={invalidRange || isPending}>
            Apply dates
          </Button>
          {invalidRange && <span className={s.customRangeError}>Choose a start date on or before the end date.</span>}
        </div>
      )}

      <div className={s.tabs} role="tablist" aria-label="KPI reporting view">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`kpi-tab-${tab.id}`}
            aria-selected={view === tab.id}
            aria-controls="kpi-panel"
            tabIndex={view === tab.id ? 0 : -1}
            className={s.tab}
            onClick={() => chooseView(tab.id)}
            onKeyDown={(event) => {
              const index = TABS.findIndex((entry) => entry.id === view);
              if (event.key === "ArrowRight") chooseView(TABS[(index + 1) % TABS.length]!.id);
              else if (event.key === "ArrowLeft") chooseView(TABS[(index - 1 + TABS.length) % TABS.length]!.id);
              else if (event.key === "Home") chooseView(TABS[0]!.id);
              else if (event.key === "End") chooseView(TABS[TABS.length - 1]!.id);
              else return;
              event.preventDefault();
            }}
          >
            {tab.label}
            {tab.id === "restock" && overdueCount > 0 && (
              <span className={s.tabBadge} aria-label={`${overdueCount} overdue`}>
                {overdueCount}
              </span>
            )}
          </button>
        ))}
      </div>

      <div
        id="kpi-panel"
        role="tabpanel"
        aria-labelledby={`kpi-tab-${view}`}
        tabIndex={-1}
        className={`${s.content} ${isPending ? s.pending : ""}`}
      >
        {view === "overview" && <OverviewView dashboard={dashboard} onNavigate={chooseView} />}
        {view === "products" && <ProductsView dashboard={dashboard} />}
        {view === "channels" && <ChannelsView dashboard={dashboard} />}
        {view === "customers" && <CustomersView dashboard={dashboard} />}
        {view === "affiliates" && <AffiliatesView dashboard={affiliateDashboard} />}
        {view === "ads" && <AdsView connection={adsConnection} state={adsReportState} report={adsReport} />}
        {view === "restock" && <RestockView dashboard={dashboard} />}
      </div>

      <footer className={s.footer}>
        <span>Serenity Hue · Business intelligence</span>
        <span>{view === "ads" ? "Ad performance · reported by TikTok" : "GBP · net of refunds · Europe/London"}</span>
      </footer>
    </section>
  );
}
