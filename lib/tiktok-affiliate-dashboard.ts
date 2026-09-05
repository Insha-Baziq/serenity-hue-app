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
  linked: { financialStatus: string; cancelledAt: string | null } | null;
};

export type AffiliateRefund = { orderId: string; lineItemId: string; quantity: number; processedAt: string };
export type AffiliateVideo = { id: string; creator: string | null; publishedAt: string | null };

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
    const point = trend.get(londonDate(refund.processedAt))!;
    point.netSales -= amount;
  }

  for (const video of input.videos) if (video.publishedAt && contains(input.range, londonDate(video.publishedAt))) totals.publishedVideos += 1;
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
    status,
    historyNote: input.range.allTime
      ? "All time includes affiliate records retained by Serenity Hue from the initial provider baseline onward."
      : "Affiliate attribution comes from TikTok Shop seller affiliate records; unreconciled GMV is not included in net sales.",
  };
}
