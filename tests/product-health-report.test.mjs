import assert from "node:assert/strict";
import test from "node:test";
import { buildProductHealthReport } from "../lib/product-health-report.ts";

const dashboard = {
  range: { start: "2026-08-15", end: "2026-09-13" },
  metrics: { netSales: 27000, orders: 9, averageOrderValue: 3000, netUnits: 12 },
  previous: { range: { start: "2026-07-16", end: "2026-08-14" }, metrics: { netSales: 20000, orders: 8, averageOrderValue: 2500, netUnits: 10 } },
  trendGranularity: "day",
  trendIntervalDays: 1,
  trend: [{ date: "2026-09-12", netSales: 9000, orders: 3 }, { date: "2026-09-13", netSales: 18000, orders: 6 }],
  previousTrend: [],
  productTrends: {
    brow: [{ date: "2026-09-12", netRevenue: 19000, netUnits: 8 }],
    serum: [{ date: "2026-09-13", netRevenue: 8000, netUnits: 4 }],
  },
  products: [
    { id: "brow", title: "Brow Pomade", netUnits: 8, netRevenue: 19000, shopifyUnits: 5, tiktokUnits: 3 },
    { id: "serum", title: "Lash Serum", netUnits: 4, netRevenue: 8000, shopifyUnits: 4, tiktokUnits: 0 },
  ],
  previousProducts: [
    { id: "brow", title: "Brow Pomade", netUnits: 5, netRevenue: 12000, shopifyUnits: 4, tiktokUnits: 1 },
    { id: "serum", title: "Lash Serum", netUnits: 5, netRevenue: 8000, shopifyUnits: 5, tiktokUnits: 0 },
  ],
  unassigned: { netUnits: 2, netRevenue: 3000 },
  dataQuality: { refundEvents: 1, refundedUnits: 2, cancelledOrders: 3 },
  channels: [], customers: { summary: { new: 0, repeat: 0, total: 0 }, topCustomers: [] }, restock: [], freshness: "2026-09-13T10:00:00.000Z",
};

const inventory = [
  { id: "brow", title: "Brow Pomade", variantLabel: "Shade", quantity: 10, quantityKnown: true, variantCount: 2, packagingType: "Jar", reorderPoint: 0, leadTimeDays: 14, imageUrl: null, imageTone: "blush", variants: [
    { id: "deep", title: "Deep", sku: "BP-D", quantity: 6, quantityKnown: true },
    { id: "dark", title: "Dark", sku: "BP-K", quantity: 4, quantityKnown: true },
  ] },
  { id: "serum", title: "Lash Serum", variantLabel: "Size", quantity: 0, quantityKnown: false, variantCount: 1, packagingType: "Tube", reorderPoint: 0, leadTimeDays: null, imageUrl: null, imageTone: "rose", variants: [
    { id: "serum-variant", title: "Default", sku: "", quantity: 0, quantityKnown: false },
  ] },
];

const listings = [
  { id: "shop-brow", channel: "shopify", externalProductId: "1", externalVariantId: "11", title: "Brow Pomade", variantTitle: "Deep", imageUrl: null, listingUrl: null, channelQuantity: 7, kind: "individual", masterProductId: "brow", masterProductTitle: "Brow Pomade", mappingStatus: "confirmed", sourceNote: "", components: [{ id: "c1", physicalVariantId: "deep", itemId: "brow", itemTitle: "Brow Pomade", variantTitle: "Deep", quantityPerSale: 1 }] },
  { id: "tik-bundle", channel: "tiktok", externalProductId: "2", externalVariantId: null, title: "Brow Duo", variantTitle: "", imageUrl: null, listingUrl: null, channelQuantity: 5, kind: "bundle", masterProductId: null, masterProductTitle: null, mappingStatus: "confirmed", sourceNote: "", components: [
    { id: "c2", physicalVariantId: "deep", itemId: "brow", itemTitle: "Brow Pomade", variantTitle: "Deep", quantityPerSale: 1 },
    { id: "c3", physicalVariantId: "serum-variant", itemId: "serum", itemTitle: "Lash Serum", variantTitle: "Default", quantityPerSale: 1 },
  ] },
  { id: "tik-unknown", channel: "tiktok", externalProductId: "3", externalVariantId: null, title: "Uncertain Brow", variantTitle: "", imageUrl: null, listingUrl: null, channelQuantity: 4, kind: "unknown", masterProductId: null, masterProductTitle: null, mappingStatus: "review", sourceNote: "Shade is not defensible", components: [] },
];

test("product health report composes performance, separate stock, comparisons, bundle components and explicit unavailable states", () => {
  const report = buildProductHealthReport({ dashboard, inventory, listings, runways: {
    brow: { daysAvailable: 90, generatedAt: "2026-09-13T10:00:00.000Z", dailySales: Array.from({ length: 90 }, (_, index) => ({ date: `day-${index}`, shopify: index >= 60 ? 1 : 0, tiktok: 0 })) },
  }, generatedAt: "2026-09-13T12:00:00.000Z" });

  assert.equal(report.mode, "all");
  assert.equal(report.products.length, 2);
  assert.deepEqual(report.products[0].comparison, { netUnitsDelta: 3, netRevenueDelta: 7000 });
  assert.equal(report.products[0].physicalStock, 10);
  assert.deepEqual(report.products[0].channelQuantities, { shopify: 7, tiktok: 5 });
  assert.equal(report.products[0].daysOfCover, 20);
  assert.equal(report.products[1].physicalStock, null);
  assert.equal(report.products[1].daysOfCover, null);
  assert.equal(report.bundleListings[0].components.length, 2);
  assert.equal(report.dataNotes.uncertainListings, 1);
  assert.deepEqual(report.unmappedSales, { netUnits: 2, netRevenue: 3000 });
  assert.deepEqual(report.dataQuality, { refundEvents: 1, refundedUnits: 2, cancelledOrders: 3 });
  assert.ok(report.observations.every((observation) => !/recommend|priority|should|buy/i.test(observation)));
});

test("single-product mode adapts the report without hiding its related bundle contribution", () => {
  const report = buildProductHealthReport({ dashboard, inventory, listings, runways: {}, selectedProductId: "serum", generatedAt: "2026-09-13T12:00:00.000Z" });

  assert.equal(report.mode, "single");
  assert.equal(report.title, "Lash Serum — Product Health Report");
  assert.deepEqual(report.products.map((product) => product.id), ["serum"]);
  assert.deepEqual(report.bundleListings.map((listing) => listing.id), ["tik-bundle"]);
  assert.equal(report.products[0].variants[0].quantity, null);
  assert.deepEqual(report.metrics, { netSales: 8000, netUnits: 4, orders: null, averageOrderValue: null });
  assert.deepEqual(report.trend, [{ date: "2026-09-13", netRevenue: 8000, netUnits: 4 }]);
});
