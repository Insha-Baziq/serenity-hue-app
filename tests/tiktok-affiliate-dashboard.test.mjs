import assert from "node:assert/strict";
import test from "node:test";
import { buildTikTokAffiliateDashboard, rankTikTokAffiliates } from "../lib/tiktok-affiliate-dashboard.ts";

test("affiliate KPI dashboard keeps unreconciled GMV outside net sales and applies a partial refund on its London day", () => {
  const dashboard = buildTikTokAffiliateDashboard({
    range: { start: "2026-09-01", end: "2026-09-03" },
    orders: [
      { id: "a-1", orderId: "order-1", lineItemId: "line-1", createdAt: "2026-09-01T10:00:00.000Z", quantity: 2, grossAmount: 4000, estimatedCommission: 500, creator: "Rose Reviews", linked: { financialStatus: "paid", cancelledAt: null } },
      { id: "a-2", orderId: "order-2", lineItemId: "line-2", createdAt: "2026-09-02T10:00:00.000Z", quantity: 1, grossAmount: 1500, estimatedCommission: 200, creator: "Unlinked creator", linked: null },
      { id: "a-3", orderId: "order-3", lineItemId: "line-3", createdAt: "2026-09-02T12:00:00.000Z", quantity: 1, grossAmount: 1800, estimatedCommission: 220, creator: "Cancelled creator", linked: { financialStatus: "paid", cancelledAt: "2026-09-02T13:00:00.000Z" } },
    ],
    refunds: [{ orderId: "order-1", lineItemId: "line-1", quantity: 1, processedAt: "2026-09-03T13:00:00.000Z" }],
    videos: [{ id: "video-1", creator: "Rose Reviews", publishedAt: "2026-09-02T10:00:00.000Z" }],
    freshness: { lastSuccessfulAt: "2026-09-03T15:00:00.000Z", lastErrorAt: null },
  });

  assert.deepEqual(dashboard.metrics, {
    netSales: 2000,
    estimatedCommission: 500,
    attributedOrders: 1,
    units: 1,
    activeAffiliates: 1,
    publishedVideos: 1,
    unreconciledGmv: 1500,
  });
  assert.equal(dashboard.status.kind, "fresh");
  assert.deepEqual(dashboard.trend, [
    { date: "2026-09-01", netSales: 4000, orders: 1 },
    { date: "2026-09-02", netSales: 0, orders: 0 },
    { date: "2026-09-03", netSales: -2000, orders: 0 },
  ]);
});

test("affiliate all time means retained data and has no prior comparison", () => {
  const dashboard = buildTikTokAffiliateDashboard({
    range: { start: "2026-06-07", end: "2026-09-05", allTime: true },
    orders: [], refunds: [], videos: [], freshness: null,
  });
  assert.equal(dashboard.previous, null);
  assert.equal(dashboard.status.kind, "unavailable");
  assert.match(dashboard.historyNote, /retained by Serenity Hue/i);
});

test("affiliate all-time trends are bounded into calendar buckets without changing totals", () => {
  const dashboard = buildTikTokAffiliateDashboard({
    range: { start: "2025-01-01", end: "2026-01-02", allTime: true },
    orders: [
      { id: "first", orderId: "first-order", lineItemId: "first-line", createdAt: "2025-01-15T10:00:00.000Z", quantity: 1, grossAmount: 1200, estimatedCommission: 120, creator: "Rose", linked: { financialStatus: "paid", cancelledAt: null } },
      { id: "last", orderId: "last-order", lineItemId: "last-line", createdAt: "2026-01-02T10:00:00.000Z", quantity: 2, grossAmount: 1800, estimatedCommission: 180, creator: "Ada", linked: { financialStatus: "paid", cancelledAt: null } },
    ],
    refunds: [{ orderId: "first-order", lineItemId: "first-line", quantity: 1, processedAt: "2025-01-20T10:00:00.000Z" }],
    videos: [], freshness: null,
  });

  assert.equal(dashboard.trendGranularity, "bucket");
  assert.equal(dashboard.trendIntervalDays, 3);
  assert.equal(dashboard.trend.length, 123);
  assert.deepEqual(dashboard.trend.filter((point) => point.netSales || point.orders), [
    { date: "2025-01-13", netSales: 1200, orders: 1 },
    { date: "2025-01-19", netSales: -1200, orders: 0 },
    { date: "2026-01-02", netSales: 1800, orders: 1 },
  ]);
  assert.equal(dashboard.metrics.netSales, 1800);
});

test("affiliate KPI dashboard applies London reporting dates at the daylight-saving boundary", () => {
  const dashboard = buildTikTokAffiliateDashboard({
    range: { start: "2026-09-01", end: "2026-09-01" },
    orders: [{
      id: "a-boundary", orderId: "order-boundary", lineItemId: "line-boundary",
      createdAt: "2026-08-31T23:30:00.000Z", quantity: 1, grossAmount: 1250,
      estimatedCommission: 150, creator: "London creator",
      linked: { financialStatus: "paid", cancelledAt: null },
    }],
    refunds: [], videos: [], freshness: { lastSuccessfulAt: "2026-09-01T00:00:00.000Z", lastErrorAt: null },
  });

  assert.equal(dashboard.metrics.netSales, 1250);
  assert.deepEqual(dashboard.trend, [{ date: "2026-09-01", netSales: 1250, orders: 1 }]);
});

test("affiliate intelligence ranks consistently, aggregates products, counts videos, and states offer evidence", () => {
  const dashboard = buildTikTokAffiliateDashboard({
    range: { start: "2026-09-01", end: "2026-09-03" },
    orders: [
      { id: "rose-1", orderId: "rose-order-1", lineItemId: "line-1", createdAt: "2026-09-01T10:00:00.000Z", quantity: 2, grossAmount: 4000, estimatedCommission: 500, creator: "Rose", product: "Glow Oil", linked: { financialStatus: "paid", cancelledAt: null } },
      { id: "rose-2", orderId: "rose-order-2", lineItemId: "line-2", createdAt: "2026-09-02T10:00:00.000Z", quantity: 1, grossAmount: 2000, estimatedCommission: 450, creator: "Rose", product: "Glow Oil", linked: { financialStatus: "paid", cancelledAt: null } },
      { id: "rose-3", orderId: "rose-order-3", lineItemId: "line-3", createdAt: "2026-09-03T10:00:00.000Z", quantity: 1, grossAmount: 2000, estimatedCommission: 100, creator: "Rose", product: "Face Mist", linked: { financialStatus: "paid", cancelledAt: null } },
      { id: "ada-1", orderId: "ada-order-1", lineItemId: "line-4", createdAt: "2026-09-01T10:00:00.000Z", quantity: 1, grossAmount: 6000, estimatedCommission: 250, creator: "Ada", product: "Face Mist", linked: { financialStatus: "paid", cancelledAt: null } },
      { id: "bea-1", orderId: "bea-order-1", lineItemId: "line-5", createdAt: "2026-09-02T10:00:00.000Z", quantity: 1, grossAmount: 6000, estimatedCommission: 250, creator: "Bea", product: "Face Mist", linked: { financialStatus: "paid", cancelledAt: null } },
    ],
    refunds: [{ orderId: "rose-order-1", lineItemId: "line-1", quantity: 1, processedAt: "2026-09-03T12:00:00.000Z" }],
    videos: [
      { id: "rose-video-1", creator: "Rose", publishedAt: "2026-09-01T10:00:00.000Z" },
      { id: "rose-video-2", creator: "Rose", publishedAt: "2026-09-02T10:00:00.000Z" },
      { id: "ada-video", creator: "Ada", publishedAt: "2026-09-02T10:00:00.000Z" },
    ],
    freshness: { lastSuccessfulAt: "2026-09-03T15:00:00.000Z", lastErrorAt: null },
  });

  assert.deepEqual(rankTikTokAffiliates(dashboard.affiliates, "revenue").map((affiliate) => affiliate.creator), ["Ada", "Bea", "Rose"]);
  assert.deepEqual(rankTikTokAffiliates(dashboard.affiliates, "orders").map((affiliate) => affiliate.creator), ["Rose", "Ada", "Bea"]);
  assert.deepEqual(rankTikTokAffiliates(dashboard.affiliates, "commission").map((affiliate) => affiliate.creator), ["Rose", "Ada", "Bea"]);
  assert.deepEqual(dashboard.products, [
    { productId: "Face Mist", product: "Face Mist", netSales: 14000, units: 3, orders: 3 },
    { productId: "Glow Oil", product: "Glow Oil", netSales: 4000, units: 2, orders: 2 },
  ]);
  assert.deepEqual(dashboard.affiliates.find((affiliate) => affiliate.creator === "Rose"), {
    creatorId: "Rose", creator: "Rose", netSales: 6000, estimatedCommission: 1050, orders: 3, units: 3,
    publishedVideos: 2, bestSellingProduct: "Glow Oil", offerCandidate: "Review candidate",
  });
});

test("affiliate intelligence returns an honest empty ranking", () => {
  const dashboard = buildTikTokAffiliateDashboard({
    range: { start: "2026-09-01", end: "2026-09-01" }, orders: [], refunds: [], videos: [], freshness: null,
  });
  assert.deepEqual(dashboard.affiliates, []);
  assert.deepEqual(dashboard.products, []);
  assert.deepEqual(rankTikTokAffiliates(dashboard.affiliates, "revenue"), []);
});
