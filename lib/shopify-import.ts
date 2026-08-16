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
    variant: { id: string; sku: string | null } | null;
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

const ORDERS_QUERY = `
  query OperationsOrders($cursor: String) {
    orders(first: 100, after: $cursor, sortKey: PROCESSED_AT, reverse: true) {
      nodes {
        id name createdAt updatedAt email phone displayFinancialStatus displayFulfillmentStatus
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
            variant { id sku }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const VARIANTS_QUERY = `
  query OperationsVariants($cursor: String) {
    productVariants(first: 100, after: $cursor) {
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

async function fetchAllOrders() {
  const orders: ShopifyOrder[] = [];
  let cursor: string | null = null;
  do {
    const data: { orders: Connection<ShopifyOrder> } = await shopifyGraphql<{ orders: Connection<ShopifyOrder> }>(ORDERS_QUERY, { cursor });
    orders.push(...data.orders.nodes);
    cursor = data.orders.pageInfo.hasNextPage ? data.orders.pageInfo.endCursor : null;
  } while (cursor);
  return orders;
}

async function fetchAllVariants() {
  const variants: ShopifyVariant[] = [];
  let cursor: string | null = null;
  do {
    const data: { productVariants: Connection<ShopifyVariant> } = await shopifyGraphql<{ productVariants: Connection<ShopifyVariant> }>(VARIANTS_QUERY, { cursor });
    variants.push(...data.productVariants.nodes);
    cursor = data.productVariants.pageInfo.hasNextPage ? data.productVariants.pageInfo.endCursor : null;
  } while (cursor);
  return variants;
}

export async function importShopifySnapshot() {
  const [orders, variants] = await Promise.all([fetchAllOrders(), fetchAllVariants()]);
  const db = await getTursoClient();

  for (const variant of variants) {
    const imageUrl = variant.image?.url ?? variant.product.featuredMedia?.preview?.image?.url ?? null;
    await db.execute({
      sql: `INSERT INTO products (id, shopify_product_id, title, handle, image_url, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(shopify_product_id) DO UPDATE SET title = excluded.title, handle = excluded.handle,
              image_url = excluded.image_url, updated_at = excluded.updated_at`,
      args: [variant.product.id, variant.product.id, variant.product.title, variant.product.handle, imageUrl, variant.updatedAt],
    });
    await db.execute({
      sql: `INSERT INTO variants (id, product_id, shopify_variant_id, sku, title, available_quantity, last_synced_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(shopify_variant_id) DO UPDATE SET sku = excluded.sku, title = excluded.title,
              available_quantity = excluded.available_quantity, last_synced_at = excluded.last_synced_at, updated_at = excluded.updated_at`,
      args: [variant.id, variant.product.id, variant.id, variant.sku || null, variant.title, variant.inventoryQuantity ?? 0, variant.updatedAt, variant.updatedAt],
    });
  }

  const knownVariantIds = new Set(variants.map((variant) => variant.id));
  for (const order of orders) {
    const customerName = order.customer?.displayName || order.shippingAddress?.name || "Guest customer";
    const customerEmail = order.customer?.email || order.email || null;
    const customerPhone = order.customer?.phone || order.phone || order.shippingAddress?.phone || null;
    const lines = addressLines(order.shippingAddress);
    const statements = [
      {
        sql: `INSERT INTO orders (id, source, source_order_id, order_number, customer_name, customer_email, customer_phone,
                                  shipping_address_json, currency, total_amount, subtotal_amount, shipping_amount, tax_amount,
                                  financial_status, fulfillment_status, source_created_at, source_updated_at, imported_at)
              VALUES (?, 'shopify', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(source, source_order_id) DO UPDATE SET order_number = excluded.order_number,
                customer_name = excluded.customer_name, customer_email = excluded.customer_email, customer_phone = excluded.customer_phone,
                shipping_address_json = excluded.shipping_address_json, currency = excluded.currency, total_amount = excluded.total_amount,
                subtotal_amount = excluded.subtotal_amount, shipping_amount = excluded.shipping_amount, tax_amount = excluded.tax_amount,
                financial_status = excluded.financial_status, fulfillment_status = excluded.fulfillment_status,
                source_updated_at = excluded.source_updated_at, imported_at = excluded.imported_at`,
        args: [order.id, order.id, order.name, customerName, customerEmail, customerPhone, JSON.stringify(lines), currency(order.totalPriceSet),
          moneyInCents(order.totalPriceSet), moneyInCents(order.subtotalPriceSet), moneyInCents(order.totalShippingPriceSet), moneyInCents(order.totalTaxSet),
          paymentStatus(order.displayFinancialStatus), fulfillmentStatus(order.displayFulfillmentStatus), order.createdAt, order.updatedAt, new Date().toISOString()],
      },
      { sql: "DELETE FROM order_items WHERE order_id = ?", args: [order.id] },
      ...order.lineItems.nodes.map((item) => ({
        sql: `INSERT INTO order_items (id, order_id, variant_id, source_line_item_id, title, variant_title, sku, quantity, unit_price_amount, image_url)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [item.id, order.id, item.variant && knownVariantIds.has(item.variant.id) ? item.variant.id : null, item.id,
          item.title, item.variantTitle, item.sku || item.variant?.sku || null, item.quantity, moneyInCents(item.originalUnitPriceSet), item.image?.url ?? null],
      })),
    ];
    await db.batch(statements, "write");
  }

  return { orders: orders.length, variants: variants.length };
}
