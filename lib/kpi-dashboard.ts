export type KpiChannel = "shopify" | "tiktok";

export type KpiProductReference = { id: string; title: string };

export type KpiSaleLine = {
  id: string;
  quantity: number;
  unitPrice: number;
  product: KpiProductReference | null;
};

export type KpiSale = {
  id: string;
  createdAt: string;
  channel: KpiChannel;
  financialStatus: string;
  cancelledAt: string | null;
  items: KpiSaleLine[];
};

export type KpiRefund = {
  orderId: string;
  lineItemId: string;
  quantity: number;
  processedAt: string;
};

export type KpiPeriod = { start: string; end: string };

export type KpiMetricSet = {
  netSales: number;
  orders: number;
  averageOrderValue: number;
  netUnits: number;
};

export type KpiProductPerformance = {
  id: string;
  title: string;
  netUnits: number;
  netRevenue: number;
  shopifyUnits: number;
  tiktokUnits: number;
};

export type KpiChannelPerformance = {
  channel: KpiChannel;
  netSales: number;
  orders: number;
  averageOrderValue: number;
  netUnits: number;
  unitShare: number;
};

export type KpiDashboard = {
  range: KpiPeriod;
  previous: { range: KpiPeriod; metrics: KpiMetricSet };
  metrics: KpiMetricSet;
  trend: Array<{ date: string; netSales: number; orders: number }>;
  products: KpiProductPerformance[];
  unassigned: { netUnits: number; netRevenue: number };
  channels: KpiChannelPerformance[];
  freshness: string | null;
};

type PeriodAccumulator = {
  netSales: number;
  orders: number;
  netUnits: number;
  products: Map<string, KpiProductPerformance>;
  unassigned: { netUnits: number; netRevenue: number };
  channels: Map<KpiChannel, { netSales: number; orders: number; netUnits: number }>;
};

const REPORTING_TIME_ZONE = "Europe/London";

function londonDate(iso: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: REPORTING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function dayCount(range: KpiPeriod) {
  const start = Date.parse(`${range.start}T00:00:00.000Z`);
  const end = Date.parse(`${range.end}T00:00:00.000Z`);
  return Math.floor((end - start) / 86_400_000) + 1;
}

function shiftDate(date: string, offset: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

function precedingRange(range: KpiPeriod): KpiPeriod {
  const days = dayCount(range);
  return { start: shiftDate(range.start, -days), end: shiftDate(range.start, -1) };
}

function contains(range: KpiPeriod, date: string) {
  return date >= range.start && date <= range.end;
}

function createAccumulator(): PeriodAccumulator {
  return {
    netSales: 0,
    orders: 0,
    netUnits: 0,
    products: new Map(),
    unassigned: { netUnits: 0, netRevenue: 0 },
    channels: new Map([
      ["shopify", { netSales: 0, orders: 0, netUnits: 0 }],
      ["tiktok", { netSales: 0, orders: 0, netUnits: 0 }],
    ]),
  };
}

function metricSet(accumulator: PeriodAccumulator): KpiMetricSet {
  return {
    netSales: accumulator.netSales,
    orders: accumulator.orders,
    averageOrderValue: accumulator.orders ? Math.round(accumulator.netSales / accumulator.orders) : 0,
    netUnits: accumulator.netUnits,
  };
}

function updateProduct(
  accumulator: PeriodAccumulator,
  line: KpiSaleLine,
  channel: KpiChannel,
  units: number,
  revenue: number,
) {
  if (!line.product) {
    accumulator.unassigned.netUnits += units;
    accumulator.unassigned.netRevenue += revenue;
    return;
  }
  const product = accumulator.products.get(line.product.id) ?? {
    id: line.product.id,
    title: line.product.title,
    netUnits: 0,
    netRevenue: 0,
    shopifyUnits: 0,
    tiktokUnits: 0,
  };
  product.netUnits += units;
  product.netRevenue += revenue;
  if (channel === "shopify") product.shopifyUnits += units;
  else product.tiktokUnits += units;
  accumulator.products.set(product.id, product);
}

function updateLine(accumulator: PeriodAccumulator, line: KpiSaleLine, channel: KpiChannel, units: number) {
  if (!units) return;
  const revenue = units * line.unitPrice;
  accumulator.netSales += revenue;
  accumulator.netUnits += units;
  const channelTotals = accumulator.channels.get(channel)!;
  channelTotals.netSales += revenue;
  channelTotals.netUnits += units;
  updateProduct(accumulator, line, channel, units, revenue);
}

function eligibleSale(sale: KpiSale) {
  return !sale.cancelledAt && sale.financialStatus !== "pending";
}

/**
 * Applies sales on their purchase day and partial refunds on their processed
 * day. Inputs are already bounded by the repository query; this pure function
 * never touches persistence and is safe to exercise with a fixture.
 */
export function buildKpiDashboard(input: {
  range: KpiPeriod;
  sales: KpiSale[];
  refunds: KpiRefund[];
  freshness: string | null;
}): KpiDashboard {
  const previousRange = precedingRange(input.range);
  const selected = createAccumulator();
  const previous = createAccumulator();
  const lineByKey = new Map<string, { sale: KpiSale; line: KpiSaleLine }>();
  const trend = new Map<string, { netSales: number; orders: number }>();

  for (let offset = 0; offset < dayCount(input.range); offset += 1) {
    trend.set(shiftDate(input.range.start, offset), { netSales: 0, orders: 0 });
  }

  for (const sale of input.sales) {
    for (const line of sale.items) lineByKey.set(`${sale.id}:${line.id}`, { sale, line });
    if (!eligibleSale(sale)) continue;
    const date = londonDate(sale.createdAt);
    const accumulator = contains(input.range, date) ? selected : contains(previousRange, date) ? previous : null;
    if (!accumulator) continue;
    accumulator.orders += 1;
    accumulator.channels.get(sale.channel)!.orders += 1;
    if (accumulator === selected) trend.get(date)!.orders += 1;
    for (const line of sale.items) {
      updateLine(accumulator, line, sale.channel, line.quantity);
      if (accumulator === selected) trend.get(date)!.netSales += line.quantity * line.unitPrice;
    }
  }

  const refundedByLine = new Map<string, number>();
  const refunds = [...input.refunds].sort((left, right) => left.processedAt.localeCompare(right.processedAt));
  for (const refund of refunds) {
    const source = lineByKey.get(`${refund.orderId}:${refund.lineItemId}`);
    if (!source || !eligibleSale(source.sale)) continue;
    const alreadyRefunded = refundedByLine.get(`${refund.orderId}:${refund.lineItemId}`) ?? 0;
    const units = Math.max(0, Math.min(refund.quantity, source.line.quantity - alreadyRefunded));
    if (!units) continue;
    refundedByLine.set(`${refund.orderId}:${refund.lineItemId}`, alreadyRefunded + units);
    const date = londonDate(refund.processedAt);
    const accumulator = contains(input.range, date) ? selected : contains(previousRange, date) ? previous : null;
    if (!accumulator) continue;
    updateLine(accumulator, source.line, source.sale.channel, -units);
    if (accumulator === selected) trend.get(date)!.netSales -= units * source.line.unitPrice;
  }

  const channels: KpiChannelPerformance[] = (["shopify", "tiktok"] as const).map((channel) => {
    const totals = selected.channels.get(channel)!;
    return {
      channel,
      netSales: totals.netSales,
      orders: totals.orders,
      averageOrderValue: totals.orders ? Math.round(totals.netSales / totals.orders) : 0,
      netUnits: totals.netUnits,
      unitShare: selected.netUnits ? totals.netUnits / selected.netUnits : 0,
    };
  });

  return {
    range: input.range,
    metrics: metricSet(selected),
    previous: { range: previousRange, metrics: metricSet(previous) },
    trend: [...trend.entries()].map(([date, values]) => ({ date, ...values })),
    products: [...selected.products.values()]
      .filter((product) => product.netUnits !== 0 || product.netRevenue !== 0)
      .sort((left, right) => right.netUnits - left.netUnits || right.netRevenue - left.netRevenue || left.title.localeCompare(right.title))
      .slice(0, 10),
    unassigned: selected.unassigned,
    channels,
    freshness: input.freshness,
  };
}
