import "server-only";

import {
  advanceTikTokAffiliateSyncCursor,
  getActiveTikTokConnections,
  getTikTokAffiliateSyncCursor,
  recordTikTokAffiliateSyncFailure,
  recordTikTokAffiliateSyncSuccess,
  saveTikTokAffiliateOrders,
  saveTikTokAffiliateVideos,
  type TikTokAffiliateOrderRecord,
  type TikTokAffiliateVideoRecord,
  updateTikTokConnectionShop,
  updateTikTokConnectionTokens,
} from "@/lib/repository";
import { hasTikTokApiCredentials, refreshTikTokAccessToken, tiktokApiRequest } from "@/lib/tiktok";
import { TikTokNotConnectedError } from "@/lib/tiktok-import";
import { normalizeTikTokAffiliateOrder } from "@/lib/tiktok-affiliate";

type UnknownRecord = Record<string, unknown>;

export type TikTokAffiliateImportResult = {
  orders: number;
  videos: number;
  shops: number;
  baselineOrders: number;
};

function record(value: unknown): UnknownRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : undefined;
}

function records(value: unknown) {
  return Array.isArray(value) ? value.flatMap((item) => record(item) ? [item as UnknownRecord] : []) : [];
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function number(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function timestamp(value: unknown) {
  const numeric = number(value);
  if (numeric > 0) return new Date((numeric > 1_000_000_000_000 ? numeric : numeric * 1000)).toISOString();
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  return undefined;
}

function expiresSoon(value: string | undefined) {
  const expiry = value ? Date.parse(value) : NaN;
  return Number.isFinite(expiry) && expiry <= Date.now() + 5 * 60 * 1000;
}

function latestUpdatedAt(orders: UnknownRecord[]) {
  return orders.map((order) => timestamp(order.update_time ?? order.updated_at ?? order.create_time)).filter((value): value is string => Boolean(value)).sort().at(-1);
}

function extractOrderPage(value: unknown) {
  const data = record(value);
  return {
    orders: records(data?.orders ?? data?.order_list ?? data?.affiliate_orders),
    nextPageToken: text(data?.next_page_token ?? data?.page_token) || undefined,
  };
}

function extractShops(value: unknown) {
  const data = record(value);
  return records(data?.shops ?? data?.shop_list).flatMap((shop) => {
    const id = text(shop.id ?? shop.shop_id);
    const cipher = text(shop.cipher ?? shop.shop_cipher);
    return id && cipher ? [{ id, cipher }] : [];
  });
}

async function authorizedShops(accessToken: string) {
  const response = await tiktokApiRequest<unknown>({
    path: "/authorization/202309/shops",
    method: "GET",
    accessToken,
  });
  return extractShops(response);
}

async function searchAffiliateOrders(input: { accessToken: string; shopCipher: string; updatedAfter?: string }) {
  const found: UnknownRecord[] = [];
  const seenTokens = new Set<string>();
  let pageToken: string | undefined;
  for (let page = 0; page < 100; page += 1) {
    const body: Record<string, number> = {};
    if (input.updatedAfter) {
      const cutoff = Date.parse(input.updatedAfter) - 2 * 60 * 60 * 1000;
      if (Number.isFinite(cutoff)) body.update_time_ge = Math.max(0, Math.floor(cutoff / 1000));
    } else {
      body.create_time_ge = Math.floor((Date.now() - 90 * 24 * 60 * 60 * 1000) / 1000);
    }
    const response = await tiktokApiRequest<unknown>({
      path: "/affiliate_seller/202410/orders/search",
      method: "POST",
      accessToken: input.accessToken,
      query: { shop_cipher: input.shopCipher, page_size: 50, page_token: pageToken },
      body,
    });
    const result = extractOrderPage(response);
    found.push(...result.orders);
    if (!result.nextPageToken || seenTokens.has(result.nextPageToken)) break;
    seenTokens.add(result.nextPageToken);
    pageToken = result.nextPageToken;
  }
  return found;
}

function normalizeAffiliateVideo(value: UnknownRecord, context: { connectionId: string; shopId: string }): TikTokAffiliateVideoRecord | undefined {
  const sourceVideoId = text(value.video_id ?? value.id);
  if (!sourceVideoId) return undefined;
  const creator = record(value.creator);
  const product = record(value.product);
  const unitGmv = Math.max(0, Math.round(number(value.gmv ?? value.gross_merchandise_value ?? value.sales_amount) * 100));
  return {
    id: `tiktok-affiliate-video:${context.shopId}:${sourceVideoId}`,
    connectionId: context.connectionId,
    shopId: context.shopId,
    sourceVideoId,
    sourceProductId: text(value.product_id ?? product?.id) || undefined,
    creatorOpenId: text(value.creator_open_id ?? value.open_id ?? creator?.open_id) || undefined,
    creatorUsername: text(value.creator_username ?? value.user_name ?? creator?.user_name ?? creator?.username) || undefined,
    videoTitle: text(value.video_title ?? value.title) || undefined,
    publishedAt: timestamp(value.publish_time ?? value.published_at ?? value.create_time),
    grossAmountMinor: unitGmv,
    attributedOrderCount: Math.max(0, Math.round(number(value.order_count ?? value.orders))),
    currency: text(value.currency ?? value.currency_code).toUpperCase() || "GBP",
    sourceUpdatedAt: timestamp(value.update_time ?? value.updated_at),
  };
}

async function searchAffiliateVideos(input: { accessToken: string; shopCipher: string }) {
  const found: UnknownRecord[] = [];
  const seenTokens = new Set<string>();
  let pageToken: string | undefined;
  for (let page = 0; page < 100; page += 1) {
    const response = await tiktokApiRequest<unknown>({
      path: "/analytics/202605/shop_videos/performance",
      method: "GET",
      accessToken: input.accessToken,
      query: { shop_cipher: input.shopCipher, account_type: "AFFILIATE_ACCOUNTS", page_size: 50, page_token: pageToken },
    });
    const data = record(response);
    const videos = records(data?.videos ?? data?.video_list ?? data?.items);
    found.push(...videos);
    const nextPageToken = text(data?.next_page_token ?? data?.page_token) || undefined;
    if (!nextPageToken || seenTokens.has(nextPageToken)) break;
    seenTokens.add(nextPageToken);
    pageToken = nextPageToken;
  }
  return found;
}

export async function importTikTokAffiliateReporting(): Promise<TikTokAffiliateImportResult> {
  if (!hasTikTokApiCredentials()) throw new TikTokNotConnectedError();
  const connections = await getActiveTikTokConnections();
  if (connections.length === 0) throw new TikTokNotConnectedError();

  let orders = 0;
  let videos = 0;
  let shops = 0;
  let baselineOrders = 0;
  let lastError: unknown;
  for (const connection of connections) {
    try {
      let accessToken = connection.accessToken;
      if (expiresSoon(connection.accessTokenExpiresAt)) {
        const tokens = await refreshTikTokAccessToken(connection.refreshToken);
        accessToken = tokens.accessToken;
        await updateTikTokConnectionTokens({ id: connection.id, ...tokens });
      }
      const authorized = await authorizedShops(accessToken);
      for (const shop of authorized) {
        try {
          await updateTikTokConnectionShop({ id: connection.id, shopId: shop.id, shopCipher: shop.cipher });
          const cursor = await getTikTokAffiliateSyncCursor({ connectionId: connection.id, shopId: shop.id });
          const initialBaseline = !cursor;
          const sourceOrders = await searchAffiliateOrders({ accessToken, shopCipher: shop.cipher, updatedAfter: cursor });
          const normalized = sourceOrders.flatMap((order) => {
            const value = normalizeTikTokAffiliateOrder(order, { connectionId: connection.id, shopId: shop.id });
            return value ? [value] : [];
          });
          await saveTikTokAffiliateOrders(normalized as TikTokAffiliateOrderRecord[]);
          const sourceVideos = await searchAffiliateVideos({ accessToken, shopCipher: shop.cipher });
          const normalizedVideos = sourceVideos.flatMap((video) => {
            const value = normalizeAffiliateVideo(video, { connectionId: connection.id, shopId: shop.id });
            return value ? [value] : [];
          });
          await saveTikTokAffiliateVideos(normalizedVideos as TikTokAffiliateVideoRecord[]);
          await advanceTikTokAffiliateSyncCursor({
            connectionId: connection.id,
            shopId: shop.id,
            cursorAt: latestUpdatedAt(sourceOrders) ?? new Date().toISOString(),
          });
          await recordTikTokAffiliateSyncSuccess({ connectionId: connection.id, shopId: shop.id, initialBaseline });
          orders += normalized.length;
          videos += normalizedVideos.length;
          shops += 1;
          if (initialBaseline) baselineOrders += normalized.length;
        } catch (error) {
          lastError = error;
          await recordTikTokAffiliateSyncFailure({
            connectionId: connection.id,
            shopId: shop.id,
            message: error instanceof Error ? error.message : "TikTok affiliate import failed",
          });
        }
      }
    } catch (error) {
      lastError = error;
    }
  }
  if (shops === 0 && lastError) throw lastError;
  if (shops === 0) throw new Error("TikTok Shop affiliate reporting needs an authorized shop");
  return { orders, videos, shops, baselineOrders };
}
