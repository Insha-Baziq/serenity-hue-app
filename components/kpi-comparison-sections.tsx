"use client";

import { ChevronDown, CircleHelp } from "lucide-react";
import { useState } from "react";
import { formatMoney } from "@/lib/format";
import type {
  AffiliateComparisonRow,
  BestSellerMetric,
  KpiProductComparison,
  OfferReviewStatus,
  TikTokAffiliateComparison,
} from "@/lib/kpi-comparisons";
import s from "./kpis-workspace.module.css";

const number = (value: number) => value.toLocaleString("en-GB");

function delta(value: number | null) {
  if (value === null) return "—";
  const rounded = Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1);
  return `${value > 0 ? "+" : ""}${rounded}%`;
}

function offerLabel(status: OfferReviewStatus) {
  if (status === "priority_review") return "Priority review";
  if (status === "watch") return "Watch";
  return "Needs more activity";
}

export function OfferReviewHeader() {
  return (
    <details className={s.offerReviewHeader}>
      <summary className={s.offerReviewHeaderTrigger}>
        <span>Offer review</span>
        <CircleHelp size={14} strokeWidth={1.8} aria-hidden="true" />
      </summary>
      <div className={s.offerReviewHeaderCard}>
        <strong>What this tells you</strong>
        <p>How much recent affiliate activity supports taking a closer look at this creator for a possible offer.</p>
        <ul>
          <li><b>Priority review:</b> stronger evidence from orders, repeated activity, and top-five performance.</li>
          <li><b>Watch:</b> some activity, but more evidence is needed.</li>
          <li><b>Needs more activity:</b> no positive activity in the selected comparison periods.</li>
        </ul>
        <span>Review signal only — it does not send or approve an offer.</span>
      </div>
    </details>
  );
}

export function OfferReview({ row, compact = false }: { row: AffiliateComparisonRow; compact?: boolean }) {
  return (
    <div className={s.offerReview}>
      <span className={`${s.offerStatus} ${s[`offerStatus_${row.offerReview.status}`]}`}>
        {offerLabel(row.offerReview.status)}
      </span>
      {!compact && <span className={s.offerEvidence}>{row.offerReview.reasons.join(" · ")}</span>}
    </div>
  );
}

export function ProductComparisonSection({
  comparison,
  metric,
  visiblePeriodCount,
}: {
  comparison: KpiProductComparison;
  metric: BestSellerMetric;
  visiblePeriodCount: number;
}) {
  const periods = comparison.periods.slice(-visiblePeriodCount);
  const rows = comparison.products
    .map((row) => {
      const values = periods.map((period) => row.periods[period.key]);
      const totalUnits = values.reduce((sum, value) => sum + (value?.netUnits ?? 0), 0);
      const totalRevenue = values.reduce((sum, value) => sum + (value?.netRevenue ?? 0), 0);
      const totalShopifyUnits = values.reduce((sum, value) => sum + (value?.shopifyUnits ?? 0), 0);
      const totalTikTokUnits = values.reduce((sum, value) => sum + (value?.tiktokUnits ?? 0), 0);
      return { row, values, totalUnits, totalRevenue, totalShopifyUnits, totalTikTokUnits };
    })
    .filter(({ totalUnits, totalRevenue }) => totalUnits !== 0 || totalRevenue !== 0)
    .sort((left, right) => metric === "units"
      ? right.totalUnits - left.totalUnits || right.totalRevenue - left.totalRevenue || left.row.title.localeCompare(right.row.title, "en")
      : right.totalRevenue - left.totalRevenue || right.totalUnits - left.totalUnits || left.row.title.localeCompare(right.row.title, "en"));

  return (
    <>
      <div className={s.periodWinnerGrid}>
        {periods.map((period) => {
          const winner = metric === "units" ? period.bestByUnits : period.bestByRevenue;
          return (
            <article key={period.key} className={s.periodWinner}>
              <div className={s.periodWinnerHeading}>
                <span>{period.label}</span>
                {period.partial && <span className={s.partialPill}>Partial</span>}
              </div>
              {winner ? (
                <>
                  <strong title={winner.title}>{winner.title}</strong>
                  <span>{number(winner.netUnits)} net units · {formatMoney(winner.netRevenue)}</span>
                </>
              ) : (
                <p>No positive {metric === "units" ? "net-unit" : "net-revenue"} winner.</p>
              )}
            </article>
          );
        })}
      </div>

      <div className={s.comparisonTableWrap}>
        {rows.length ? (
          <table className={`${s.table} ${s.comparisonTable}`}>
            <thead>
              <tr>
                <th>Product</th>
                {periods.map((period) => <th key={period.key} className={s.numeric}>{period.label}{period.partial ? " · Partial" : ""}</th>)}
                <th className={s.numeric}>Total</th>
                <th className={s.numeric}>Change</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ row, values, totalUnits, totalRevenue }) => (
                <tr key={row.id}>
                  <td><span className={s.cellTitle} title={row.title}>{row.title}</span></td>
                  {values.map((value, index) => (
                    <td key={periods[index]!.key} className={s.numeric}>
                      <strong>{metric === "units" ? number(value?.netUnits ?? 0) : formatMoney(value?.netRevenue ?? 0)}</strong>
                      <span className={s.comparisonSecondary}>{metric === "units" ? formatMoney(value?.netRevenue ?? 0) : `${number(value?.netUnits ?? 0)} units`}</span>
                    </td>
                  ))}
                  <td className={s.numeric}>
                    <strong>{metric === "units" ? number(totalUnits) : formatMoney(totalRevenue)}</strong>
                    <span className={s.comparisonSecondary}>{metric === "units" ? formatMoney(totalRevenue) : `${number(totalUnits)} units`}</span>
                  </td>
                  <td className={s.numeric}>
                    <strong>{delta(metric === "units" ? row.latestChangeByUnits : row.latestChangeByRevenue)}</strong>
                    <span className={s.comparisonSecondary}>vs prior comparable period</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className={s.comparisonEmpty}>No mapped product activity was recorded in these calendar periods.</div>}
      </div>

      <div className={s.comparisonMobileList}>
        {rows.map(({ row, values, totalUnits, totalRevenue, totalShopifyUnits, totalTikTokUnits }) => (
          <details key={row.id} className={s.comparisonMobileItem}>
            <summary>
              <span><strong>{row.title}</strong><small>{metric === "units" ? `${number(totalUnits)} net units` : formatMoney(totalRevenue)}</small></span>
              <span className={s.mobileDelta}>{delta(metric === "units" ? row.latestChangeByUnits : row.latestChangeByRevenue)}<ChevronDown size={15} aria-hidden="true" /></span>
            </summary>
            <dl>
              {periods.map((period, index) => (
                <div key={period.key}>
                  <dt>{period.label}{period.partial ? " · Partial" : ""}</dt>
                  <dd>{number(values[index]?.netUnits ?? 0)} units · {formatMoney(values[index]?.netRevenue ?? 0)}</dd>
                </div>
              ))}
              <div><dt>Channel units</dt><dd>{number(totalShopifyUnits)} Shopify · {number(totalTikTokUnits)} TikTok</dd></div>
            </dl>
          </details>
        ))}
      </div>
    </>
  );
}

type AffiliateComparisonMode = "summary" | "weekly" | "monthly";

export function AffiliateComparisonSection({
  weekly,
  monthly,
}: {
  weekly: TikTokAffiliateComparison;
  monthly: TikTokAffiliateComparison;
}) {
  const [mode, setMode] = useState<AffiliateComparisonMode>("summary");
  const [showAll, setShowAll] = useState(false);
  const comparison = mode === "monthly" ? monthly : weekly;
  const { periods } = comparison;
  const periodUnit = mode === "monthly" ? "months" : "weeks";
  const attributed = comparison.affiliates.filter((row) => row.netSales !== 0 || row.orders > 0 || row.units !== 0);
  const visibleAffiliates = showAll ? attributed : attributed.slice(0, 10);
  const latest = periods.at(-1);
  const latestRows = latest?.affiliates
    .filter((row) => row.netSales !== 0 || row.orders > 0 || row.units !== 0)
    .slice(0, 5) ?? [];
  const comparisonByCreator = new Map(comparison.affiliates.map((row) => [row.creatorId, row]));
  const title = mode === "summary" ? "Affiliate performance summary" : `${mode === "monthly" ? "Monthly" : "Weekly"} affiliate comparison`;
  const subtitle = mode === "summary"
    ? `Latest ${latest?.label ?? "calendar period"} snapshot · choose Weekly or Monthly to compare movement`
    : mode === "monthly"
      ? "Latest three calendar months · Europe/London · refunds applied when processed"
      : "Latest four Monday–Sunday calendar weeks · Europe/London · refunds applied when processed";

  return (
    <section className={s.comparisonPanel} aria-labelledby="affiliate-comparison-heading">
      <header className={s.comparisonPanelHeader}>
        <div>
          <h2 id="affiliate-comparison-heading">{title}</h2>
          <p>{subtitle}</p>
        </div>
        <div className={s.comparisonPanelControls}>
          <div className={s.segmented} role="group" aria-label="Affiliate comparison view">
            {(["summary", "weekly", "monthly"] as const).map((option) => (
              <button key={option} type="button" aria-pressed={mode === option} onClick={() => setMode(option)}>
                {option === "summary" ? "Summary" : option === "weekly" ? "Weekly" : "Monthly"}
              </button>
            ))}
          </div>
        </div>
      </header>

      {mode === "summary" ? (
        <div className={s.affiliateSummary}>
          <div className={s.affiliateSummaryStats}>
            <div><span>Net sales</span><strong>{formatMoney(latest?.netSales ?? 0)}</strong></div>
            <div><span>Attributed orders</span><strong>{number(latest?.attributedOrders ?? 0)}</strong></div>
            <div><span>Net units</span><strong>{number(latest?.units ?? 0)}</strong></div>
            <div><span>Published videos</span><strong>{number(latest?.publishedVideos ?? 0)}</strong></div>
          </div>
          <div className={s.affiliateSummaryBody}>
            <div className={s.affiliateSummaryHeading}>
              <div>
                <h3>Top creators in {latest?.label ?? "the latest period"}</h3>
                <p>Best product is kept beside the creator so it remains visible at a glance.</p>
              </div>
              <span className={s.summaryContext}>{number(latestRows.length)} shown · {latest?.partial ? "partial period" : "complete period"}</span>
            </div>
            {latestRows.length ? (
              <>
                <div className={s.comparisonTableWrap}>
                  <table className={`${s.table} ${s.affiliateSummaryTable}`}>
                    <thead>
                      <tr>
                        <th>Creator</th>
                        <th>Best product</th>
                        <th className={s.numeric}>Net sales</th>
                        <th className={s.numeric}>Orders</th>
                        <th className={s.numeric}>Units</th>
                        <th><OfferReviewHeader /></th>
                      </tr>
                    </thead>
                    <tbody>
                      {latestRows.map((periodRow) => {
                        const row = comparisonByCreator.get(periodRow.creatorId);
                        return (
                          <tr key={periodRow.creatorId}>
                            <td><span className={s.cellTitle} title={periodRow.creatorName}>{periodRow.creatorName}</span></td>
                            <td className={s.bestProductCell}><span className={s.cellTitle} title={periodRow.bestByRevenue?.title}>{periodRow.bestByRevenue?.title ?? "—"}</span></td>
                            <td className={`${s.numeric} ${s.strong}`}>{formatMoney(periodRow.netSales)}</td>
                            <td className={s.numeric}>{number(periodRow.orders)}</td>
                            <td className={s.numeric}>{number(periodRow.units)}</td>
                            <td>{row ? <OfferReview row={row} compact /> : <span className={s.faint}>No review evidence</span>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className={s.comparisonMobileList}>
                  {latestRows.map((periodRow) => {
                    const row = comparisonByCreator.get(periodRow.creatorId);
                    return (
                      <details key={periodRow.creatorId} className={s.comparisonMobileItem}>
                        <summary>
                          <span><strong>{periodRow.creatorName}</strong><small>{formatMoney(periodRow.netSales)} · {number(periodRow.orders)} orders</small></span>
                          <ChevronDown size={15} aria-hidden="true" />
                        </summary>
                        {row && <div className={s.mobileOffer}><OfferReview row={row} compact /></div>}
                        <dl>
                          <div><dt>Best product</dt><dd>{periodRow.bestByRevenue?.title ?? "—"}</dd></div>
                          <div><dt>Net units</dt><dd>{number(periodRow.units)}</dd></div>
                        </dl>
                      </details>
                    );
                  })}
                </div>
              </>
            ) : <div className={s.comparisonEmpty}>No identified creator recorded attributed activity in the latest period.</div>}
          </div>
        </div>
      ) : (
        <>
          <div className={s.affiliatePeriodGrid}>
            {periods.map((period) => (
              <article key={period.key}>
                <div><strong>{period.label}</strong>{period.partial && <span className={s.partialPill}>Partial</span>}</div>
                <span>{formatMoney(period.netSales)}</span>
                <small>{number(period.attributedOrders)} orders · {number(period.units)} units · {number(period.publishedVideos)} videos</small>
              </article>
            ))}
          </div>

          <div className={s.comparisonTableWrap}>
            {visibleAffiliates.length ? (
              <table className={`${s.table} ${s.affiliateComparisonTable}`}>
                <thead>
                  <tr>
                    <th>Creator</th>
                    <th>Best product</th>
                    {periods.map((period) => <th key={period.key} className={s.numeric}>{period.label}{period.partial ? " · Partial" : ""}</th>)}
                    <th className={s.numeric}>Change</th>
                    <th className={s.numeric}>Active {periodUnit}</th>
                    <th className={s.numeric}>Orders</th>
                    <th className={s.numeric}>Units</th>
                    <th className={s.numeric}>Videos</th>
                    <th><OfferReviewHeader /></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleAffiliates.map((row) => (
                    <tr key={row.creatorId}>
                      <td><span className={s.cellTitle} title={row.creatorName}>{row.creatorName}</span></td>
                      <td className={`${s.muted} ${s.bestProductCell}`}><span className={s.cellTitle} title={row.bestProduct?.title}>{row.bestProduct?.title ?? "—"}</span></td>
                      {periods.map((period) => {
                        const value = row.periods[period.key];
                        return <td key={period.key} className={s.numeric}><strong>{formatMoney(value?.netSales ?? 0)}</strong><span className={s.comparisonSecondary}>{number(value?.orders ?? 0)} orders</span></td>;
                      })}
                      <td className={s.numeric}><strong>{delta(row.latestNetSalesChange)}</strong><span className={s.comparisonSecondary}>net sales</span></td>
                      <td className={s.numeric}>{number(row.activePeriods)}</td>
                      <td className={s.numeric}>{number(row.orders)}</td>
                      <td className={s.numeric}>{number(row.units)}</td>
                      <td className={s.numeric}>{number(row.publishedVideos)}</td>
                      <td><OfferReview row={row} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <div className={s.comparisonEmpty}>No identified creator recorded attributed activity in these {periods.length} {periodUnit}.</div>}
          </div>

          <div className={s.comparisonMobileList}>
            {visibleAffiliates.map((row) => (
              <details key={row.creatorId} className={s.comparisonMobileItem}>
                <summary>
                  <span><strong>{row.creatorName}</strong><small>{formatMoney(row.netSales)} · {number(row.orders)} orders</small></span>
                  <span className={s.mobileDelta}>{delta(row.latestNetSalesChange)}<ChevronDown size={15} aria-hidden="true" /></span>
                </summary>
                <div className={s.mobileOffer}><OfferReview row={row} /></div>
                <dl>
                  {periods.map((period) => {
                    const value = row.periods[period.key];
                    return <div key={period.key}><dt>{period.label}{period.partial ? " · Partial" : ""}</dt><dd>{formatMoney(value?.netSales ?? 0)} · {number(value?.orders ?? 0)} orders</dd></div>;
                  })}
                  <div><dt>Active {periodUnit}</dt><dd>{number(row.activePeriods)} of {number(periods.length)}</dd></div>
                  <div><dt>Net units · videos</dt><dd>{number(row.units)} · {number(row.publishedVideos)}</dd></div>
                  <div><dt>Best product</dt><dd>{row.bestProduct?.title ?? "—"}</dd></div>
                </dl>
              </details>
            ))}
          </div>
          {!showAll && attributed.length > visibleAffiliates.length && (
            <div className={s.comparisonShowAll}>
              <button type="button" onClick={() => setShowAll(true)}>Show all {number(attributed.length)} creators</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
