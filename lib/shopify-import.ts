import { getTursoClient } from "@/lib/turso";
import { shopifyGraphql } from "@/lib/shopify";

type PageInfo = { hasNextPage: boolean; endCursor: string | null };
type Connection<TNode> = { nodes: TNode[]; pageInfo: PageInfo };
type MoneySet = { shopMoney: { amount: string; currencyCode: string } | null } | null;

type ShopifyOrder = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  email: string | null;
  phone: string | null;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null;
  subtotalPriceSet: MoneySet;
  totalShippingPriceSet: MoneySet;
  totalTaxSet: MoneySet;
  totalPriceSet: MoneySet;
  customer: { displayName: string; email: string | null; phone: string | null } | null;
  shippingAddress: {
    name: string | null;
    address1: string | null;
    address2: string | null;
    city: string | null;
    province: string | null;
    zip: string | null;
    country: string | null;
    phone: string | null;
  } | null;
  lineItems: Connection<{
    id: string;
    title: string;
    variantTitle: string | null;
    sku: string | null;
    quantity: number;
    originalUnitPriceSet: MoneySet;
    image: { url: string } | null;
    variant: { id: string; sku: string | null; product: { id: string } | null } | null;
  }>;
  refunds: Array<{
    id: string;
    processedAt: string | null;
    refundLineItems: Connection<{
      id: string;
      quantity: number;
      restocked: boolean;
      restockType: string;
      lineItem: { id: string };
    }>;
  }>;
};

type ShopifyVariant = {
  id: string;
  title: string;
  sku: string | null;
  inventoryQuantity: number | null;
  updatedAt: string;
  image: { url: string } | null;
  product: { id: string; title: string; handle: string | null; featuredMedia: { preview: { image: { url: string } | null } | null } | null };
};

const ORDER_FIELDS = `
  id name createdAt updatedAt cancelledAt email phone displayFinancialStatus displayFulfillmentStatus
  subtotalPriceSet { shopMoney { amount currencyCode } }
  totalShippingPriceSet { shopMoney { amount currencyCode } }
  totalTaxSet { shopMoney { amount currencyCode } }
  totalPriceSet { shopMoney { amount currencyCode } }
  customer { displayName email phone }
  shippingAddress { name address1 address2 city province zip country phone }
  lineItems(first: 250) {
    nodes {
      id title variantTitle sku quantity image { url }
      originalUnitPriceSet { shopMoney { amount currencyCode } }
      variant { id sku product { id } }
    }
    pageInfo { hasNextPage endCursor }
  }
  refunds {
      id processedAt
      refundLineItems(first: 250) {
        nodes { id quantity restocked restockType lineItem { id } }
        pageInfo { hasNextPage endCursor }
      }
  }
`;

const ORDERS_QUERY = `
  query OperationsOrders($cursor: String, $query: String) {
    orders(first: 100, after: $cursor, sortKey: UPDATED_AT, query: $query) {
      nodes { ${ORDER_FIELDS} }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const ORDERS_BY_IDS_QUERY = `
  query OperationsOrdersByIds($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Order { ${ORDER_FIELDS} }
    }
  }
`;

const VARIANTS_QUERY = `
  query OperationsVariants($cursor: String, $query: String) {
    productVariants(first: 100, after: $cursor, query: $query) {
      nodes {
        id title sku inventoryQuantity updatedAt image { url }
        product {
          id title handle
          featuredMedia { preview { image { url } } }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

function moneyInCents(moneySet: MoneySet) {
  const amount = moneySet?.shopMoney?.amount;
  return amount ? Math.round(Number.parseFloat(amount) * 100) : 0;
}

function currency(moneySet: MoneySet) {
  return moneySet?.shopMoney?.currencyCode ?? "GBP";
}

function paymentStatus(status: string | null) {
  if (status?.includes("REFUNDED")) return "refunded";
  return status?.includes("PAID") ? "paid" : "pending";
}

function fulfillmentStatus(status: string | null) {
  if (status?.includes("PARTIALLY")) return "partial";
  return status?.includes("FULFILLED") ? "fulfilled" : "unfulfilled";
}

function addressLines(address: ShopifyOrder["shippingAddress"]) {
  if (!address) return [];
  return [address.name, address.address1, address.address2, [address.city, address.province, address.zip].filter(Boolean).join(", "), address.country].filter((line): line is string => Boolean(line));
}

function updatedSinceQuery(value: string | null) {
  if (!value) return null;
  const updatedAt = Date.parse(value);
  if (!Number.isFinite(updatedAt)) return null;
  // A small overlap makes clock rounding and Shopify's eventual updates safe;
  // all writes are idempotent on the platform line/event identity.
  return `updated_at:>='${new Date(updatedAt - 2 * 60 * 60 * 1000).toISOString()}'`;
}

async function fetchAllOrders(updatedSince: string | null) {
  const orders: ShopifyOrder[] = [];
  let cursor: string | null = null;
  do {
    const data: { orders: Connection<ShopifyOrder> } = await shopifyGraphql<{ orders: Connection<ShopifyOrder> }>(ORDERS_QUERY, { cursor, query: updatedSinceQuery(updatedSince) });
    orders.push(...data.orders.nodes);
    cursor = data.orders.pageInfo.hasNextPage ? data.orders.pageInfo.endCursor : null;
  } while (cursor);
  return orders;
}

/**
 * The normal incremental query cannot revisit an older order after a newer
 * Shopify order has advanced the watermark. Re-read only incomplete local
 * order lines by their immutable Shopify order IDs, so a previous partial
 * import can never permanently hide a mapped sale from runway calculations.
 */
async function fetchOrdersByIds(ids: string[]) {
  const orders: ShopifyOrder[] = [];
  for (let index = 0; index < ids.length; index += 100) {
    const data = await shopifyGraphql<{ nodes: Array<ShopifyOrder | null> }>(ORDERS_BY_IDS_QUERY, { ids: ids.slice(index, index + 100) });
    orders.push(...data.nodes.filter((order): order is ShopifyOrder => order !== null));
  }
  return orders;
}

async function fetchAllVariants(updatedSince: string | null) {
  const variants: ShopifyVariant[] = [];
  let cursor: string | null = null;
  do {
    const data: { productVariants: Connection<ShopifyVariant> } = await shopifyGraphql<{ productVariants: Connection<ShopifyVariant> }>(VARIANTS_QUERY, { cursor, query: updatedSinceQuery(updatedSince) });
    variants.push(...data.productVariants.nodes);
    cursor = data.productVariants.pageInfo.hasNextPage ? data.productVariants.pageInfo.endCursor : null;
  } while (cursor);
  return variants;
}

export async function importShopifySnapshot() {
  const db = await getTursoClient();
  const [latestOrder, latestVariant, incompleteOrders] = await Promise.all([
    db.execute("SELECT MAX(source_updated_at) AS latest FROM orders WHERE source = 'shopify'"),
    db.execute("SELECT MAX(updated_at) AS latest FROM variants"),
    db.execute(`SELECT DISTINCT o.source_order_id
                FROM orders o
                JOIN order_items oi ON oi.order_id = o.id
                WHERE o.source = 'shopify'
                  AND o.source_order_id IS NOT NULL
                  AND o.source_created_at >= datetime('now', '-90 days')
                  AND (oi.source_product_id IS NULL OR trim(oi.source_product_id) = ''
                    OR oi.source_variant_id IS NULL OR trim(oi.source_variant_id) = '')
                ORDER BY o.source_created_at DESC`),
  ]);
  const incompleteOrderIds = incompleteOrders.rows.flatMap((row) => typeof row.source_order_id === "string" && row.source_order_id ? [row.source_order_id] : []);
  const [incrementalOrders, repairedOrders, variants] = await Promise.all([
    fetchAllOrders(typeof latestOrder.rows[0]?.latest === "string" ? latestOrder.rows[0].latest : null),
    fetchOrdersByIds(incompleteOrderIds),
    fetchAllVariants(typeof latestVariant.rows[0]?.latest === "string" ? latestVariant.rows[0].latest : null),
  ]);
  const orders = [...new Map([...incrementalOrders, ...repairedOrders].map((order) => [order.id, order])).values()];

  const variantStatements = variants.flatMap((variant) => {
    const imageUrl = variant.image?.url ?? variant.product.featuredMedia?.preview?.image?.url ?? null;
    return [{
      sql: `INSERT INTO products (id, shopify_product_id, title, handle, image_url, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(shopify_product_id) DO UPDATE SET title = excluded.title, handle = excluded.handle,
              image_url = excluded.image_url, updated_at = excluded.updated_at`,
      args: [variant.product.id, variant.product.id, variant.product.title, variant.product.handle, imageUrl, variant.updatedAt],
    }, {
      sql: `INSERT INTO variants (id, product_id, shopify_variant_id, sku, title, available_quantity, last_synced_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(shopify_variant_id) DO UPDATE SET sku = excluded.sku, title = excluded.title,
              available_quantity = excluded.available_quantity, last_synced_at = excluded.last_synced_at, updated_at = excluded.updated_at`,
      args: [variant.id, variant.product.id, variant.id, variant.sku || null, variant.title, variant.inventoryQuantity ?? 0, variant.updatedAt, variant.updatedAt],
    }];
  });
  for (let index = 0; index < variantStatements.length; index += 400) {
    await db.batch(variantStatements.slice(index, index + 400), "write");
  }

  const knownVariants = await db.execute("SELECT id FROM variants WHERE shopify_variant_id IS NOT NULL");
  const knownVariantIds = new Set(knownVariants.rows.map((variant) => String(variant.id)));
  for (const order of orders) {
    const customerName = order.customer?.displayName || order.shippingAddress?.name || "Guest customer";
    const customerEmail = order.customer?.email || order.email || null;
    const customerPhone = order.customer?.phone || order.phone || order.shippingAddress?.phone || null;
    const lines = addressLines(order.shippingAddress);
    const statements = [
      {
        sql: `INSERT INTO orders (id, source, source_order_id, order_number, customer_name, customer_email, customer_phone,
                                  shipping_address_json, currency, total_amount, subtotal_amount, shipping_amount, tax_amount,
                                  financial_status, fulfillment_status, cancelled_at, source_created_at, source_updated_at, imported_at)
              VALUES (?, 'shopify', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(source, source_order_id) DO UPDATE SET order_number = excluded.order_number,
                customer_name = excluded.customer_name, customer_email = excluded.customer_email, customer_phone = excluded.customer_phone,
                shipping_address_json = excluded.shipping_address_json, currency = excluded.currency, total_amount = excluded.total_amount,
                subtotal_amount = excluded.subtotal_amount, shipping_amount = excluded.shipping_amount, tax_amount = excluded.tax_amount,
                financial_status = excluded.financial_status, fulfillment_status = excluded.fulfillment_status,
                cancelled_at = excluded.cancelled_at,
                source_updated_at = excluded.source_updated_at, imported_at = excluded.imported_at`,
        args: [order.id, order.id, order.name, customerName, customerEmail, customerPhone, JSON.stringify(lines), currency(order.totalPriceSet),
          moneyInCents(order.totalPriceSet), moneyInCents(order.subtotalPriceSet), moneyInCents(order.totalShippingPriceSet), moneyInCents(order.totalTaxSet),
          paymentStatus(order.displayFinancialStatus), fulfillmentStatus(order.displayFulfillmentStatus), order.cancelledAt, order.createdAt, order.updatedAt, new Date().toISOString()],
      },
      ...(order.lineItems.pageInfo.hasNextPage ? [] : [{ sql: "DELETE FROM order_items WHERE order_id = ?", args: [order.id] }]),
      ...order.lineItems.nodes.map((item) => ({
        sql: `INSERT INTO order_items (id, order_id, variant_id, source_line_item_id, source_product_id, source_variant_id, title, variant_title, sku, quantity, unit_price_amount, image_url)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(order_id, source_line_item_id) DO UPDATE SET
                variant_id=excluded.variant_id, source_product_id=excluded.source_product_id,
                source_variant_id=excluded.source_variant_id, title=excluded.title,
                variant_title=excluded.variant_title, sku=excluded.sku, quantity=excluded.quantity,
                unit_price_amount=excluded.unit_price_amount, image_url=excluded.image_url`,
        args: [item.id, order.id, item.variant && knownVariantIds.has(item.variant.id) ? item.variant.id : null, item.id,
          item.variant?.product?.id ?? null, item.variant?.id ?? null,
          item.title, item.variantTitle, item.sku || item.variant?.sku || null, item.quantity, moneyInCents(item.originalUnitPriceSet), item.image?.url ?? null],
      })),
      ...order.refunds.flatMap((refund) => refund.refundLineItems.nodes.map((item) => ({
        sql: `INSERT INTO shopify_refund_line_items
                (id, refund_id, order_id, source_line_item_id, quantity, restocked, restock_type, processed_at, imported_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(refund_id, source_line_item_id) DO UPDATE SET
                quantity=excluded.quantity, restocked=excluded.restocked, restock_type=excluded.restock_type,
                processed_at=excluded.processed_at, imported_at=excluded.imported_at`,
        args: [item.id, refund.id, order.id, item.lineItem.id, item.quantity, item.restocked ? 1 : 0, item.restockType, refund.processedAt, new Date().toISOString()],
      }))),
    ];
    await db.batch(statements, "write");
  }

  return { orders: orders.length, variants: variants.length };
}
