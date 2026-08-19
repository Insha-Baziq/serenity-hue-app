import "server-only";

import { getActiveTikTokConnections, updateTikTokConnectionTokens } from "@/lib/repository";
import { hasTikTokApiCredentials, refreshTikTokAccessToken, tiktokApiRequest } from "@/lib/tiktok";
import { TikTokNotConnectedError } from "@/lib/tiktok-import";
import { getTursoClient } from "@/lib/turso";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as UnknownRecord) : undefined;
}

function records(value: unknown): UnknownRecord[] {
  return Array.isArray(value) ? value.flatMap((item) => (record(item) ? [record(item)!] : [])) : [];
}

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function number(value: unknown) {
  const candidate = typeof value === "string" ? Number.parseFloat(value) : value;
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : 0;
}

function expiresSoon(value: string | undefined) {
  if (!value) return false;
  const expiry = Date.parse(value);
  return Number.isFinite(expiry) && expiry <= Date.now() + 5 * 60 * 1000;
}

type TikTokShop = { id: string; cipher: string };

function extractShops(value: unknown): TikTokShop[] {
  const data = record(value);
  return records(data?.shops ?? data?.shop_list).flatMap((shop) => {
    const id = text(shop.id ?? shop.shop_id);
    const cipher = text(shop.cipher ?? shop.shop_cipher);
    return id && cipher ? [{ id, cipher }] : [];
  });
}

/** A single SKU's stock as reported by TikTok Shop, flattened across warehouses. */
export type TikTokSkuInventory = {
  productId: string;
  productTitle: string;
  skuId: string;
  sellerSku: string;
  warehouses: { warehouseId: string; quantity: number }[];
  totalQuantity: number;
};

/**
 * Read-only diagnostic + import primitive: pulls the seller's listed products
 * and their per-SKU inventory from TikTok Shop. Requires the `Product basic`
 * (seller.product.basic) scope. No customer/PII data is touched.
 */
export async function fetchTikTokInventory(): Promise<{
  grantedScopes: string[];
  shops: number;
  skus: TikTokSkuInventory[];
}> {
  if (!hasTikTokApiCredentials()) throw new TikTokNotConnectedError();
  const connections = await getActiveTikTokConnections();
  if (connections.length === 0) throw new TikTokNotConnectedError();

  const grantedScopes = new Set<string>();
  const skus: TikTokSkuInventory[] = [];
  let shopsSeen = 0;

  for (const connection of connections) {
    connection.grantedScopes.forEach((scope) => grantedScopes.add(scope));
    let accessToken = connection.accessToken;
    if (expiresSoon(connection.accessTokenExpiresAt)) {
      const tokens = await refreshTikTokAccessToken(connection.refreshToken);
      accessToken = tokens.accessToken;
      tokens.grantedScopes.forEach((scope) => grantedScopes.add(scope));
      await updateTikTokConnectionTokens({ id: connection.id, ...tokens });
    }

    const shopData = await tiktokApiRequest<unknown>({
      path: "/authorization/202309/shops",
      method: "GET",
      accessToken,
    });
    const shops = extractShops(shopData);

    for (const shop of shops) {
      shopsSeen += 1;
      const seenPageTokens = new Set<string>();
      let pageToken: string | undefined;
      for (let page = 0; page < 100; page += 1) {
        const data = await tiktokApiRequest<unknown>({
          path: "/product/202309/products/search",
          method: "POST",
          accessToken,
          query: { shop_cipher: shop.cipher, page_size: 100, page_token: pageToken },
          body: { status: "ALL" },
        });
        const response = record(data);
        for (const product of records(response?.products ?? response?.product_list)) {
          const productId = text(product.id ?? product.product_id);
          const productTitle = text(product.title ?? product.product_name);
          for (const sku of records(product.skus ?? product.sku_list)) {
            const warehouses = records(sku.inventory ?? sku.inventory_list).map((entry) => ({
              warehouseId: text(entry.warehouse_id),
              quantity: Math.max(0, Math.round(number(entry.quantity ?? entry.available_quantity))),
            }));
            skus.push({
              productId,
              productTitle,
              skuId: text(sku.id ?? sku.sku_id),
              sellerSku: text(sku.seller_sku ?? sku.sku),
              warehouses,
              totalQuantity: warehouses.reduce((sum, entry) => sum + entry.quantity, 0),
            });
          }
        }
        const nextPageToken = text(response?.next_page_token) || undefined;
        if (!nextPageToken || seenPageTokens.has(nextPageToken)) break;
        seenPageTokens.add(nextPageToken);
        pageToken = nextPageToken;
      }
    }
  }

  return { grantedScopes: [...grantedScopes], shops: shopsSeen, skus };
}

/**
 * Fetches TikTok inventory and caches it in `channel_inventory`, resolving each
 * SKU to a Shopify variant through the product-level `channel_mappings`. TikTok
 * SKUs carry no seller_sku, so matching is by mapped product id only; a mapped
 * SKU also backfills the mapping's `external_variant_id` for future writes.
 */
export async function storeTikTokInventory(): Promise<{ skus: number; matched: number; syncedAt: string }> {
  const { skus } = await fetchTikTokInventory();
  const db = await getTursoClient();
  const now = new Date().toISOString();

  const mappingResult = await db.execute(`SELECT external_product_id, variant_id FROM channel_mappings
    WHERE channel = 'tiktok' AND active = 1 AND external_product_id IS NOT NULL`);
  const variantsByProduct = new Map<string, string[]>();
  for (const row of mappingResult.rows) {
    const productId = typeof row.external_product_id === "string" ? row.external_product_id : "";
    const variantId = typeof row.variant_id === "string" ? row.variant_id : "";
    if (productId && variantId) variantsByProduct.set(productId, [...(variantsByProduct.get(productId) ?? []), variantId]);
  }

  let matched = 0;
  for (const sku of skus) {
    const candidates = variantsByProduct.get(sku.productId);
    const variantId = candidates?.length === 1 ? candidates[0] : null;
    if (variantId) matched += 1;
    const warehouseId = sku.warehouses[0]?.warehouseId || "default";
    await db.execute({
      sql: `INSERT INTO channel_inventory (id, variant_id, channel, external_product_id, external_sku_id, warehouse_id, available_quantity, synced_at)
            VALUES (?, ?, 'tiktok', ?, ?, ?, ?, ?)
            ON CONFLICT(channel, external_sku_id, warehouse_id) DO UPDATE SET
              variant_id = excluded.variant_id, external_product_id = excluded.external_product_id,
              available_quantity = excluded.available_quantity, synced_at = excluded.synced_at`,
      args: [crypto.randomUUID(), variantId, sku.productId || null, sku.skuId || `${sku.productId}:${matched}`, warehouseId, sku.totalQuantity, now],
    });
    if (variantId && sku.skuId) {
      await db.execute({
        sql: `UPDATE channel_mappings SET external_variant_id = ? WHERE channel = 'tiktok' AND variant_id = ? AND external_product_id = ? AND (external_variant_id IS NULL OR external_variant_id = '')`,
        args: [sku.skuId, variantId, sku.productId],
      });
    }
  }

  return { skus: skus.length, matched, syncedAt: now };
}
