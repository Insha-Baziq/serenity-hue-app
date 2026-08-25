import "server-only";

import { createHash } from "node:crypto";
import { getActiveTikTokConnections, refreshPhysicalTikTokListingQuantities, updatePhysicalTikTokListingMetadata, updateTikTokConnectionTokens } from "@/lib/repository";
import { hasTikTokApiCredentials, refreshTikTokAccessToken, tiktokApiRequest } from "@/lib/tiktok";
import { TikTokNotConnectedError } from "@/lib/tiktok-import";
import { extractTikTokProductUrl, tiktokShopProductUrl } from "@/lib/tiktok-links";
import { getTursoClient } from "@/lib/turso";

type UnknownRecord = Record<string, unknown>;
const TIKTOK_LIVE_PRODUCT_STATUS = "ACTIVATE";

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

function skuVariantTitle(sku: UnknownRecord, skuId: string, sellerSku: string) {
  const rawDirectTitle = text(sku.sku_name ?? sku.variant_name ?? sku.variant_title ?? sku.sku_title);
  const directTitle = /^(default(?:\s+title|\s+variant)?|default)$/i.test(rawDirectTitle) ? "" : rawDirectTitle;
  const attributeValues = records(sku.sales_attributes ?? sku.sales_attribute ?? sku.attributes)
    .map((attribute) => text(attribute.value_name ?? attribute.value ?? attribute.name))
    .filter(Boolean);
  const attributeTitle = [...new Set(attributeValues)].join(" / ");
  return directTitle || attributeTitle || sellerSku || (skuId ? `SKU ${skuId}` : "TikTok SKU");
}

async function enrichTikTokSkuVariantTitles(input: {
  accessToken: string;
  shopCipher: string;
  skus: TikTokSkuInventory[];
}) {
  const productIds = [...new Set(input.skus
    .filter((sku) => sku.productId && sku.variantTitle.startsWith("SKU "))
    .map((sku) => sku.productId))];
  for (const productId of productIds) {
    try {
      const data = await tiktokApiRequest<unknown>({
        path: `/product/202309/products/${encodeURIComponent(productId)}`,
        method: "GET",
        accessToken: input.accessToken,
        query: { shop_cipher: input.shopCipher },
      });
      const response = record(data);
      const product = record(response?.product ?? response?.product_detail) ?? response;
      const detailSkus = records(product?.skus ?? product?.sku_list);
      const titleByIdentity = new Map<string, string>();
      for (const sku of detailSkus) {
        const skuId = text(sku.id ?? sku.sku_id);
        const sellerSku = text(sku.seller_sku ?? sku.sku);
        const title = skuVariantTitle(sku, skuId, sellerSku);
        if (skuId) titleByIdentity.set(`id:${skuId}`, title);
        if (sellerSku) titleByIdentity.set(`seller:${sellerSku}`, title);
      }
      for (const sku of input.skus) {
        if (sku.productId !== productId) continue;
        const title = titleByIdentity.get(`id:${sku.skuId}`) || titleByIdentity.get(`seller:${sku.sellerSku}`);
        if (title && !title.startsWith("SKU ")) sku.variantTitle = title;
      }
    } catch {
      // The inventory and quantity sync must remain usable if a detail read is
      // temporarily unavailable. The stable SKU ID remains the label fallback.
    }
  }
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
  shopId: string;
  productId: string;
  productTitle: string;
  productUrl: string | null;
  skuId: string;
  sellerSku: string;
  variantTitle: string;
  warehouses: { warehouseId: string; quantity: number }[];
  totalQuantity: number;
};

export type TikTokUnmatchedProduct = {
  productId: string;
  productTitle: string;
  reason: "unmapped" | "ambiguous";
};

/** The seller-authored content returned by TikTok Shop's Get Product endpoint. */
export type TikTokProductDetail = {
  productId: string;
  shopId: string;
  title: string;
  description: string;
  imageUrls: string[];
  productUrl: string | null;
};

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.flatMap((item) => typeof item === "string" && item.trim() ? [item.trim()] : []) : [];
}

function imageUrls(value: unknown): string[] {
  return records(value).flatMap((image) => {
    const direct = text(image.url ?? image.uri ?? image.image_url);
    return [
      ...(direct ? [direct] : []),
      ...strings(image.urls ?? image.url_list ?? image.image_urls ?? image.thumbnail_urls),
    ];
  });
}

/**
 * Reads seller-authored details for explicit live TikTok product IDs. This is
 * intentionally separate from the inventory importer: it lets bundle review
 * use descriptions and listing media without inferring composition from titles.
 */
export async function fetchTikTokProductDetails(productIds: string[]): Promise<TikTokProductDetail[]> {
  if (!hasTikTokApiCredentials()) throw new TikTokNotConnectedError();
  const ids = [...new Set(productIds.map((productId) => productId.trim()).filter(Boolean))];
  if (ids.length === 0) return [];

  const connections = await getActiveTikTokConnections();
  if (connections.length === 0) throw new TikTokNotConnectedError();
  const details = new Map<string, TikTokProductDetail>();
  const failures: string[] = [];

  for (const connection of connections) {
    let accessToken = connection.accessToken;
    if (expiresSoon(connection.accessTokenExpiresAt)) {
      const tokens = await refreshTikTokAccessToken(connection.refreshToken);
      accessToken = tokens.accessToken;
      await updateTikTokConnectionTokens({ id: connection.id, ...tokens });
    }

    const shopData = await tiktokApiRequest<unknown>({
      path: "/authorization/202309/shops",
      method: "GET",
      accessToken,
    });
    for (const shop of extractShops(shopData)) {
      for (const productId of ids) {
        if (details.has(productId)) continue;
        try {
          const data = await tiktokApiRequest<unknown>({
            path: `/product/202309/products/${encodeURIComponent(productId)}`,
            method: "GET",
            accessToken,
            query: { shop_cipher: shop.cipher },
          });
          const response = record(data);
          const product = record(response?.product ?? response?.product_detail) ?? response;
          if (!product) throw new Error("TikTok returned no product detail");
          const returnedId = text(product.id ?? product.product_id) || productId;
          details.set(productId, {
            productId: returnedId,
            shopId: shop.id,
            title: text(product.title ?? product.product_name),
            description: text(product.description ?? product.product_description),
            imageUrls: [...new Set(imageUrls(product.images ?? product.image_list ?? product.main_images))],
            productUrl: extractTikTokProductUrl(product),
          });
        } catch (error) {
          failures.push(`${productId}: ${error instanceof Error ? error.message : "TikTok product read failed"}`);
        }
      }
    }
  }

  const missing = ids.filter((productId) => !details.has(productId));
  if (missing.length > 0) {
    throw new Error(`TikTok product detail unavailable for ${missing.join(", ")}${failures.length ? ` (${failures.join("; ")})` : ""}`);
  }
  return ids.map((productId) => details.get(productId)!);
}

/**
 * Read-only diagnostic + import primitive: pulls only the seller's live
 * (`ACTIVATE`) products and their per-SKU inventory from TikTok Shop. Requires
 * the `Product basic` (seller.product.basic) scope. No customer/PII data is touched.
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
      const shopSkuStart = skus.length;
      for (let page = 0; page < 100; page += 1) {
        const data = await tiktokApiRequest<unknown>({
          path: "/product/202309/products/search",
          method: "POST",
          accessToken,
          query: { shop_cipher: shop.cipher, page_size: 100, page_token: pageToken },
          body: { status: TIKTOK_LIVE_PRODUCT_STATUS },
        });
        const response = record(data);
        for (const product of records(response?.products ?? response?.product_list)) {
          const productId = text(product.id ?? product.product_id);
          const productTitle = text(product.title ?? product.product_name);
          const productUrl = extractTikTokProductUrl(product);
          for (const sku of records(product.skus ?? product.sku_list)) {
            const skuId = text(sku.id ?? sku.sku_id);
            const sellerSku = text(sku.seller_sku ?? sku.sku);
            const warehouses = records(sku.inventory ?? sku.inventory_list).map((entry) => ({
              warehouseId: text(entry.warehouse_id),
              quantity: Math.max(0, Math.round(number(entry.quantity ?? entry.available_quantity))),
            }));
            skus.push({
              shopId: shop.id,
              productId,
              productTitle,
              productUrl,
              skuId,
              sellerSku,
              variantTitle: skuVariantTitle(sku, skuId, sellerSku),
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
      await enrichTikTokSkuVariantTitles({
        accessToken,
        shopCipher: shop.cipher,
        skus: skus.slice(shopSkuStart),
      });
    }
  }

  return { grantedScopes: [...grantedScopes], shops: shopsSeen, skus };
}

/**
 * Fetches TikTok inventory and caches every reported warehouse quantity. The
 * physical listing recipe is the only stock-mapping authority; this cache is
 * strictly a channel observation and never writes legacy channel mappings.
 */
export async function storeTikTokInventory(): Promise<{
  skus: number;
  products: number;
  matched: number;
  removed: number;
  unmatchedProducts: TikTokUnmatchedProduct[];
  syncedAt: string;
}> {
  const { skus } = await fetchTikTokInventory();
  const liveProducts = new Map<string, TikTokSkuInventory>();
  for (const sku of skus) {
    if (!sku.productId) continue;
    const existing = liveProducts.get(sku.productId);
    if (!existing || (!existing.productTitle && sku.productTitle) || (!existing.productUrl && sku.productUrl)) {
      liveProducts.set(sku.productId, sku);
    }
  }
  const db = await getTursoClient();
  const now = new Date().toISOString();

  const mappingResult = await db.execute(`SELECT external_product_id, mapping_status
    FROM physical_channel_listings
    WHERE channel = 'tiktok' AND active = 1 AND external_product_id IS NOT NULL`);
  const confirmedProducts = new Set<string>();
  for (const row of mappingResult.rows) {
    const productId = typeof row.external_product_id === "string" ? row.external_product_id : "";
    if (productId && row.mapping_status === "confirmed") confirmedProducts.add(productId);
  }

  let matched = 0;
  const inventoryStatements: Array<{ sql: string; args: Array<string | number | null> }> = [];
  for (const [skuIndex, sku] of skus.entries()) {
    if (confirmedProducts.has(sku.productId)) matched += 1;
    const anonymousSkuHash = createHash("sha256")
      .update(JSON.stringify({ productId: sku.productId, sellerSku: sku.sellerSku, warehouseIds: sku.warehouses.map((warehouse) => warehouse.warehouseId), skuIndex }))
      .digest("hex").slice(0, 16);
    const skuIdentity = sku.skuId || sku.sellerSku || `anonymous-${anonymousSkuHash}`;
    const warehouses = sku.warehouses.length > 0
      ? sku.warehouses
      : [{ warehouseId: "default", quantity: sku.totalQuantity }];
    for (const [warehouseIndex, warehouse] of warehouses.entries()) {
      const warehouseId = warehouse.warehouseId || `warehouse-${warehouseIndex + 1}`;
      inventoryStatements.push({
      sql: `INSERT INTO channel_inventory (id, variant_id, channel, shop_id, external_product_id, external_sku_id, warehouse_id, available_quantity, synced_at)
            VALUES (?, NULL, 'tiktok', ?, ?, ?, ?, ?, ?)
            ON CONFLICT(channel, external_sku_id, warehouse_id) DO UPDATE SET
              variant_id = NULL, shop_id = excluded.shop_id, external_product_id = excluded.external_product_id,
              available_quantity = excluded.available_quantity, synced_at = excluded.synced_at`,
      args: [crypto.randomUUID(), sku.shopId, sku.productId || null, `${sku.shopId}:${skuIdentity}`, warehouseId, warehouse.quantity, now],
      });
    }
  }
  if (inventoryStatements.length) await db.batch(inventoryStatements, "write");

  // A successful live-catalog import is the source of truth for this cache.
  // Rows untouched by this run came from deleted or deactivated listings.
  const staleInventory = await db.execute({
    sql: "DELETE FROM channel_inventory WHERE channel = 'tiktok' AND synced_at < ?",
    args: [now],
  });
  // Keep the channel-listing table's platform quantity in step with this
  // direct TikTok read. Mapping never participates in this calculation.
  await refreshPhysicalTikTokListingQuantities();
  // Product identity is the TikTok product id. Titles and public URLs are
  // display metadata; changing either must not change listing ids or mappings.
  const listingVariantsByProduct = new Map<string, Map<string, {
    externalVariantId: string;
    variantTitle: string;
    channelQuantity: number;
  }>>();
  for (const sku of skus) {
    const externalVariantId = sku.skuId || sku.sellerSku;
    if (!sku.productId || !externalVariantId) continue;
    const variants = listingVariantsByProduct.get(sku.productId) ?? new Map();
    const current = variants.get(externalVariantId);
    variants.set(externalVariantId, {
      externalVariantId,
      variantTitle: current?.variantTitle || sku.variantTitle,
      // A product search result already includes all warehouses for one SKU.
      // Use the largest observation if a duplicated page is returned so a
      // retry cannot inflate the channel quantity.
      channelQuantity: Math.max(current?.channelQuantity ?? 0, sku.totalQuantity),
    });
    listingVariantsByProduct.set(sku.productId, variants);
  }
  await updatePhysicalTikTokListingMetadata([...liveProducts.values()].map((product) => ({
    externalProductId: product.productId,
    title: product.productTitle,
    listingUrl: product.productUrl ?? tiktokShopProductUrl(product.productId),
    variants: [...(listingVariantsByProduct.get(product.productId)?.values() ?? [])],
  })));
  const unmatchedProducts: TikTokUnmatchedProduct[] = [...liveProducts.values()].flatMap((product) => {
    if (confirmedProducts.has(product.productId)) return [];
    return [{
      productId: product.productId,
      productTitle: product.productTitle || `TikTok product ${product.productId}`,
      reason: "unmapped",
    }];
  });

  return {
    skus: skus.length,
    products: liveProducts.size,
    matched,
    removed: staleInventory.rowsAffected,
    unmatchedProducts,
    syncedAt: now,
  };
}
