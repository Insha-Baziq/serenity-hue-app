import type { KpiDashboard, KpiPeriod, KpiProductPerformance } from "./kpi-dashboard.ts";
import type { PhysicalChannelListing, PhysicalInventoryItem, PhysicalInventoryRunways } from "./types.ts";

export type ProductReportVariant = {
  id: string;
  title: string;
  sku: string;
  quantity: number | null;
  listings: Array<{ id: string; channel: "shopify" | "tiktok"; title: string; kind: "individual" | "bundle" | "unknown"; quantityPerSale: number }>;
};

export type ProductReportRow = {
  id: string;
  title: string;
  netUnits: number;
  netRevenue: number;
  shopifyUnits: number;
  tiktokUnits: number;
  comparison: { netUnitsDelta: number; netRevenueDelta: number } | null;
  physicalStock: number | null;
  channelQuantities: { shopify: number | null; tiktok: number | null };
  daysOfCover: number | null;
  coverageNote: string;
  variants: ProductReportVariant[];
};

export type ProductHealthReport = {
  mode: "all" | "single";
  title: string;
  generatedAt: string;
  range: KpiPeriod;
  comparisonRange: KpiPeriod | null;
  freshness: string | null;
  metrics: { netSales: number; netUnits: number; orders: number | null; averageOrderValue: number | null };
  previousMetrics: { netSales: number; netUnits: number; orders: number | null; averageOrderValue: number | null } | null;
  trendGranularity: "day" | "bucket";
  trendIntervalDays: number;
  trend: Array<{ date: string; netRevenue: number; netUnits: number }>;
  products: ProductReportRow[];
  bundleListings: Array<{ id: string; channel: "shopify" | "tiktok"; title: string; channelQuantity: number | null; components: PhysicalChannelListing["components"] }>;
  unmappedSales: { netUnits: number; netRevenue: number };
  observations: string[];
  dataNotes: { uncertainListings: number; unmappedListings: number; uncountedProducts: number };
  dataQuality: { refundEvents: number; refundedUnits: number; cancelledOrders: number };
};

function percentObservation(label: string, current: number, previous: number) {
  if (previous === 0) return `${label} was ${current.toLocaleString("en-GB")} in this period; the preceding period recorded zero.`;
  const change = ((current - previous) / Math.abs(previous)) * 100;
  return `${label} ${change >= 0 ? "increased" : "decreased"} ${Math.abs(change).toFixed(1)}% from the preceding period.`;
}

function averageEstimatedCover(item: PhysicalInventoryItem, runways: PhysicalInventoryRunways) {
  if (!item.quantityKnown) return { days: null, note: "Physical stock has not been fully counted." };
  const estimates = ([30, 60, 90] as const).flatMap((windowDays) => {
    const units = (runways[item.id]?.dailySales.slice(-windowDays) ?? []).reduce((total, day) => total + day.shopify + day.tiktok, 0);
    return units > 0 ? [Math.max(1, Math.floor(item.quantity / (units / windowDays)))] : [];
  });
  if (!estimates.length) return { days: null, note: "No mapped sales are available for a coverage calculation." };
  return { days: Math.floor(estimates.reduce((total, days) => total + days, 0) / estimates.length), note: estimates.length === 3 ? "Average of mapped 30, 60 and 90-day demand." : "Average of the available mapped demand windows." };
}

function relatedListings(item: PhysicalInventoryItem, listings: PhysicalChannelListing[]) {
  return listings.filter((listing) => listing.masterProductId === item.id || listing.components.some((component) => component.itemId === item.id));
}

function shownQuantity(listings: PhysicalChannelListing[], channel: "shopify" | "tiktok") {
  const relevant = listings.filter((listing) => listing.channel === channel && listing.channelQuantity !== null);
  return relevant.length ? relevant.reduce((total, listing) => total + (listing.channelQuantity ?? 0), 0) : null;
}

export function buildProductHealthReport(input: {
  dashboard: KpiDashboard;
  inventory: PhysicalInventoryItem[];
  listings: PhysicalChannelListing[];
  runways: PhysicalInventoryRunways;
  selectedProductId?: string;
  generatedAt?: string;
}): ProductHealthReport {
  const currentById = new Map((input.dashboard.allProducts ?? input.dashboard.products).map((product) => [product.id, product]));
  const previousById = new Map((input.dashboard.previousProducts ?? []).map((product) => [product.id, product]));
  const selectedInventory = input.selectedProductId ? input.inventory.filter((item) => item.id === input.selectedProductId) : input.inventory;
  const zero: KpiProductPerformance = { id: "", title: "", netUnits: 0, netRevenue: 0, shopifyUnits: 0, tiktokUnits: 0 };
  const products = selectedInventory.map((item): ProductReportRow => {
    const current = currentById.get(item.id) ?? zero;
    const previous = previousById.get(item.id);
    const listings = relatedListings(item, input.listings);
    const coverage = averageEstimatedCover(item, input.runways);
    return {
      id: item.id,
      title: item.title,
      netUnits: current.netUnits,
      netRevenue: current.netRevenue,
      shopifyUnits: current.shopifyUnits,
      tiktokUnits: current.tiktokUnits,
      comparison: input.dashboard.previous ? { netUnitsDelta: current.netUnits - (previous?.netUnits ?? 0), netRevenueDelta: current.netRevenue - (previous?.netRevenue ?? 0) } : null,
      physicalStock: item.quantityKnown ? item.quantity : null,
      channelQuantities: { shopify: shownQuantity(listings, "shopify"), tiktok: shownQuantity(listings, "tiktok") },
      daysOfCover: coverage.days,
      coverageNote: coverage.note,
      variants: item.variants.map((variant) => ({
        id: variant.id,
        title: variant.title,
        sku: variant.sku,
        quantity: variant.quantityKnown ? variant.quantity : null,
        listings: listings.flatMap((listing) => listing.components.filter((component) => component.physicalVariantId === variant.id).map((component) => ({ id: listing.id, channel: listing.channel, title: listing.title, kind: listing.kind, quantityPerSale: component.quantityPerSale }))),
      })),
    };
  }).sort((left, right) => right.netUnits - left.netUnits || right.netRevenue - left.netRevenue || left.title.localeCompare(right.title));
  const selectedIds = new Set(selectedInventory.map((item) => item.id));
  const bundleListings = input.listings.filter((listing) => listing.kind === "bundle" && listing.components.some((component) => selectedIds.has(component.itemId))).map((listing) => ({ id: listing.id, channel: listing.channel, title: listing.title, channelQuantity: listing.channelQuantity, components: listing.components }));
  const selectedCurrent = input.selectedProductId ? currentById.get(input.selectedProductId) ?? zero : null;
  const selectedPrevious = input.selectedProductId ? previousById.get(input.selectedProductId) ?? zero : null;
  const metrics = selectedCurrent
    ? { netSales: selectedCurrent.netRevenue, netUnits: selectedCurrent.netUnits, orders: null, averageOrderValue: null }
    : input.dashboard.metrics;
  const previousMetrics = input.dashboard.previous
    ? selectedPrevious
      ? { netSales: selectedPrevious.netRevenue, netUnits: selectedPrevious.netUnits, orders: null, averageOrderValue: null }
      : input.dashboard.previous.metrics
    : null;
  const observations = previousMetrics
    ? [percentObservation("Net merchandise revenue", metrics.netSales, previousMetrics.netSales), percentObservation("Net units", metrics.netUnits, previousMetrics.netUnits)]
    : [`The selected all-time period contains ${metrics.netUnits.toLocaleString("en-GB")} net units.`];
  observations.push(`${products.filter((product) => product.netUnits !== 0).length} of ${products.length} physical products recorded mapped net units in this period.`);
  return {
    mode: input.selectedProductId ? "single" : "all",
    title: input.selectedProductId && products[0] ? `${products[0].title} — Product Health Report` : "Product Health Report",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    range: input.dashboard.range,
    comparisonRange: input.dashboard.previous?.range ?? null,
    freshness: input.dashboard.freshness,
    metrics,
    previousMetrics,
    trendGranularity: input.dashboard.trendGranularity,
    trendIntervalDays: input.dashboard.trendIntervalDays,
    trend: input.selectedProductId
      ? input.dashboard.productTrends?.[input.selectedProductId] ?? []
      : [...new Set(Object.values(input.dashboard.productTrends ?? {}).flatMap((points) => points.map((point) => point.date)))].sort().map((date) => Object.values(input.dashboard.productTrends ?? {}).reduce((total, points) => {
          const point = points.find((entry) => entry.date === date);
          return { date, netRevenue: total.netRevenue + (point?.netRevenue ?? 0), netUnits: total.netUnits + (point?.netUnits ?? 0) };
        }, { date, netRevenue: 0, netUnits: 0 })),
    products,
    bundleListings,
    unmappedSales: input.dashboard.unassigned,
    observations,
    dataNotes: {
      uncertainListings: input.listings.filter((listing) => listing.mappingStatus === "review").length,
      unmappedListings: input.listings.filter((listing) => listing.mappingStatus === "unmapped").length,
      uncountedProducts: selectedInventory.filter((item) => !item.quantityKnown).length,
    },
    dataQuality: input.dashboard.dataQuality ?? { refundEvents: 0, refundedUnits: 0, cancelledOrders: 0 },
  };
}
