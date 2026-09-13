import assert from "node:assert/strict";
import test from "node:test";
import { buildKpiDashboard } from "../lib/kpi-dashboard.ts";

test("KPI dashboard puts a partial refund on its issued London business day", () => {
  const dashboard = buildKpiDashboard({
    range: { start: "2026-08-01", end: "2026-08-03" },
    sales: [
      {
        id: "shopify-1",
        createdAt: "2026-08-01T10:00:00.000Z",
        channel: "shopify",
        financialStatus: "paid",
        cancelledAt: null,
        items: [{ id: "line-1", quantity: 2, unitPrice: 1000, product: { id: "physical-1", title: "Rose Candle" } }],
      },
      {
        id: "tiktok-1",
        createdAt: "2026-08-02T10:00:00.000Z",
        channel: "tiktok",
        financialStatus: "paid",
        cancelledAt: null,
        items: [{ id: "line-2", quantity: 1, unitPrice: 2500, product: { id: "physical-2", title: "Amber Diffuser" } }],
      },
      {
        id: "cancelled-order",
        createdAt: "2026-08-02T12:00:00.000Z",
        channel: "shopify",
        financialStatus: "paid",
        cancelledAt: "2026-08-02T12:30:00.000Z",
        items: [{ id: "line-cancelled", quantity: 1, unitPrice: 9999, product: { id: "physical-3", title: "Ignored" } }],
      },
      {
        id: "previous-order",
        createdAt: "2026-07-29T10:00:00.000Z",
        channel: "shopify",
        financialStatus: "paid",
        cancelledAt: null,
        items: [{ id: "line-previous", quantity: 1, unitPrice: 500, product: { id: "physical-1", title: "Rose Candle" } }],
      },
    ],
    refunds: [
      { orderId: "shopify-1", lineItemId: "line-1", quantity: 1, processedAt: "2026-08-03T16:00:00.000Z" },
      { orderId: "previous-order", lineItemId: "line-previous", quantity: 1, processedAt: "2026-07-30T16:00:00.000Z" },
    ],
    freshness: "2026-08-03T17:00:00.000Z",
  });

  assert.deepEqual(dashboard.metrics, {
    netSales: 3500,
    orders: 2,
    averageOrderValue: 1750,
    netUnits: 2,
  });
  assert.deepEqual(dashboard.previous.metrics, {
    netSales: 0,
    orders: 1,
    averageOrderValue: 0,
    netUnits: 0,
  });
  assert.deepEqual(dashboard.trend.map((day) => [day.date, day.netSales, day.orders]), [
    ["2026-08-01", 2000, 1],
    ["2026-08-02", 2500, 1],
    ["2026-08-03", -1000, 0],
  ]);
  // The prior series carries the same number of buckets on the same interval, so
  // the comparison line on the sales chart lines up point for point, and it
  // applies the prior period's refund on its own issued day.
  assert.deepEqual(dashboard.previousTrend.map((day) => [day.date, day.netSales, day.orders]), [
    ["2026-07-29", 500, 1],
    ["2026-07-30", -500, 0],
    ["2026-07-31", 0, 0],
  ]);
  assert.equal(dashboard.previousTrend.length, dashboard.trend.length);
  assert.deepEqual(dashboard.products, [
    { id: "physical-2", title: "Amber Diffuser", netUnits: 1, netRevenue: 2500, shopifyUnits: 0, tiktokUnits: 1 },
    { id: "physical-1", title: "Rose Candle", netUnits: 1, netRevenue: 1000, shopifyUnits: 1, tiktokUnits: 0 },
  ]);
  assert.deepEqual(dashboard.channels, [
    { channel: "shopify", netSales: 1000, orders: 1, averageOrderValue: 1000, netUnits: 1, unitShare: 0.5 },
    { channel: "tiktok", netSales: 2500, orders: 1, averageOrderValue: 2500, netUnits: 1, unitShare: 0.5 },
  ]);
  assert.deepEqual(dashboard.dataQuality, { refundEvents: 1, refundedUnits: 1, cancelledOrders: 1 });
  assert.deepEqual(dashboard.productTrends["physical-1"].filter((point) => point.netRevenue || point.netUnits), [
    { date: "2026-08-01", netRevenue: 2000, netUnits: 2 },
    { date: "2026-08-03", netRevenue: -1000, netUnits: -1 },
  ]);
});

test("KPI dashboard keeps safely unmapped sales visible without inventing a product", () => {
  const dashboard = buildKpiDashboard({
    range: { start: "2026-08-01", end: "2026-08-01" },
    sales: [{
      id: "unmapped",
      createdAt: "2026-08-01T10:00:00.000Z",
      channel: "shopify",
      financialStatus: "paid",
      cancelledAt: null,
      items: [{ id: "line-unmapped", quantity: 2, unitPrice: 1200, product: null }],
    }],
    refunds: [],
    freshness: null,
  });

  assert.equal(dashboard.metrics.netSales, 2400);
  assert.deepEqual(dashboard.products, []);
  assert.deepEqual(dashboard.unassigned, { netUnits: 2, netRevenue: 2400 });
});

test("KPI dashboard does not invent a prior-period comparison for all recorded activity", () => {
  const dashboard = buildKpiDashboard({
    range: { start: "2026-01-01", end: "2026-01-02", allTime: true },
    sales: [{
      id: "all-time-order",
      createdAt: "2026-01-01T10:00:00.000Z",
      channel: "shopify",
      financialStatus: "paid",
      cancelledAt: null,
      items: [{ id: "all-time-line", quantity: 2, unitPrice: 1200, product: null }],
    }],
    refunds: [],
    freshness: null,
  });

  assert.equal(dashboard.range.allTime, true);
  assert.equal(dashboard.previous, null);
  assert.deepEqual(dashboard.previousTrend, []);
  assert.deepEqual(dashboard.metrics, { netSales: 2400, orders: 1, averageOrderValue: 2400, netUnits: 2 });
});

test("KPI dashboard bounds long-range chart data to evenly spaced calendar buckets without changing KPI totals", () => {
  const dashboard = buildKpiDashboard({
    range: { start: "2025-01-01", end: "2026-01-02" },
    sales: [
      { id: "jan-2025", createdAt: "2025-01-15T10:00:00.000Z", channel: "shopify", financialStatus: "paid", cancelledAt: null, items: [{ id: "jan-2025-line", quantity: 1, unitPrice: 1200, product: null }] },
      { id: "jan-2026", createdAt: "2026-01-02T10:00:00.000Z", channel: "tiktok", financialStatus: "paid", cancelledAt: null, items: [{ id: "jan-2026-line", quantity: 2, unitPrice: 900, product: null }] },
    ],
    refunds: [{ orderId: "jan-2025", lineItemId: "jan-2025-line", quantity: 1, processedAt: "2025-01-20T10:00:00.000Z" }],
    freshness: null,
  });

  assert.equal(dashboard.trendGranularity, "bucket");
  assert.equal(dashboard.trendIntervalDays, 3);
  assert.equal(dashboard.trend.length, 123);
  assert.deepEqual(dashboard.trend.filter((point) => point.netSales || point.orders), [
    { date: "2025-01-13", netSales: 1200, orders: 1 },
    { date: "2025-01-19", netSales: -1200, orders: 0 },
    { date: "2026-01-02", netSales: 1800, orders: 1 },
  ]);
  assert.deepEqual(dashboard.metrics, { netSales: 1800, orders: 2, averageOrderValue: 900, netUnits: 2 });
});

test("KPI dashboard is zero-safe and recomputes the visible product row from refreshed source data", () => {
  const base = {
    range: { start: "2026-08-01", end: "2026-08-01" },
    refunds: [],
    freshness: "2026-08-01T12:00:00.000Z",
  };
  const empty = buildKpiDashboard({ ...base, sales: [] });
  const refreshed = buildKpiDashboard({
    ...base,
    sales: [{
      id: "mapped-after-refresh",
      createdAt: "2026-08-01T10:00:00.000Z",
      channel: "shopify",
      financialStatus: "paid",
      cancelledAt: null,
      items: [{ id: "mapped-line", quantity: 3, unitPrice: 700, product: { id: "physical-rose", title: "Rose Candle" } }],
    }],
  });

  assert.deepEqual(empty.metrics, { netSales: 0, orders: 0, averageOrderValue: 0, netUnits: 0 });
  assert.deepEqual(refreshed.products, [{ id: "physical-rose", title: "Rose Candle", netUnits: 3, netRevenue: 2100, shopifyUnits: 3, tiktokUnits: 0 }]);
});

test("KPI dashboard classifies only safely identified active customers and ranks their refund-aware spend", () => {
  const dashboard = buildKpiDashboard({
    range: { start: "2026-08-01", end: "2026-08-03" },
    sales: [
      {
        id: "ada-current", createdAt: "2026-08-01T10:00:00.000Z", channel: "shopify", financialStatus: "paid", cancelledAt: null,
        customer: { name: "Ada Lovelace", email: "ADA@example.com", phone: null },
        items: [{ id: "ada-line", quantity: 1, unitPrice: 1000, product: null }],
      },
      {
        id: "iris-current", createdAt: "2026-08-02T10:00:00.000Z", channel: "tiktok", financialStatus: "paid", cancelledAt: null,
        customer: { name: "Iris Rose", email: null, phone: "+44 20 7000 0000" },
        items: [{ id: "iris-line", quantity: 2, unitPrice: 1000, product: null }],
      },
      {
        id: "malik-current", createdAt: "2026-08-02T12:00:00.000Z", channel: "shopify", financialStatus: "paid", cancelledAt: null,
        customer: { name: "Malik Rose", email: null, phone: "+44 20 7000 0000" },
        items: [{ id: "malik-line", quantity: 1, unitPrice: 3000, product: null }],
      },
      {
        id: "unsafe-current", createdAt: "2026-08-02T14:00:00.000Z", channel: "shopify", financialStatus: "paid", cancelledAt: null,
        customer: { name: "", email: null, phone: "+44 20 7000 9999" },
        items: [{ id: "unsafe-line", quantity: 1, unitPrice: 2500, product: null }],
      },
    ],
    customerOrders: [
      { id: "ada-current", createdAt: "2026-08-01T10:00:00.000Z", financialStatus: "paid", cancelledAt: null, customer: { name: "Ada Lovelace", email: "ADA@example.com", phone: null } },
      { id: "ada-history", createdAt: "2026-07-15T10:00:00.000Z", financialStatus: "paid", cancelledAt: null, customer: { name: "Ada Lovelace", email: "ada@example.com", phone: null } },
      { id: "iris-current", createdAt: "2026-08-02T10:00:00.000Z", financialStatus: "paid", cancelledAt: null, customer: { name: "Iris Rose", email: null, phone: "+44 20 7000 0000" } },
      { id: "iris-history", createdAt: "2026-06-21T10:00:00.000Z", financialStatus: "paid", cancelledAt: null, customer: { name: "Iris M. Rose", email: null, phone: "442070000000" } },
      { id: "malik-current", createdAt: "2026-08-02T12:00:00.000Z", financialStatus: "paid", cancelledAt: null, customer: { name: "Malik Rose", email: null, phone: "+44 20 7000 0000" } },
      { id: "unsafe-current", createdAt: "2026-08-02T14:00:00.000Z", financialStatus: "paid", cancelledAt: null, customer: { name: "", email: null, phone: "+44 20 7000 9999" } },
    ],
    refunds: [{ orderId: "iris-current", lineItemId: "iris-line", quantity: 1, processedAt: "2026-08-03T10:00:00.000Z" }],
    freshness: null,
  });

  assert.deepEqual(dashboard.customers.summary, { new: 1, repeat: 2, total: 3 });
  assert.deepEqual(dashboard.customers.topCustomers.map((customer) => [customer.name, customer.netSpend, customer.qualifyingOrders]), [
    ["Malik Rose", 3000, 1],
    ["Iris Rose", 1000, 2],
    ["Ada Lovelace", 1000, 2],
  ]);
});

test("KPI dashboard retains an email customer's phone evidence for a conservative no-email match", () => {
  const dashboard = buildKpiDashboard({
    range: { start: "2026-08-01", end: "2026-08-03" },
    sales: [
      { id: "email-order", createdAt: "2026-08-01T10:00:00.000Z", channel: "shopify", financialStatus: "paid", cancelledAt: null, customer: { name: "Ada Lovelace", email: "ada@example.com", phone: "+44 20 7000 0000" }, items: [{ id: "email-line", quantity: 1, unitPrice: 1000, product: null }] },
      { id: "phone-order", createdAt: "2026-08-02T10:00:00.000Z", channel: "tiktok", financialStatus: "paid", cancelledAt: null, customer: { name: "Ada M. Lovelace", email: null, phone: "442070000000" }, items: [{ id: "phone-line", quantity: 1, unitPrice: 2000, product: null }] },
    ],
    customerOrders: [
      { id: "email-order", createdAt: "2026-08-01T10:00:00.000Z", financialStatus: "paid", cancelledAt: null, customer: { name: "Ada Lovelace", email: "ada@example.com", phone: "+44 20 7000 0000" } },
      { id: "phone-order", createdAt: "2026-08-02T10:00:00.000Z", financialStatus: "paid", cancelledAt: null, customer: { name: "Ada M. Lovelace", email: null, phone: "442070000000" } },
    ],
    refunds: [],
    freshness: null,
  });

  assert.deepEqual(dashboard.customers.summary, { new: 0, repeat: 1, total: 1 });
  assert.deepEqual(dashboard.customers.topCustomers.map((customer) => [customer.netSpend, customer.qualifyingOrders]), [[3000, 2]]);
});

test("KPI dashboard forecasts only complete, urgent physical-variant restock decisions", () => {
  const dashboard = buildKpiDashboard({
    range: { start: "2026-08-01", end: "2026-08-03" },
    sales: [],
    refunds: [
      { orderId: "rose-demand", lineItemId: "rose-line", quantity: 10, processedAt: "2026-08-28T09:00:00.000Z" },
    ],
    restock: {
      today: "2026-08-30",
      variants: [
        { id: "urgent", productTitle: "Brow Pomade", variantTitle: "Deep", countedStock: 5, leadTimeDays: 7, firstPaidSaleAt: "2026-07-01T10:00:00.000Z" },
        { id: "rose", productTitle: "Brow Pomade", variantTitle: "Rose", countedStock: 20, leadTimeDays: 7, firstPaidSaleAt: "2026-07-01T10:00:00.000Z" },
        { id: "later", productTitle: "Brow Pomade", variantTitle: "Later", countedStock: 80, leadTimeDays: 7, firstPaidSaleAt: "2026-07-01T10:00:00.000Z" },
        { id: "uncounted", productTitle: "Brow Pomade", variantTitle: "Uncounted", countedStock: null, leadTimeDays: 7, firstPaidSaleAt: "2026-07-01T10:00:00.000Z" },
        { id: "too-new", productTitle: "Brow Pomade", variantTitle: "Too new", countedStock: 5, leadTimeDays: 7, firstPaidSaleAt: "2026-08-12T10:00:00.000Z" },
      ],
      demandLines: [
        { orderId: "urgent-demand", lineItemId: "urgent-line", variantId: "urgent", createdAt: "2026-08-20T10:00:00.000Z", financialStatus: "paid", cancelledAt: null, quantity: 90, quantityPerSale: 1 },
        { orderId: "rose-demand", lineItemId: "rose-line", variantId: "rose", createdAt: "2026-08-20T10:00:00.000Z", financialStatus: "paid", cancelledAt: null, quantity: 100, quantityPerSale: 1 },
        { orderId: "later-demand", lineItemId: "later-line", variantId: "later", createdAt: "2026-08-20T10:00:00.000Z", financialStatus: "paid", cancelledAt: null, quantity: 90, quantityPerSale: 1 },
        { orderId: "uncounted-demand", lineItemId: "uncounted-line", variantId: "uncounted", createdAt: "2026-08-20T10:00:00.000Z", financialStatus: "paid", cancelledAt: null, quantity: 90, quantityPerSale: 1 },
        { orderId: "new-demand", lineItemId: "new-line", variantId: "too-new", createdAt: "2026-08-20T10:00:00.000Z", financialStatus: "paid", cancelledAt: null, quantity: 90, quantityPerSale: 1 },
      ],
    },
    freshness: null,
  });

  assert.deepEqual(dashboard.restock, [
    { variantId: "urgent", productTitle: "Brow Pomade", variantTitle: "Deep", countedStock: 5, dailyDemand: 1, forecastStockout: "2026-09-04", reorderBy: "2026-08-21", urgency: "overdue" },
    { variantId: "rose", productTitle: "Brow Pomade", variantTitle: "Rose", countedStock: 20, dailyDemand: 1, forecastStockout: "2026-09-19", reorderBy: "2026-09-05", urgency: "due-soon" },
  ]);
});
