import type { KpiProductPerformance, KpiRefund, KpiSale } from "./kpi-dashboard.ts";
import type { AffiliateOrder, AffiliateRefund, AffiliateVideo } from "./tiktok-affiliate-dashboard.ts";

export const KPI_REPORTING_TIME_ZONE = "Europe/London" as const;

export type ComparisonGrain = "week" | "month";
export type BestSellerMetric = "units" | "revenue";

export type ComparisonSpec = {
  grain: ComparisonGrain;
  periodCount: 2 | 3 | 4;
  anchorDate: string;
  timeZone: typeof KPI_REPORTING_TIME_ZONE;
};

export type PeriodIdentity = {
  key: string;
  label: string;
  start: string;
  end: string;
  calendarEnd: string;
  partial: boolean;
};

export type ProductComparisonPeriod = PeriodIdentity & {
  products: KpiProductPerformance[];
  unassigned: { netUnits: number; netRevenue: number };
  bestByUnits: KpiProductPerformance | null;
  bestByRevenue: KpiProductPerformance | null;
};

export type ProductComparisonRow = {
  id: string;
  title: string;
  periods: Record<string, KpiProductPerformance>;
  totals: KpiProductPerformance;
  latestChangeByUnits: number | null;
  latestChangeByRevenue: number | null;
};

export type KpiProductComparison = {
  spec: ComparisonSpec;
  periods: ProductComparisonPeriod[];
  products: ProductComparisonRow[];
};

export type AffiliateComparisonProduct = {
  id: string;
  title: string;
  netUnits: number;
  netRevenue: number;
};

export type AffiliatePeriodPerformance = {
  creatorId: string;
  creatorName: string;
  netSales: number;
  estimatedCommission: number;
  orders: number;
  units: number;
  publishedVideos: number;
  bestByUnits: AffiliateComparisonProduct | null;
  bestByRevenue: AffiliateComparisonProduct | null;
};

export type AffiliateComparisonPeriod = PeriodIdentity & {
  netSales: number;
  estimatedCommission: number;
  attributedOrders: number;
  units: number;
  publishedVideos: number;
  affiliates: AffiliatePeriodPerformance[];
};

export type OfferReviewStatus = "priority_review" | "watch" | "needs_more_activity";

export type AffiliateComparisonRow = {
  creatorId: string;
  creatorName: string;
  periods: Record<string, AffiliatePeriodPerformance>;
  netSales: number;
  estimatedCommission: number;
  orders: number;
  units: number;
  publishedVideos: number;
  activePeriods: number;
  /** Kept as a compatibility alias for existing weekly consumers. */
  activeWeeks: number;
  bestProduct: AffiliateComparisonProduct | null;
  latestNetSalesChange: number | null;
  offerReview: {
    status: OfferReviewStatus;
    reasons: string[];
  };
};

export type TikTokAffiliateComparison = {
  spec: ComparisonSpec;
  periods: AffiliateComparisonPeriod[];
  affiliates: AffiliateComparisonRow[];
};

type ProductAccumulator = {
  products: Map<string, KpiProductPerformance>;
  unassigned: { netUnits: number; netRevenue: number };
};

type AffiliateAccumulator = {
  netSales: number;
  estimatedCommission: number;
  orders: Set<string>;
  units: number;
  publishedVideos: number;
  affiliates: Map<string, AffiliateMutable>;
};

type AffiliateMutable = {
  creatorId: string;
  creatorName: string;
  netSales: number;
  estimatedCommission: number;
  orders: Set<string>;
  units: number;
  publishedVideos: number;
  products: Map<string, AffiliateComparisonProduct & { orders: Set<string> }>;
};

function assertCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Choose a valid comparison anchor date.");
  const parsed = new Date(`${value}T12:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error("Choose a valid comparison anchor date.");
  }
}

function assertSpec(spec: ComparisonSpec) {
  assertCalendarDate(spec.anchorDate);
  if (spec.timeZone !== KPI_REPORTING_TIME_ZONE) throw new Error("KPI comparisons use Europe/London calendar periods.");
  if (spec.grain === "week" && spec.periodCount !== 4) throw new Error("Weekly KPI comparisons require four calendar weeks.");
  if (spec.grain === "month" && spec.periodCount !== 2 && spec.periodCount !== 3) {
    throw new Error("Monthly KPI comparisons require two or three calendar months.");
  }
}

function shiftDate(date: string, offset: number) {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

function dayCount(start: string, end: string) {
  return Math.floor((Date.parse(`${end}T12:00:00.000Z`) - Date.parse(`${start}T12:00:00.000Z`)) / 86_400_000) + 1;
}

function startOfWeek(date: string) {
  const weekday = new Date(`${date}T12:00:00.000Z`).getUTCDay();
  return shiftDate(date, -((weekday + 6) % 7));
}

function startOfMonth(date: string) {
  return `${date.slice(0, 7)}-01`;
}

function shiftMonth(monthStart: string, offset: number) {
  const value = new Date(`${monthStart}T12:00:00.000Z`);
  value.setUTCMonth(value.getUTCMonth() + offset, 1);
  return value.toISOString().slice(0, 10);
}

function endOfMonth(monthStart: string) {
  return shiftDate(shiftMonth(monthStart, 1), -1);
}

function formatPeriodLabel(grain: ComparisonGrain, start: string, calendarEnd: string) {
  if (grain === "month") {
    return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })
      .format(new Date(`${start}T12:00:00.000Z`));
  }
  const startDate = new Date(`${start}T12:00:00.000Z`);
  const endDate = new Date(`${calendarEnd}T12:00:00.000Z`);
  const startLabel = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: startDate.getUTCMonth() === endDate.getUTCMonth() ? undefined : "short",
    timeZone: "UTC",
  }).format(startDate);
  const endLabel = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(endDate);
  return `${startLabel}–${endLabel}`;
}

export function comparisonPeriods(spec: ComparisonSpec): PeriodIdentity[] {
  assertSpec(spec);
  const currentStart = spec.grain === "week" ? startOfWeek(spec.anchorDate) : startOfMonth(spec.anchorDate);
  return Array.from({ length: spec.periodCount }, (_, index) => {
    const reverseIndex = spec.periodCount - index - 1;
    const start = spec.grain === "week" ? shiftDate(currentStart, -reverseIndex * 7) : shiftMonth(currentStart, -reverseIndex);
    const calendarEnd = spec.grain === "week" ? shiftDate(start, 6) : endOfMonth(start);
    const end = calendarEnd > spec.anchorDate ? spec.anchorDate : calendarEnd;
    return {
      key: `${spec.grain}-${start}`,
      label: formatPeriodLabel(spec.grain, start, calendarEnd),
      start,
      end,
      calendarEnd,
      // The newest bucket is the current in-progress business period. Even when
      // the anchor lands on Sunday/month-end, that day is not complete yet.
      partial: reverseIndex === 0 || end < calendarEnd,
    };
  });
}

export function comparisonDateRange(spec: ComparisonSpec) {
  const periods = comparisonPeriods(spec);
  return { start: periods[0]!.start, end: periods.at(-1)!.end };
}

function londonDate(iso: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: KPI_REPORTING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function periodForDate<T extends PeriodIdentity>(periods: T[], date: string) {
  return periods.find((period) => date >= period.start && date <= period.end);
}

function eligibleSale(sale: KpiSale) {
  return !sale.cancelledAt && sale.financialStatus !== "pending";
}

function productAccumulator(): ProductAccumulator {
  return { products: new Map(), unassigned: { netUnits: 0, netRevenue: 0 } };
}

function applyProductLine(target: ProductAccumulator, sale: KpiSale, line: KpiSale["items"][number], units: number) {
  if (!units) return;
  const revenue = units * line.unitPrice;
  if (!line.product) {
    target.unassigned.netUnits += units;
    target.unassigned.netRevenue += revenue;
    return;
  }
  const product = target.products.get(line.product.id) ?? {
    id: line.product.id,
    title: line.product.title,
    netUnits: 0,
    netRevenue: 0,
    shopifyUnits: 0,
    tiktokUnits: 0,
  };
  product.netUnits += units;
  product.netRevenue += revenue;
  if (sale.channel === "shopify") product.shopifyUnits += units;
  else product.tiktokUnits += units;
  target.products.set(product.id, product);
}

function sortedProducts(products: Iterable<KpiProductPerformance>) {
  return [...products]
    .filter((product) => product.netUnits !== 0 || product.netRevenue !== 0)
    .sort((left, right) => right.netUnits - left.netUnits || right.netRevenue - left.netRevenue || left.title.localeCompare(right.title, "en") || left.id.localeCompare(right.id, "en"));
}

function winner(products: KpiProductPerformance[], metric: BestSellerMetric) {
  const value = (product: KpiProductPerformance) => metric === "units" ? product.netUnits : product.netRevenue;
  const secondary = (product: KpiProductPerformance) => metric === "units" ? product.netRevenue : product.netUnits;
  return [...products]
    .filter((product) => value(product) > 0)
    .sort((left, right) => value(right) - value(left) || secondary(right) - secondary(left) || left.title.localeCompare(right.title, "en") || left.id.localeCompare(right.id, "en"))[0] ?? null;
}

function percentageChange(current: number, previous: number | undefined) {
  if (previous === undefined || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function aggregateProductPeriods(periods: PeriodIdentity[], sales: KpiSale[], refunds: KpiRefund[]) {
  const accumulators = new Map(periods.map((period) => [period.key, productAccumulator()]));
  const sourceByLine = new Map<string, { sale: KpiSale; line: KpiSale["items"][number] }>();
  for (const sale of sales) {
    for (const line of sale.items) sourceByLine.set(`${sale.id}:${line.id}`, { sale, line });
    if (!eligibleSale(sale)) continue;
    const period = periodForDate(periods, londonDate(sale.createdAt));
    if (!period) continue;
    const target = accumulators.get(period.key)!;
    for (const line of sale.items) applyProductLine(target, sale, line, line.quantity);
  }
  const refunded = new Map<string, number>();
  for (const refund of [...refunds].sort((left, right) => left.processedAt.localeCompare(right.processedAt))) {
    const key = `${refund.orderId}:${refund.lineItemId}`;
    const source = sourceByLine.get(key);
    if (!source || !eligibleSale(source.sale)) continue;
    const alreadyRefunded = refunded.get(key) ?? 0;
    const units = Math.max(0, Math.min(refund.quantity, source.line.quantity - alreadyRefunded));
    if (!units) continue;
    refunded.set(key, alreadyRefunded + units);
    const period = periodForDate(periods, londonDate(refund.processedAt));
    if (period) applyProductLine(accumulators.get(period.key)!, source.sale, source.line, -units);
  }
  return accumulators;
}

export function buildKpiProductComparison(input: { spec: ComparisonSpec; sales: KpiSale[]; refunds: KpiRefund[] }): KpiProductComparison {
  const identities = comparisonPeriods(input.spec);
  const accumulators = aggregateProductPeriods(identities, input.sales, input.refunds);
  const periods: ProductComparisonPeriod[] = identities.map((period) => {
    const accumulator = accumulators.get(period.key)!;
    const products = sortedProducts(accumulator.products.values());
    return {
      ...period,
      products,
      unassigned: accumulator.unassigned,
      bestByUnits: winner(products, "units"),
      bestByRevenue: winner(products, "revenue"),
    };
  });
  const rows = new Map<string, ProductComparisonRow>();
  for (const period of periods) for (const product of period.products) {
    const row = rows.get(product.id) ?? {
      id: product.id,
      title: product.title,
      periods: {},
      totals: { id: product.id, title: product.title, netUnits: 0, netRevenue: 0, shopifyUnits: 0, tiktokUnits: 0 },
      latestChangeByUnits: null,
      latestChangeByRevenue: null,
    };
    row.title = product.title;
    row.periods[period.key] = product;
    row.totals.netUnits += product.netUnits;
    row.totals.netRevenue += product.netRevenue;
    row.totals.shopifyUnits += product.shopifyUnits;
    row.totals.tiktokUnits += product.tiktokUnits;
    rows.set(product.id, row);
  }

  const latest = periods.at(-1)!;
  const previous = periods.at(-2)!;
  const elapsedDays = dayCount(latest.start, latest.end);
  const comparablePrevious: PeriodIdentity = latest.partial
    ? { ...previous, key: `${previous.key}-comparable`, end: shiftDate(previous.start, elapsedDays - 1) }
    : previous;
  const comparableAccumulator = aggregateProductPeriods([comparablePrevious], input.sales, input.refunds).get(comparablePrevious.key)!;
  for (const row of rows.values()) {
    const current = latest.products.find((product) => product.id === row.id);
    const prior = comparableAccumulator.products.get(row.id);
    row.latestChangeByUnits = percentageChange(current?.netUnits ?? 0, prior?.netUnits);
    row.latestChangeByRevenue = percentageChange(current?.netRevenue ?? 0, prior?.netRevenue);
  }

  return {
    spec: input.spec,
    periods,
    products: [...rows.values()].sort((left, right) => right.totals.netUnits - left.totals.netUnits || right.totals.netRevenue - left.totals.netRevenue || left.title.localeCompare(right.title, "en") || left.id.localeCompare(right.id, "en")),
  };
}

function eligibleAffiliate(order: AffiliateOrder) {
  return Boolean(order.linked && !order.linked.cancelledAt && order.linked.financialStatus !== "pending");
}

function affiliateIdentity(order: AffiliateOrder) {
  const id = order.creatorId?.trim() || order.creator?.trim() || "";
  const name = order.creatorName?.trim() || order.creator?.trim() || id;
  return { id, name };
}

function videoIdentity(video: AffiliateVideo) {
  const id = video.creatorId?.trim() || video.creator?.trim() || "";
  const name = video.creatorName?.trim() || video.creator?.trim() || id;
  return { id, name };
}

function affiliateProductIdentity(order: AffiliateOrder) {
  const id = order.productId?.trim() || order.product?.trim() || "";
  const title = order.productTitle?.trim() || order.product?.trim() || id;
  return { id, title };
}

function affiliateAccumulator(): AffiliateAccumulator {
  return { netSales: 0, estimatedCommission: 0, orders: new Set(), units: 0, publishedVideos: 0, affiliates: new Map() };
}

function mutableAffiliate(target: AffiliateAccumulator, creatorId: string, creatorName: string) {
  const affiliate = target.affiliates.get(creatorId) ?? {
    creatorId,
    creatorName,
    netSales: 0,
    estimatedCommission: 0,
    orders: new Set<string>(),
    units: 0,
    publishedVideos: 0,
    products: new Map(),
  };
  affiliate.creatorName = creatorName || affiliate.creatorName;
  target.affiliates.set(creatorId, affiliate);
  return affiliate;
}

function bestAffiliateProduct(products: Iterable<AffiliateComparisonProduct & { orders: Set<string> }>, metric: BestSellerMetric) {
  const list = [...products];
  const value = (product: AffiliateComparisonProduct) => metric === "units" ? product.netUnits : product.netRevenue;
  const secondary = (product: AffiliateComparisonProduct) => metric === "units" ? product.netRevenue : product.netUnits;
  const selected = list.filter((product) => value(product) > 0)
    .sort((left, right) => value(right) - value(left) || secondary(right) - secondary(left) || left.title.localeCompare(right.title, "en") || left.id.localeCompare(right.id, "en"))[0];
  return selected ? { id: selected.id, title: selected.title, netUnits: selected.netUnits, netRevenue: selected.netRevenue } : null;
}

function aggregateAffiliatePeriods(periods: PeriodIdentity[], orders: AffiliateOrder[], refunds: AffiliateRefund[], videos: AffiliateVideo[]) {
  const accumulators = new Map(periods.map((period) => [period.key, affiliateAccumulator()]));
  const sourceByLine = new Map(orders.map((order) => [`${order.orderId}:${order.lineItemId}`, order]));
  for (const order of orders) {
    if (!eligibleAffiliate(order)) continue;
    const creator = affiliateIdentity(order);
    if (!creator.id) continue;
    const period = periodForDate(periods, londonDate(order.createdAt));
    if (!period) continue;
    const target = accumulators.get(period.key)!;
    const affiliate = mutableAffiliate(target, creator.id, creator.name);
    target.netSales += order.grossAmount;
    target.estimatedCommission += order.estimatedCommission;
    target.orders.add(order.orderId);
    target.units += order.quantity;
    affiliate.netSales += order.grossAmount;
    affiliate.estimatedCommission += order.estimatedCommission;
    affiliate.orders.add(order.orderId);
    affiliate.units += order.quantity;
    const productIdentity = affiliateProductIdentity(order);
    if (productIdentity.id) {
      const product = affiliate.products.get(productIdentity.id) ?? { ...productIdentity, netUnits: 0, netRevenue: 0, orders: new Set<string>() };
      product.title = productIdentity.title || product.title;
      product.netUnits += order.quantity;
      product.netRevenue += order.grossAmount;
      product.orders.add(order.orderId);
      affiliate.products.set(product.id, product);
    }
  }
  const refunded = new Map<string, number>();
  for (const refund of [...refunds].sort((left, right) => left.processedAt.localeCompare(right.processedAt))) {
    const key = `${refund.orderId}:${refund.lineItemId}`;
    const order = sourceByLine.get(key);
    if (!order || !eligibleAffiliate(order)) continue;
    const creator = affiliateIdentity(order);
    if (!creator.id) continue;
    const alreadyRefunded = refunded.get(key) ?? 0;
    const quantity = Math.max(0, Math.min(refund.quantity, order.quantity - alreadyRefunded));
    if (!quantity) continue;
    refunded.set(key, alreadyRefunded + quantity);
    const period = periodForDate(periods, londonDate(refund.processedAt));
    if (!period) continue;
    const amount = order.quantity ? Math.round(order.grossAmount * quantity / order.quantity) : 0;
    const target = accumulators.get(period.key)!;
    const affiliate = mutableAffiliate(target, creator.id, creator.name);
    target.netSales -= amount;
    target.units -= quantity;
    affiliate.netSales -= amount;
    affiliate.units -= quantity;
    const productIdentity = affiliateProductIdentity(order);
    if (productIdentity.id) {
      const product = affiliate.products.get(productIdentity.id) ?? { ...productIdentity, netUnits: 0, netRevenue: 0, orders: new Set<string>() };
      product.netUnits -= quantity;
      product.netRevenue -= amount;
      affiliate.products.set(product.id, product);
    }
  }
  for (const video of videos) {
    if (!video.publishedAt) continue;
    const creator = videoIdentity(video);
    if (!creator.id) continue;
    const period = periodForDate(periods, londonDate(video.publishedAt));
    if (!period) continue;
    const target = accumulators.get(period.key)!;
    target.publishedVideos += 1;
    mutableAffiliate(target, creator.id, creator.name).publishedVideos += 1;
  }
  return accumulators;
}

function affiliatePerformance(value: AffiliateMutable): AffiliatePeriodPerformance {
  return {
    creatorId: value.creatorId,
    creatorName: value.creatorName,
    netSales: value.netSales,
    estimatedCommission: value.estimatedCommission,
    orders: value.orders.size,
    units: value.units,
    publishedVideos: value.publishedVideos,
    bestByUnits: bestAffiliateProduct(value.products.values(), "units"),
    bestByRevenue: bestAffiliateProduct(value.products.values(), "revenue"),
  };
}

export function buildTikTokAffiliateComparison(input: {
  spec: ComparisonSpec;
  orders: AffiliateOrder[];
  refunds: AffiliateRefund[];
  videos: AffiliateVideo[];
}): TikTokAffiliateComparison {
  if (input.spec.grain === "week" && input.spec.periodCount !== 4) throw new Error("Weekly affiliate comparisons require four calendar weeks.");
  if (input.spec.grain === "month" && input.spec.periodCount !== 2 && input.spec.periodCount !== 3) {
    throw new Error("Monthly affiliate comparisons require two or three calendar months.");
  }
  const identities = comparisonPeriods(input.spec);
  const accumulators = aggregateAffiliatePeriods(identities, input.orders, input.refunds, input.videos);
  const periods: AffiliateComparisonPeriod[] = identities.map((period) => {
    const value = accumulators.get(period.key)!;
    return {
      ...period,
      netSales: value.netSales,
      estimatedCommission: value.estimatedCommission,
      attributedOrders: value.orders.size,
      units: value.units,
      publishedVideos: value.publishedVideos,
      affiliates: [...value.affiliates.values()].map(affiliatePerformance)
        .sort((left, right) => right.netSales - left.netSales || right.orders - left.orders || left.creatorName.localeCompare(right.creatorName, "en") || left.creatorId.localeCompare(right.creatorId, "en")),
    };
  });
  const rows = new Map<string, AffiliateComparisonRow & { products: Map<string, AffiliateComparisonProduct> }>();
  for (const period of periods) for (const affiliate of period.affiliates) {
    const row = rows.get(affiliate.creatorId) ?? ({
      creatorId: affiliate.creatorId,
      creatorName: affiliate.creatorName,
      periods: {} as Record<string, AffiliatePeriodPerformance>,
      netSales: 0,
      estimatedCommission: 0,
      orders: 0,
      units: 0,
      publishedVideos: 0,
      activePeriods: 0,
      activeWeeks: 0,
      bestProduct: null,
      latestNetSalesChange: null,
      offerReview: { status: "needs_more_activity", reasons: [] },
      products: new Map<string, AffiliateComparisonProduct>(),
    } satisfies AffiliateComparisonRow & { products: Map<string, AffiliateComparisonProduct> });
    row.creatorName = affiliate.creatorName || row.creatorName;
    row.periods[period.key] = affiliate;
    row.netSales += affiliate.netSales;
    row.estimatedCommission += affiliate.estimatedCommission;
    row.orders += affiliate.orders;
    row.units += affiliate.units;
    row.publishedVideos += affiliate.publishedVideos;
    if (affiliate.netSales !== 0 || affiliate.orders > 0 || affiliate.units !== 0) row.activePeriods += 1;
    const sourceProducts = accumulators.get(period.key)!.affiliates.get(affiliate.creatorId)?.products.values() ?? [];
    for (const product of sourceProducts) {
      const total = row.products.get(product.id) ?? { id: product.id, title: product.title, netUnits: 0, netRevenue: 0 };
      total.title = product.title || total.title;
      total.netUnits += product.netUnits;
      total.netRevenue += product.netRevenue;
      row.products.set(product.id, total);
    }
    rows.set(affiliate.creatorId, row);
  }

  const latest = periods.at(-1)!;
  const previous = periods.at(-2)!;
  const elapsedDays = dayCount(latest.start, latest.end);
  const comparablePrevious: PeriodIdentity = latest.partial
    ? { ...previous, key: `${previous.key}-comparable`, end: shiftDate(previous.start, elapsedDays - 1) }
    : previous;
  const comparable = aggregateAffiliatePeriods([comparablePrevious], input.orders, input.refunds, input.videos).get(comparablePrevious.key)!;
  const rankedByRevenue = [...rows.values()].sort((left, right) => right.netSales - left.netSales || left.creatorId.localeCompare(right.creatorId, "en"));
  const rankedByOrders = [...rows.values()].sort((left, right) => right.orders - left.orders || left.creatorId.localeCompare(right.creatorId, "en"));
  const revenueRank = new Map(rankedByRevenue.map((row, index) => [row.creatorId, index + 1]));
  const orderRank = new Map(rankedByOrders.map((row, index) => [row.creatorId, index + 1]));

  const affiliates = [...rows.values()].map((row) => {
    const current = latest.affiliates.find((affiliate) => affiliate.creatorId === row.creatorId);
    const prior = comparable.affiliates.get(row.creatorId);
    row.latestNetSalesChange = percentageChange(current?.netSales ?? 0, prior?.netSales);
    row.bestProduct = [...row.products.values()]
      .filter((product) => product.netRevenue > 0)
      .sort((left, right) => right.netRevenue - left.netRevenue || right.netUnits - left.netUnits || left.title.localeCompare(right.title, "en") || left.id.localeCompare(right.id, "en"))[0] ?? null;
    const topFive = (revenueRank.get(row.creatorId) ?? Infinity) <= 5 || (orderRank.get(row.creatorId) ?? Infinity) <= 5;
    const priority = row.orders >= 3 && row.activePeriods >= 2 && topFive;
    const positive = row.netSales > 0 || row.orders > 0 || row.units > 0;
    const periodUnit = input.spec.grain === "week" ? "weeks" : "months";
    row.offerReview.status = priority ? "priority_review" : positive ? "watch" : "needs_more_activity";
    row.offerReview.reasons = priority
      ? [`#${Math.min(revenueRank.get(row.creatorId) ?? Infinity, orderRank.get(row.creatorId) ?? Infinity)} by revenue or orders`, `Active ${row.activePeriods} of ${periods.length} ${periodUnit}`, `${row.orders} attributed orders`]
      : positive
        ? [`Active ${row.activePeriods} of ${periods.length} ${periodUnit}`, `${row.orders} attributed orders`, "More consistent attributed activity is needed"]
        : [`No positive attributed activity in these ${periods.length} ${periodUnit}`];
    const result: AffiliateComparisonRow = {
      creatorId: row.creatorId,
      creatorName: row.creatorName,
      periods: row.periods,
      netSales: row.netSales,
      estimatedCommission: row.estimatedCommission,
      orders: row.orders,
      units: row.units,
      publishedVideos: row.publishedVideos,
      activePeriods: row.activePeriods,
      activeWeeks: row.activePeriods,
      bestProduct: row.bestProduct,
      latestNetSalesChange: row.latestNetSalesChange,
      offerReview: row.offerReview,
    };
    return result;
  }).sort((left, right) => right.netSales - left.netSales || right.orders - left.orders || left.creatorName.localeCompare(right.creatorName, "en") || left.creatorId.localeCompare(right.creatorId, "en"));

  return { spec: input.spec, periods, affiliates };
}
