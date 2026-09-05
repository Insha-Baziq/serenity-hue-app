import assert from "node:assert/strict";
import test from "node:test";
import { buildTikTokAffiliateDashboard } from "../lib/tiktok-affiliate-dashboard.ts";

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
