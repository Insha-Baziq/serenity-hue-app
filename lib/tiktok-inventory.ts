import "server-only";

import { getActiveTikTokConnections, updateTikTokConnectionTokens } from "@/lib/repository";
import { hasTikTokApiCredentials, refreshTikTokAccessToken, tiktokApiRequest } from "@/lib/tiktok";
import { TikTokNotConnectedError } from "@/lib/tiktok-import";

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
