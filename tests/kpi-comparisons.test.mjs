import assert from "node:assert/strict";
import test from "node:test";
import {
  buildKpiProductComparison,
  buildTikTokAffiliateComparison,
  comparisonPeriods,
} from "../lib/kpi-comparisons.ts";

const london = "Europe/London";

function sale(id, createdAt, product, quantity, unitPrice, channel = "shopify") {
  return {
    id,
    createdAt,
    channel,
    financialStatus: "paid",
    cancelledAt: null,
    items: [{ id: `${id}-line`, quantity, unitPrice, product }],
  };
}

function affiliateOrder({ id, createdAt, creatorId, creatorName, productId = "product-1", productTitle = "Glow Oil", quantity = 1, grossAmount = 1000 }) {
  return {
    id,
    orderId: `${id}-order`,
    lineItemId: `${id}-line`,
    createdAt,
    quantity,
    grossAmount,
    estimatedCommission: Math.round(grossAmount * 0.1),
    creator: creatorName,
    creatorId,
    creatorName,
    product: productTitle,
    productId,
    productTitle,
    linked: { financialStatus: "paid", cancelledAt: null },
  };
}

test("comparison periods are Monday-Sunday weeks and calendar months with honest partials", () => {
  const weeks = comparisonPeriods({ grain: "week", periodCount: 4, anchorDate: "2026-09-09", timeZone: london });
  assert.deepEqual(weeks.map(({ start, end, calendarEnd, partial }) => ({ start, end, calendarEnd, partial })), [
    { start: "2026-08-17", end: "2026-08-23", calendarEnd: "2026-08-23", partial: false },
    { start: "2026-08-24", end: "2026-08-30", calendarEnd: "2026-08-30", partial: false },
    { start: "2026-08-31", end: "2026-09-06", calendarEnd: "2026-09-06", partial: false },
    { start: "2026-09-07", end: "2026-09-09", calendarEnd: "2026-09-13", partial: true },
  ]);
  const currentSunday = comparisonPeriods({ grain: "week", periodCount: 4, anchorDate: "2026-09-13", timeZone: london });
  assert.equal(currentSunday.at(-1).partial, true, "the current calendar week remains partial until the day is complete");
  const months = comparisonPeriods({ grain: "month", periodCount: 3, anchorDate: "2026-09-13", timeZone: london });
  assert.deepEqual(months.map(({ label, start, end, calendarEnd, partial }) => ({ label, start, end, calendarEnd, partial })), [
    { label: "July 2026", start: "2026-07-01", end: "2026-07-31", calendarEnd: "2026-07-31", partial: false },
    { label: "August 2026", start: "2026-08-01", end: "2026-08-31", calendarEnd: "2026-08-31", partial: false },
    { label: "September 2026", start: "2026-09-01", end: "2026-09-13", calendarEnd: "2026-09-30", partial: true },
  ]);
});

test("product comparison applies London DST dates, processed refunds, winner switching, ties, and unmapped totals", () => {
  const comparison = buildKpiProductComparison({
    spec: { grain: "week", periodCount: 4, anchorDate: "2026-04-01", timeZone: london },
    sales: [
      sale("units", "2026-03-30T09:00:00.000Z", { id: "units", title: "Unit Winner" }, 4, 500),
      sale("revenue", "2026-03-30T10:00:00.000Z", { id: "revenue", title: "Revenue Winner" }, 1, 5000, "tiktok"),
      sale("dst", "2026-03-29T23:30:00.000Z", { id: "dst", title: "DST Product" }, 1, 800),
      sale("tie-b", "2026-03-24T10:00:00.000Z", { id: "tie-b", title: "Beta" }, 1, 1000),
      sale("tie-a", "2026-03-24T11:00:00.000Z", { id: "tie-a", title: "Alpha" }, 1, 1000),
      sale("unmapped", "2026-03-31T10:00:00.000Z", null, 2, 700),
      sale("historical-return", "2026-03-01T10:00:00.000Z", { id: "historical-return", title: "Historical Return" }, 3, 900),
    ],
    refunds: [
      { orderId: "units", lineItemId: "units-line", quantity: 1, processedAt: "2026-04-01T12:00:00.000Z" },
      { orderId: "historical-return", lineItemId: "historical-return-line", quantity: 2, processedAt: "2026-03-05T12:00:00.000Z" },
      { orderId: "historical-return", lineItemId: "historical-return-line", quantity: 2, processedAt: "2026-04-01T13:00:00.000Z" },
    ],
  });
  const current = comparison.periods.at(-1);
  assert.equal(current.partial, true);
  assert.equal(current.bestByUnits.id, "units");
  assert.equal(current.bestByUnits.netUnits, 3);
  assert.equal(current.bestByRevenue.id, "revenue");
  assert.deepEqual(current.unassigned, { netUnits: 2, netRevenue: 1400 });
  assert.equal(current.products.find((product) => product.id === "dst").netUnits, 1);
  assert.equal(current.products.find((product) => product.id === "historical-return").netUnits, -1, "prior refunds cap the quantity refunded in-period");
  const prior = comparison.periods.at(-2);
  assert.equal(prior.bestByUnits.id, "tie-a", "alphabetical title breaks a fully equal positive tie");
});

test("partial product changes compare with the same elapsed days of the preceding calendar period", () => {
  const comparison = buildKpiProductComparison({
    spec: { grain: "week", periodCount: 4, anchorDate: "2026-09-09", timeZone: london },
    sales: [
      sale("prior-early", "2026-09-01T10:00:00.000Z", { id: "p", title: "Brow Gel" }, 2, 1000),
      sale("prior-late", "2026-09-06T10:00:00.000Z", { id: "p", title: "Brow Gel" }, 100, 1000),
      sale("current", "2026-09-08T10:00:00.000Z", { id: "p", title: "Brow Gel" }, 4, 1000),
    ],
    refunds: [],
  });
  const row = comparison.products.find((product) => product.id === "p");
  assert.equal(row.latestChangeByUnits, 100);
  assert.equal(row.latestChangeByRevenue, 100);
});

test("product periods do not invent a winner for zero or negative mapped activity", () => {
  const comparison = buildKpiProductComparison({
    spec: { grain: "month", periodCount: 2, anchorDate: "2026-09-13", timeZone: london },
    sales: [sale("returned", "2026-09-01T10:00:00.000Z", { id: "returned", title: "Returned Product" }, 1, 1200)],
    refunds: [{ orderId: "returned", lineItemId: "returned-line", quantity: 1, processedAt: "2026-09-02T10:00:00.000Z" }],
  });
  assert.equal(comparison.periods.at(-1).bestByUnits, null);
  assert.equal(comparison.periods.at(-1).bestByRevenue, null);
});

test("affiliate comparison groups renamed creators and products by stable IDs and exposes transparent offer thresholds", () => {
  const priorityOrders = [
    affiliateOrder({ id: "priority-1", createdAt: "2026-09-01T10:00:00.000Z", creatorId: "creator-open-1", creatorName: "Old Name", productId: "source-product-1", productTitle: "Old Glow Oil" }),
    affiliateOrder({ id: "priority-2", createdAt: "2026-09-02T10:00:00.000Z", creatorId: "creator-open-1", creatorName: "Old Name", productId: "source-product-1", productTitle: "Old Glow Oil" }),
    affiliateOrder({ id: "priority-3", createdAt: "2026-09-08T10:00:00.000Z", creatorId: "creator-open-1", creatorName: "New Name", productId: "source-product-1", productTitle: "Glow Oil" }),
    affiliateOrder({ id: "watch-1", createdAt: "2026-09-08T11:00:00.000Z", creatorId: "creator-open-2", creatorName: "Watch Creator", grossAmount: 600 }),
  ];
  const comparison = buildTikTokAffiliateComparison({
    spec: { grain: "week", periodCount: 4, anchorDate: "2026-09-09", timeZone: london },
    orders: priorityOrders,
    refunds: [],
    videos: [
      { id: "v1", creator: "Old Name", creatorId: "creator-open-1", creatorName: "Old Name", publishedAt: "2026-09-01T12:00:00.000Z" },
      { id: "v2", creator: "New Name", creatorId: "creator-open-1", creatorName: "New Name", publishedAt: "2026-09-08T12:00:00.000Z" },
      { id: "v3", creator: "Video Only", creatorId: "creator-open-3", creatorName: "Video Only", publishedAt: "2026-09-08T12:00:00.000Z" },
    ],
  });
  assert.equal(comparison.affiliates.length, 3);
  const priority = comparison.affiliates.find((affiliate) => affiliate.creatorId === "creator-open-1");
  assert.equal(priority.creatorName, "New Name");
  assert.equal(priority.activeWeeks, 2);
  assert.equal(priority.orders, 3);
  assert.equal(priority.publishedVideos, 2);
  assert.equal(priority.bestProduct.id, "source-product-1");
  assert.equal(priority.bestProduct.title, "Glow Oil");
  assert.equal(priority.offerReview.status, "priority_review");
  assert.match(priority.offerReview.reasons.join(" "), /Active 2 of 4 weeks/);
  assert.equal(comparison.affiliates.find((affiliate) => affiliate.creatorId === "creator-open-2").offerReview.status, "watch");
  assert.equal(comparison.affiliates.find((affiliate) => affiliate.creatorId === "creator-open-3").offerReview.status, "needs_more_activity");
});

test("affiliate comparison supports calendar months with month-aware activity evidence", () => {
  const comparison = buildTikTokAffiliateComparison({
    spec: { grain: "month", periodCount: 2, anchorDate: "2026-09-13", timeZone: london },
    orders: [
      affiliateOrder({ id: "august", createdAt: "2026-08-12T10:00:00.000Z", creatorId: "creator-month", creatorName: "Month Creator" }),
      affiliateOrder({ id: "september", createdAt: "2026-09-04T10:00:00.000Z", creatorId: "creator-month", creatorName: "Month Creator" }),
    ],
    refunds: [],
    videos: [],
  });
  assert.deepEqual(comparison.periods.map(({ label, partial }) => ({ label, partial })), [
    { label: "August 2026", partial: false },
    { label: "September 2026", partial: true },
  ]);
  const creator = comparison.affiliates[0];
  assert.equal(creator.activePeriods, 2);
  assert.equal(creator.activeWeeks, 2);
  assert.match(creator.offerReview.reasons.join(" "), /Active 2 of 2 months/);
});
