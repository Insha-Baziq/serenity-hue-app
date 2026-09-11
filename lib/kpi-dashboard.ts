export type KpiChannel = "shopify" | "tiktok";

export type KpiProductReference = { id: string; title: string };

export type KpiSaleLine = {
  id: string;
  quantity: number;
  unitPrice: number;
  product: KpiProductReference | null;
};

export type KpiCustomerIdentity = {
  name: string;
  email: string | null;
  phone: string | null;
};

export type KpiSale = {
  id: string;
  createdAt: string;
  channel: KpiChannel;
  financialStatus: string;
  cancelledAt: string | null;
  customer?: KpiCustomerIdentity | null;
  items: KpiSaleLine[];
};

export type KpiCustomerOrder = {
  id: string;
  createdAt: string;
  financialStatus: string;
  cancelledAt: string | null;
  customer: KpiCustomerIdentity | null;
};

export type KpiRefund = {
  orderId: string;
  lineItemId: string;
  quantity: number;
  processedAt: string;
};

export type KpiPeriod = { start: string; end: string; allTime?: boolean };

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

export type KpiCustomerPerformance = {
  summary: { new: number; repeat: number; total: number };
  topCustomers: Array<{ name: string; netSpend: number; qualifyingOrders: number; latestPurchase: string }>;
};

export type KpiRestockVariant = {
  id: string;
  productTitle: string;
  variantTitle: string;
  countedStock: number | null;
  leadTimeDays: number | null;
  firstPaidSaleAt: string | null;
};

export type KpiRestockDemandLine = {
  orderId: string;
  lineItemId: string;
  variantId: string;
  createdAt: string;
  financialStatus: string;
  cancelledAt: string | null;
  quantity: number;
  quantityPerSale: number;
};

export type KpiRestockPlan = {
  variantId: string;
  productTitle: string;
  variantTitle: string;
  countedStock: number;
  dailyDemand: number;
  forecastStockout: string;
  reorderBy: string;
  urgency: "overdue" | "due-soon";
};

export type KpiDashboard = {
  range: KpiPeriod;
  previous: { range: KpiPeriod; metrics: KpiMetricSet } | null;
  metrics: KpiMetricSet;
  trendGranularity: "day" | "bucket";
  trendIntervalDays: number;
  trend: Array<{ date: string; netSales: number; orders: number }>;
  /**
   * The preceding period bucketed on the same interval, so chart point `i`
   * compares like for like. Empty when the selected range is all time, which
   * has no preceding period to compare against.
   */
  previousTrend: Array<{ date: string; netSales: number; orders: number }>;
  products: KpiProductPerformance[];
  unassigned: { netUnits: number; netRevenue: number };
  channels: KpiChannelPerformance[];
  customers: KpiCustomerPerformance;
  restock: KpiRestockPlan[];
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
const MAX_DAILY_TREND_POINTS = 366;
const MAX_BUCKETED_TREND_POINTS = 180;
/** Rows retained for the dedicated Products and Customers reporting tabs. */
const PRODUCT_LIMIT = 50;
const TOP_CUSTOMER_LIMIT = 20;

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

function eligibleCustomerOrder(order: KpiCustomerOrder) {
  return !order.cancelledAt && order.financialStatus !== "pending";
}

function normalizedEmail(value: string | null | undefined) {
  const email = value?.trim().toLowerCase() ?? "";
  return email || null;
}

function normalizedPhone(value: string | null | undefined) {
  const phone = value?.replace(/\D/g, "") ?? "";
  return phone || null;
}

function normalizedName(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function compatibleNames(left: string[], right: string[]) {
  if (left.length < 2 || right.length < 2) return false;
  if (left[0] !== right[0] || left.at(-1) !== right.at(-1)) return false;
  const leftMiddle = left.slice(1, -1);
  const rightMiddle = right.slice(1, -1);
  if (!leftMiddle.length || !rightMiddle.length) return true;
  return leftMiddle.some((token) => rightMiddle.some((other) => token === other || token[0] === other[0]));
}

type CustomerGroup = {
  id: string;
  orders: KpiCustomerOrder[];
  names: string[][];
  emails: Set<string>;
  phones: Set<string>;
};

function groupCustomers(orders: KpiCustomerOrder[]) {
  const groups: CustomerGroup[] = [];
  const groupByOrderId = new Map<string, CustomerGroup>();
  const emailGroups = new Map<string, CustomerGroup>();

  for (const order of orders.filter(eligibleCustomerOrder)) {
    const customer = order.customer;
    if (!customer) continue;
    const email = normalizedEmail(customer.email);
    const phone = normalizedPhone(customer.phone);
    const name = normalizedName(customer.name);
    let group: CustomerGroup | undefined;
    if (email) {
      group = emailGroups.get(email);
      if (!group) {
        // A no-email order may be safely connected to this email identity only when
        // it already has the same phone and a compatible name. Never bridge two
        // distinct email identities through shared household contact details.
        group = phone && name.length >= 2
          ? groups.find((candidate) => candidate.emails.size === 0 && candidate.phones.has(phone) && candidate.names.some((candidateName) => compatibleNames(candidateName, name)))
          : undefined;
        if (!group) {
          group = { id: `email:${email}`, orders: [], names: [], emails: new Set(), phones: new Set() };
          groups.push(group);
        }
        emailGroups.set(email, group);
      }
      group.emails.add(email);
    } else if (phone && name.length >= 2) {
      group = groups.find((candidate) => candidate.phones.has(phone) && candidate.names.some((candidateName) => compatibleNames(candidateName, name)));
      if (!group) {
        group = { id: `phone:${phone}:${name.join("-")}`, orders: [], names: [], emails: new Set(), phones: new Set() };
        groups.push(group);
      }
    }
    if (!group) continue;
    group.orders.push(order);
    if (name.length) group.names.push(name);
    if (phone) group.phones.add(phone);
    groupByOrderId.set(order.id, group);
  }
  return { groups, groupByOrderId };
}

function buildCustomerPerformance(input: {
  range: KpiPeriod;
  sales: KpiSale[];
  refunds: KpiRefund[];
  customerOrders: KpiCustomerOrder[];
}): KpiCustomerPerformance {
  const ordersById = new Map(input.customerOrders.map((order) => [order.id, order]));
  for (const sale of input.sales) {
    if (!ordersById.has(sale.id)) ordersById.set(sale.id, {
      id: sale.id,
      createdAt: sale.createdAt,
      financialStatus: sale.financialStatus,
      cancelledAt: sale.cancelledAt,
      customer: sale.customer ?? null,
    });
  }
  const { groups, groupByOrderId } = groupCustomers([...ordersById.values()]);
  const activeGroups = groups.filter((group) => group.orders.some((order) => contains(input.range, londonDate(order.createdAt))));
  const spendByGroup = new Map(activeGroups.map((group) => [group.id, 0]));
  const sourceLines = new Map<string, { sale: KpiSale; line: KpiSaleLine }>();

  for (const sale of input.sales) {
    for (const line of sale.items) sourceLines.set(`${sale.id}:${line.id}`, { sale, line });
    if (!eligibleSale(sale) || !contains(input.range, londonDate(sale.createdAt))) continue;
    const group = groupByOrderId.get(sale.id);
    if (!group || !spendByGroup.has(group.id)) continue;
    spendByGroup.set(group.id, (spendByGroup.get(group.id) ?? 0) + sale.items.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0));
  }

  const refundedByLine = new Map<string, number>();
  for (const refund of [...input.refunds].sort((left, right) => left.processedAt.localeCompare(right.processedAt))) {
    if (!contains(input.range, londonDate(refund.processedAt))) continue;
    const key = `${refund.orderId}:${refund.lineItemId}`;
    const source = sourceLines.get(key);
    if (!source || !eligibleSale(source.sale)) continue;
    const group = groupByOrderId.get(source.sale.id);
    if (!group || !spendByGroup.has(group.id)) continue;
    const alreadyRefunded = refundedByLine.get(key) ?? 0;
    const units = Math.max(0, Math.min(refund.quantity, source.line.quantity - alreadyRefunded));
    if (!units) continue;
    refundedByLine.set(key, alreadyRefunded + units);
    spendByGroup.set(group.id, (spendByGroup.get(group.id) ?? 0) - units * source.line.unitPrice);
  }

  const topCustomers = activeGroups.map((group) => {
    const activeOrders = group.orders.filter((order) => contains(input.range, londonDate(order.createdAt)));
    const latest = [...activeOrders].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]!;
    return {
      name: latest.customer?.name.trim() || "Unnamed customer",
      netSpend: spendByGroup.get(group.id) ?? 0,
      qualifyingOrders: group.orders.length,
      latestPurchase: londonDate(latest.createdAt),
    };
  }).sort((left, right) => right.netSpend - left.netSpend || right.qualifyingOrders - left.qualifyingOrders || right.latestPurchase.localeCompare(left.latestPurchase) || left.name.localeCompare(right.name)).slice(0, TOP_CUSTOMER_LIMIT);

  const repeat = activeGroups.filter((group) => group.orders.length > 1).length;
  return { summary: { new: activeGroups.length - repeat, repeat, total: activeGroups.length }, topCustomers };
}

function buildRestockPlan(restock: { today: string; variants: KpiRestockVariant[]; demandLines: KpiRestockDemandLine[] }, refunds: KpiRefund[]) {
  const demandStart = shiftDate(restock.today, -89);
  const demandByVariant = new Map<string, number>();
  const sourceQuantity = new Map<string, number>();
  for (const line of restock.demandLines) sourceQuantity.set(`${line.orderId}:${line.lineItemId}`, Math.max(sourceQuantity.get(`${line.orderId}:${line.lineItemId}`) ?? 0, line.quantity));
  const refundedByLine = new Map<string, number>();
  for (const refund of [...refunds].sort((left, right) => left.processedAt.localeCompare(right.processedAt))) {
    if (!contains({ start: demandStart, end: restock.today }, londonDate(refund.processedAt))) continue;
    const key = `${refund.orderId}:${refund.lineItemId}`;
    const maximum = sourceQuantity.get(key) ?? 0;
    const alreadyRefunded = refundedByLine.get(key) ?? 0;
    refundedByLine.set(key, alreadyRefunded + Math.max(0, Math.min(refund.quantity, maximum - alreadyRefunded)));
  }
  for (const line of restock.demandLines) {
    if (line.cancelledAt || line.financialStatus === "pending") continue;
    const saleIsInWindow = contains({ start: demandStart, end: restock.today }, londonDate(line.createdAt));
    const refundUnits = refundedByLine.get(`${line.orderId}:${line.lineItemId}`) ?? 0;
    const next = (saleIsInWindow ? line.quantity : 0) - refundUnits;
    demandByVariant.set(line.variantId, (demandByVariant.get(line.variantId) ?? 0) + next * line.quantityPerSale);
  }

  return restock.variants.flatMap((variant) => {
    const demand = demandByVariant.get(variant.id) ?? 0;
    const firstSale = variant.firstPaidSaleAt ? londonDate(variant.firstPaidSaleAt) : null;
    if (variant.countedStock === null || variant.leadTimeDays === null || variant.leadTimeDays < 0 || !firstSale || firstSale > shiftDate(restock.today, -30) || demand <= 0) return [];
    const dailyDemand = demand / 90;
    const stockoutDays = Math.ceil(variant.countedStock / dailyDemand);
    const forecastStockout = shiftDate(restock.today, stockoutDays);
    const reorderBy = shiftDate(forecastStockout, -(variant.leadTimeDays + 7));
    if (reorderBy > shiftDate(restock.today, 30)) return [];
    return [{
      variantId: variant.id,
      productTitle: variant.productTitle,
      variantTitle: variant.variantTitle,
      countedStock: variant.countedStock,
      dailyDemand,
      forecastStockout,
      reorderBy,
      urgency: reorderBy < restock.today ? "overdue" as const : "due-soon" as const,
    }];
  }).sort((left, right) => left.reorderBy.localeCompare(right.reorderBy) || left.productTitle.localeCompare(right.productTitle) || left.variantTitle.localeCompare(right.variantTitle));
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
  customerOrders?: KpiCustomerOrder[];
  restock?: { today: string; variants: KpiRestockVariant[]; demandLines: KpiRestockDemandLine[] };
  freshness: string | null;
}): KpiDashboard {
  const previousRange = input.range.allTime ? null : precedingRange(input.range);
  const selected = createAccumulator();
  const previous = createAccumulator();
  const lineByKey = new Map<string, { sale: KpiSale; line: KpiSaleLine }>();
  const trend = new Map<string, { netSales: number; orders: number }>();
  const rangeDays = dayCount(input.range);
  const trendIntervalDays = rangeDays <= MAX_DAILY_TREND_POINTS
    ? 1
    : Math.ceil(rangeDays / MAX_BUCKETED_TREND_POINTS);
  const trendGranularity = trendIntervalDays === 1 ? "day" : "bucket";
  const trendKey = (date: string) => {
    const offset = Math.floor((Date.parse(`${date}T00:00:00.000Z`) - Date.parse(`${input.range.start}T00:00:00.000Z`)) / 86_400_000);
    return shiftDate(input.range.start, Math.floor(offset / trendIntervalDays) * trendIntervalDays);
  };

  const previousTrend = new Map<string, { netSales: number; orders: number }>();
  const previousTrendKey = (date: string) => {
    if (!previousRange) return null;
    const offset = Math.floor((Date.parse(`${date}T00:00:00.000Z`) - Date.parse(`${previousRange.start}T00:00:00.000Z`)) / 86_400_000);
    return shiftDate(previousRange.start, Math.floor(offset / trendIntervalDays) * trendIntervalDays);
  };

  for (let offset = 0; offset < rangeDays; offset += trendIntervalDays) {
    trend.set(shiftDate(input.range.start, offset), { netSales: 0, orders: 0 });
    if (previousRange) previousTrend.set(shiftDate(previousRange.start, offset), { netSales: 0, orders: 0 });
  }

  const addTrend = (accumulator: PeriodAccumulator, date: string, netSales: number, orders: number) => {
    const target = accumulator === selected ? trend : previousTrend;
    const key = accumulator === selected ? trendKey(date) : previousTrendKey(date);
    if (key === null) return;
    const values = target.get(key) ?? { netSales: 0, orders: 0 };
    values.netSales += netSales;
    values.orders += orders;
    target.set(key, values);
  };

  for (const sale of input.sales) {
    for (const line of sale.items) lineByKey.set(`${sale.id}:${line.id}`, { sale, line });
    if (!eligibleSale(sale)) continue;
    const date = londonDate(sale.createdAt);
    const accumulator = contains(input.range, date) ? selected : previousRange && contains(previousRange, date) ? previous : null;
    if (!accumulator) continue;
    accumulator.orders += 1;
    accumulator.channels.get(sale.channel)!.orders += 1;
    addTrend(accumulator, date, 0, 1);
    for (const line of sale.items) {
      updateLine(accumulator, line, sale.channel, line.quantity);
      addTrend(accumulator, date, line.quantity * line.unitPrice, 0);
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
    const accumulator = contains(input.range, date) ? selected : previousRange && contains(previousRange, date) ? previous : null;
    if (!accumulator) continue;
    updateLine(accumulator, source.line, source.sale.channel, -units);
    addTrend(accumulator, date, -units * source.line.unitPrice, 0);
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
    previous: previousRange ? { range: previousRange, metrics: metricSet(previous) } : null,
    trendGranularity,
    trendIntervalDays,
    trend: [...trend.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, values]) => ({ date, ...values })),
    previousTrend: [...previousTrend.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, values]) => ({ date, ...values })),
    products: [...selected.products.values()]
      .filter((product) => product.netUnits !== 0 || product.netRevenue !== 0)
      .sort((left, right) => right.netUnits - left.netUnits || right.netRevenue - left.netRevenue || left.title.localeCompare(right.title))
      .slice(0, PRODUCT_LIMIT),
    unassigned: selected.unassigned,
    channels,
    customers: buildCustomerPerformance({ range: input.range, sales: input.sales, refunds: input.refunds, customerOrders: input.customerOrders ?? [] }),
    restock: input.restock ? buildRestockPlan(input.restock, input.refunds) : [],
    freshness: input.freshness,
  };
}
