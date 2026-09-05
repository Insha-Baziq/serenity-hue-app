import type { KpiPeriod } from "./kpi-dashboard.ts";

const REPORTING_TIME_ZONE = "Europe/London";

export type AffiliateOrder = {
  id: string;
  orderId: string;
  lineItemId: string;
  createdAt: string;
  quantity: number;
  grossAmount: number;
  estimatedCommission: number;
  creator: string | null;
  product?: string | null;
  linked: { financialStatus: string; cancelledAt: string | null } | null;
};

export type AffiliateRefund = { orderId: string; lineItemId: string; quantity: number; processedAt: string };
export type AffiliateVideo = { id: string; creator: string | null; publishedAt: string | null };
export type AffiliateRankingMode = "revenue" | "orders" | "commission";
export type AffiliatePerformance = {
  creator: string;
  netSales: number;
  estimatedCommission: number;
  orders: number;
  units: number;
  publishedVideos: number;
  bestSellingProduct: string | null;
  offerCandidate: "Review candidate" | "Needs more activity";
};

export type TikTokAffiliateDashboard = {
  range: KpiPeriod;
  previous: null;
  metrics: {
    netSales: number;
    estimatedCommission: number;
    attributedOrders: number;
    units: number;
    activeAffiliates: number;
    publishedVideos: number;
    unreconciledGmv: number;
  };
  trend: Array<{ date: string; netSales: number; orders: number }>;
  affiliates: AffiliatePerformance[];
  products: Array<{ product: string; netSales: number; units: number; orders: number }>;
  status: { kind: "fresh" | "stale" | "unavailable"; lastSuccessfulAt: string | null; message: string };
  historyNote: string;
};

function londonDate(iso: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: REPORTING_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso));
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function shiftDate(date: string, offset: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

function contains(range: KpiPeriod, date: string) {
  return date >= range.start && date <= range.end;
}

function eligible(order: AffiliateOrder) {
  return Boolean(order.linked && !order.linked.cancelledAt && order.linked.financialStatus !== "pending");
}

export function rankTikTokAffiliates(affiliates: AffiliatePerformance[], mode: AffiliateRankingMode) {
  const value = (affiliate: AffiliatePerformance) => mode === "revenue"
    ? affiliate.netSales
    : mode === "orders" ? affiliate.orders : affiliate.estimatedCommission;
  return [...affiliates].sort((left, right) => value(right) - value(left) || left.creator.localeCompare(right.creator, "en"));
}

export function buildTikTokAffiliateDashboard(input: {
  range: KpiPeriod;
  orders: AffiliateOrder[];
  refunds: AffiliateRefund[];
  videos: AffiliateVideo[];
  freshness: { lastSuccessfulAt: string | null; lastErrorAt: string | null } | null;
}): TikTokAffiliateDashboard {
  const trend = new Map<string, { netSales: number; orders: number }>();
  for (let date = input.range.start; date <= input.range.end; date = shiftDate(date, 1)) trend.set(date, { netSales: 0, orders: 0 });
  const sourceByKey = new Map(input.orders.map((order) => [`${order.orderId}:${order.lineItemId}`, order]));
  const refundedByKey = new Map<string, number>();
  const affiliateLines = new Map<string, { creator: string; product: string | null; netSales: number; estimatedCommission: number; quantity: number; orderId: string }>();
  const totals = { netSales: 0, estimatedCommission: 0, attributedOrders: new Set<string>(), units: 0, activeAffiliates: new Set<string>(), publishedVideos: 0, unreconciledGmv: 0 };

  for (const order of input.orders) {
    const date = londonDate(order.createdAt);
    if (!contains(input.range, date)) continue;
    if (!order.linked) {
      totals.unreconciledGmv += order.grossAmount;
      continue;
    }
    if (!eligible(order)) continue;
    totals.netSales += order.grossAmount;
    totals.estimatedCommission += order.estimatedCommission;
    totals.units += order.quantity;
    totals.attributedOrders.add(order.orderId);
    if (order.creator) totals.activeAffiliates.add(order.creator);
    const point = trend.get(date)!;
    point.netSales += order.grossAmount;
    point.orders += 1;
    if (order.creator) affiliateLines.set(order.id, { creator: order.creator, product: order.product ?? null, netSales: order.grossAmount, estimatedCommission: order.estimatedCommission, quantity: order.quantity, orderId: order.orderId });
  }

  for (const refund of [...input.refunds].sort((left, right) => left.processedAt.localeCompare(right.processedAt))) {
    const order = sourceByKey.get(`${refund.orderId}:${refund.lineItemId}`);
    if (!order || !eligible(order) || !contains(input.range, londonDate(refund.processedAt))) continue;
    const key = `${refund.orderId}:${refund.lineItemId}`;
    const alreadyRefunded = refundedByKey.get(key) ?? 0;
    const quantity = Math.max(0, Math.min(refund.quantity, order.quantity - alreadyRefunded));
    if (!quantity) continue;
    refundedByKey.set(key, alreadyRefunded + quantity);
    const amount = order.quantity ? Math.round(order.grossAmount * quantity / order.quantity) : 0;
    totals.netSales -= amount;
    totals.units -= quantity;
    const affiliateLine = affiliateLines.get(order.id);
    if (affiliateLine) {
      affiliateLine.netSales -= amount;
      affiliateLine.quantity -= quantity;
    }
    const point = trend.get(londonDate(refund.processedAt))!;
    point.netSales -= amount;
  }

  const videosByCreator = new Map<string, number>();
  for (const video of input.videos) if (video.publishedAt && contains(input.range, londonDate(video.publishedAt))) {
    totals.publishedVideos += 1;
    if (video.creator) videosByCreator.set(video.creator, (videosByCreator.get(video.creator) ?? 0) + 1);
  }
  const affiliateStats = new Map<string, { netSales: number; estimatedCommission: number; units: number; orders: Set<string>; products: Map<string, { netSales: number; units: number; orders: Set<string> }> }>();
  for (const line of affiliateLines.values()) {
    const stats = affiliateStats.get(line.creator) ?? { netSales: 0, estimatedCommission: 0, units: 0, orders: new Set<string>(), products: new Map() };
    stats.netSales += line.netSales;
    stats.estimatedCommission += line.estimatedCommission;
    stats.units += line.quantity;
    stats.orders.add(line.orderId);
    if (line.product) {
      const product = stats.products.get(line.product) ?? { netSales: 0, units: 0, orders: new Set<string>() };
      product.netSales += line.netSales;
      product.units += line.quantity;
      product.orders.add(line.orderId);
      stats.products.set(line.product, product);
    }
    affiliateStats.set(line.creator, stats);
  }
  const affiliates = [...affiliateStats.entries()].map(([creator, stats]) => {
    const bestSellingProduct = [...stats.products.entries()].sort(([leftName, left], [rightName, right]) => right.netSales - left.netSales || leftName.localeCompare(rightName, "en"))[0]?.[0] ?? null;
    return {
      creator, netSales: stats.netSales, estimatedCommission: stats.estimatedCommission,
      orders: stats.orders.size, units: stats.units, publishedVideos: videosByCreator.get(creator) ?? 0,
      bestSellingProduct, offerCandidate: stats.orders.size >= 3 ? "Review candidate" as const : "Needs more activity" as const,
    };
  });
  const products = new Map<string, { netSales: number; units: number; orders: Set<string> }>();
  for (const line of affiliateLines.values()) if (line.product) {
    const product = products.get(line.product) ?? { netSales: 0, units: 0, orders: new Set<string>() };
    product.netSales += line.netSales;
    product.units += line.quantity;
    product.orders.add(line.orderId);
    products.set(line.product, product);
  }
  const status = !input.freshness?.lastSuccessfulAt
    ? { kind: "unavailable" as const, lastSuccessfulAt: null, message: "Awaiting the first successful TikTok affiliate import." }
    : input.freshness.lastErrorAt && input.freshness.lastErrorAt > input.freshness.lastSuccessfulAt
      ? { kind: "stale" as const, lastSuccessfulAt: input.freshness.lastSuccessfulAt, message: "Showing the last successful affiliate snapshot while the latest refresh needs attention." }
      : { kind: "fresh" as const, lastSuccessfulAt: input.freshness.lastSuccessfulAt, message: "TikTok affiliate reporting is current from the latest successful snapshot." };

  return {
    range: input.range,
    previous: null,
    metrics: {
      netSales: totals.netSales,
      estimatedCommission: totals.estimatedCommission,
      attributedOrders: totals.attributedOrders.size,
      units: totals.units,
      activeAffiliates: totals.activeAffiliates.size,
      publishedVideos: totals.publishedVideos,
      unreconciledGmv: totals.unreconciledGmv,
    },
    trend: [...trend.entries()].map(([date, values]) => ({ date, ...values })),
    affiliates: rankTikTokAffiliates(affiliates, "revenue"),
    products: [...products.entries()]
      .map(([product, values]) => ({ product, netSales: values.netSales, units: values.units, orders: values.orders.size }))
      .sort((left, right) => right.netSales - left.netSales || left.product.localeCompare(right.product, "en")),
    status,
    historyNote: input.range.allTime
      ? "All time includes affiliate records retained by Serenity Hue from the initial provider baseline onward."
      : "Affiliate attribution comes from TikTok Shop seller affiliate records; unreconciled GMV is not included in net sales.",
  };
}
