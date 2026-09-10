import { createHash } from "node:crypto";

const TIKTOK_ADS_AUTHORIZATION_URL = "https://business-api.tiktok.com/portal/auth";
const TIKTOK_ADS_API_BASE_URL = "https://business-api.tiktok.com/open_api/v1.3/";

type TikTokAdsTokenData = {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  refresh_token_expires_in?: unknown;
  advertiser_ids?: unknown;
  scope?: unknown;
};

type TikTokAdsTokenResponse = {
  code?: unknown;
  data?: TikTokAdsTokenData;
};

export type TikTokAdsTokenBundle = {
  accessToken: string;
  refreshToken?: string;
  accessTokenExpiresAt?: string;
  refreshTokenExpiresAt?: string;
  advertiserIds: string[];
  grantedScopes: string[];
};

function requiredEnvironment(name: "TIKTOK_ADS_APP_ID" | "TIKTOK_ADS_APP_SECRET") {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name} in server environment`);
  return value;
}

function isProductionRuntime() {
  return process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build";
}

function isLoopbackUrl(value: string) {
  try {
    const url = new URL(value);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  } catch {
    return false;
  }
}

export function hasTikTokAdsAppCredentials() {
  return Boolean(process.env.TIKTOK_ADS_APP_ID?.trim() && process.env.TIKTOK_ADS_APP_SECRET?.trim());
}

export function hasTikTokAdsAdvertiserId() {
  return Boolean(process.env.TIKTOK_ADS_ADVERTISER_ID?.trim());
}

export function tiktokAdsAdvertiserId() {
  const value = process.env.TIKTOK_ADS_ADVERTISER_ID?.trim();
  if (!value) throw new Error("Missing TIKTOK_ADS_ADVERTISER_ID in server environment");
  return value;
}

export function tiktokAdsRedirectUri() {
  const configured = process.env.TIKTOK_ADS_REDIRECT_URI?.trim();
  // A localhost callback is valid for local development but must never leak
  // into a deployed OAuth request when a stale Vercel environment variable is
  // present. Vercel's production URL is the stable OAuth callback host; the
  // deployment URL can change on every deploy and is not a safe fallback.
  if (configured && !(isProductionRuntime() && isLoopbackUrl(configured))) return configured;
  const appUrl = (isProductionRuntime()
    ? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL.trim()}` : undefined)
    : undefined)
    || process.env.APP_URL?.trim()
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined)
    || "http://localhost:3000";
  return `${appUrl.replace(/\/$/, "")}/api/tiktok-ads/callback`;
}

export function tiktokAdsAuthorizationUrl(state: string) {
  const value = state.trim();
  if (!value) throw new Error("TikTok Ads OAuth state is missing");
  const url = new URL(TIKTOK_ADS_AUTHORIZATION_URL);
  url.searchParams.set("app_id", requiredEnvironment("TIKTOK_ADS_APP_ID"));
  url.searchParams.set("state", value);
  url.searchParams.set("redirect_uri", tiktokAdsRedirectUri());
  return url.toString();
}

export function hashTikTokAdsOAuthState(state: string) {
  return createHash("sha256").update(state).digest("hex");
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function tokenExpiryToIso(value: unknown) {
  const seconds = numberValue(value);
  if (!seconds || seconds <= 0) return undefined;
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function scopes(value: unknown) {
  if (Array.isArray(value)) return value.filter((scope): scope is string => typeof scope === "string" && scope.trim().length > 0).map((scope) => scope.trim());
  if (typeof value === "string") return value.split(/[\s,]+/).map((scope) => scope.trim()).filter(Boolean);
  return [];
}

function advertiserIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((advertiserId) => typeof advertiserId === "string" || typeof advertiserId === "number" ? String(advertiserId).trim() : "")
    .filter(Boolean);
}

function tokenBundle(payload: TikTokAdsTokenResponse, responseStatus: number, requireAdvertiserIds: boolean) {
  const data = payload.data;
  const accessToken = stringValue(data?.access_token);
  const refreshToken = stringValue(data?.refresh_token) || undefined;
  const authorizedAdvertiserIds = advertiserIds(data?.advertiser_ids);
  const apiCode = numberValue(payload.code);
  if (responseStatus < 200 || responseStatus >= 300 || apiCode !== 0 || !accessToken || (requireAdvertiserIds && !authorizedAdvertiserIds.length)) {
    throw new Error(`TikTok Ads token exchange failed (HTTP ${responseStatus}, code ${apiCode ?? "unknown"})`);
  }

  return {
    accessToken,
    refreshToken,
    accessTokenExpiresAt: tokenExpiryToIso(data?.expires_in),
    refreshTokenExpiresAt: tokenExpiryToIso(data?.refresh_token_expires_in),
    advertiserIds: authorizedAdvertiserIds,
    grantedScopes: scopes(data?.scope),
  } satisfies TikTokAdsTokenBundle;
}

async function postTokenRequest(path: string, body: Record<string, string>, requireAdvertiserIds: boolean) {
  const response = await fetch(new URL(path, TIKTOK_ADS_API_BASE_URL), {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  let payload: TikTokAdsTokenResponse = {};
  try {
    payload = await response.json() as TikTokAdsTokenResponse;
  } catch {
    // The normalized error below intentionally does not echo the provider body.
  }
  return tokenBundle(payload, response.status, requireAdvertiserIds);
}

export async function exchangeTikTokAdsAuthorizationCode(authCode: string) {
  const code = authCode.trim();
  if (!code) throw new Error("TikTok Ads authorization code is missing");
  return postTokenRequest("oauth2/access_token/", {
    app_id: requiredEnvironment("TIKTOK_ADS_APP_ID"),
    secret: requiredEnvironment("TIKTOK_ADS_APP_SECRET"),
    auth_code: code,
  }, true);
}

/** Compatibility path for accounts that still return a refresh token. */
export async function refreshTikTokAdsAccessToken(refreshToken: string) {
  const token = refreshToken.trim();
  if (!token) throw new Error("TikTok Ads refresh token is missing");
  return postTokenRequest("oauth2/refresh_token/", {
    app_id: requiredEnvironment("TIKTOK_ADS_APP_ID"),
    secret: requiredEnvironment("TIKTOK_ADS_APP_SECRET"),
    refresh_token: token,
  }, false);
}
