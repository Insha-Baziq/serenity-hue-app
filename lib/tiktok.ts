import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const TIKTOK_AUTH_BASE_URL = "https://auth.tiktok-shops.com";
const TIKTOK_OPEN_API_BASE_URL = "https://open-api.tiktokglobalshop.com";
const TIKTOK_ROW_AUTHORIZATION_URL = "https://services.tiktokshop.com/open/authorize";
const TIKTOK_US_AUTHORIZATION_URL = "https://services.us.tiktokshop.com/open/authorize";

type TikTokTokenData = {
  access_token?: unknown;
  refresh_token?: unknown;
  access_token_expire_in?: unknown;
  refresh_token_expire_in?: unknown;
  open_id?: unknown;
  user_type?: unknown;
  granted_scopes?: unknown;
};

type TikTokTokenResponse = {
  code?: unknown;
  message?: unknown;
  data?: TikTokTokenData;
};

export type TikTokTokenBundle = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt?: string;
  refreshTokenExpiresAt?: string;
  openId?: string;
  userType?: number;
  grantedScopes: string[];
};

function requiredEnvironment(name: "TIKTOK_SHOP_APP_KEY" | "TIKTOK_SHOP_APP_SECRET" | "TIKTOK_SHOP_SERVICE_ID") {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name} in server environment`);
  return value;
}

export function hasTikTokAppCredentials() {
  return Boolean(
    process.env.TIKTOK_SHOP_APP_KEY?.trim() &&
    process.env.TIKTOK_SHOP_APP_SECRET?.trim() &&
    process.env.TIKTOK_SHOP_SERVICE_ID?.trim(),
  );
}

/** Credentials required for signed Open API calls after a seller authorizes the app. */
export function hasTikTokApiCredentials() {
  return Boolean(process.env.TIKTOK_SHOP_APP_KEY?.trim() && process.env.TIKTOK_SHOP_APP_SECRET?.trim());
}

export function tiktokRedirectUri() {
  const configured = process.env.TIKTOK_SHOP_REDIRECT_URI?.trim();
  if (configured) return configured;
  const appUrl = process.env.APP_URL?.trim() || "http://localhost:3000";
  return `${appUrl.replace(/\/$/, "")}/api/tiktok/callback`;
}

export function tiktokAuthorizationUrl(state: string) {
  const serviceId = requiredEnvironment("TIKTOK_SHOP_SERVICE_ID");
  const region = process.env.TIKTOK_SHOP_REGION?.trim().toUpperCase();
  const baseUrl = region === "US" ? TIKTOK_US_AUTHORIZATION_URL : TIKTOK_ROW_AUTHORIZATION_URL;
  const url = new URL(baseUrl);
  url.searchParams.set("service_id", serviceId);
  url.searchParams.set("state", state);
  return url.toString();
}

export function hashTikTokOAuthState(state: string) {
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
  // TikTok's `*_expire_in` fields are durations in seconds. Keeping support
  // for an epoch value makes the parser tolerant of a future API revision.
  const epoch = seconds > Date.now() / 1000 ? seconds : Date.now() / 1000 + seconds;
  return new Date(epoch * 1000).toISOString();
}

function scopes(value: unknown) {
  if (Array.isArray(value)) return value.filter((scope): scope is string => typeof scope === "string" && scope.trim().length > 0);
  if (typeof value === "string") return value.split(/[\s,]+/).map((scope) => scope.trim()).filter(Boolean);
  return [];
}

export async function exchangeTikTokAuthorizationCode(authCode: string): Promise<TikTokTokenBundle> {
  const code = authCode.trim();
  if (!code) throw new Error("TikTok authorization code is missing");

  const url = new URL("/api/v2/token/get", TIKTOK_AUTH_BASE_URL);
  url.searchParams.set("app_key", requiredEnvironment("TIKTOK_SHOP_APP_KEY"));
  url.searchParams.set("app_secret", requiredEnvironment("TIKTOK_SHOP_APP_SECRET"));
  url.searchParams.set("auth_code", code);
  url.searchParams.set("grant_type", "authorized_code");

  const response = await fetch(url, { method: "GET", cache: "no-store" });
  let payload: TikTokTokenResponse | undefined;
  try {
    payload = await response.json() as TikTokTokenResponse;
  } catch {
    payload = undefined;
  }
  const data = payload?.data;
  const accessToken = stringValue(data?.access_token);
  const refreshToken = stringValue(data?.refresh_token);
  const apiCode = numberValue(payload?.code);
  if (!response.ok || apiCode !== 0 || !accessToken || !refreshToken) {
    throw new Error(`TikTok token exchange failed (HTTP ${response.status}, code ${apiCode ?? "unknown"})`);
  }

  return {
    accessToken,
    refreshToken,
    accessTokenExpiresAt: tokenExpiryToIso(data?.access_token_expire_in),
    refreshTokenExpiresAt: tokenExpiryToIso(data?.refresh_token_expire_in),
    openId: stringValue(data?.open_id) || undefined,
    userType: numberValue(data?.user_type),
    grantedScopes: scopes(data?.granted_scopes),
  };
}

export async function refreshTikTokAccessToken(refreshToken: string): Promise<TikTokTokenBundle> {
  const token = refreshToken.trim();
  if (!token) throw new Error("TikTok refresh token is missing");

  const url = new URL("/api/v2/token/refresh", TIKTOK_AUTH_BASE_URL);
  url.searchParams.set("app_key", requiredEnvironment("TIKTOK_SHOP_APP_KEY"));
  url.searchParams.set("app_secret", requiredEnvironment("TIKTOK_SHOP_APP_SECRET"));
  url.searchParams.set("refresh_token", token);
  url.searchParams.set("grant_type", "refresh_token");

  const response = await fetch(url, { method: "GET", cache: "no-store" });
  let payload: TikTokTokenResponse | undefined;
  try {
    payload = await response.json() as TikTokTokenResponse;
  } catch {
    payload = undefined;
  }
  const data = payload?.data;
  const accessToken = stringValue(data?.access_token);
  const nextRefreshToken = stringValue(data?.refresh_token) || token;
  const apiCode = numberValue(payload?.code);
  if (!response.ok || apiCode !== 0 || !accessToken) {
    throw new Error(`TikTok token refresh failed (HTTP ${response.status}, code ${apiCode ?? "unknown"})`);
  }

  return {
    accessToken,
    refreshToken: nextRefreshToken,
    accessTokenExpiresAt: tokenExpiryToIso(data?.access_token_expire_in),
    refreshTokenExpiresAt: tokenExpiryToIso(data?.refresh_token_expire_in),
    openId: stringValue(data?.open_id) || undefined,
    userType: numberValue(data?.user_type),
    grantedScopes: scopes(data?.granted_scopes),
  };
}

type TikTokQueryValue = string | number | boolean | undefined | null;

export type TikTokApiEnvelope<T> = {
  code?: unknown;
  message?: unknown;
  request_id?: unknown;
  data?: T;
};

/**
 * Calls TikTok Shop's signed Open API. The signature intentionally uses the
 * same JSON string that is sent over the wire so POST requests cannot drift
 * from the data TikTok verifies.
 */
export async function tiktokApiRequest<T>(input: {
  path: string;
  method: "GET" | "POST";
  accessToken: string;
  query?: Record<string, TikTokQueryValue>;
  body?: unknown;
}): Promise<T> {
  const appKey = requiredEnvironment("TIKTOK_SHOP_APP_KEY");
  const appSecret = requiredEnvironment("TIKTOK_SHOP_APP_SECRET");
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const entries = Object.entries({ app_key: appKey, timestamp, ...input.query })
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => [key, String(value)] as const);
  const body = input.body === undefined ? "" : JSON.stringify(input.body);
  const signingParameters = entries
    .filter(([key]) => key !== "sign" && key !== "access_token")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}${value}`)
    .join("");
  const signingPayload = `${appSecret}${input.path}${signingParameters}${body}${appSecret}`;
  const signature = createHmac("sha256", appSecret).update(signingPayload, "utf8").digest("hex");

  const url = new URL(input.path, TIKTOK_OPEN_API_BASE_URL);
  for (const [key, value] of entries) url.searchParams.set(key, value);
  url.searchParams.set("sign", signature);
  const response = await fetch(url, {
    method: input.method,
    cache: "no-store",
    headers: {
      "x-tts-access-token": input.accessToken,
      ...(input.method === "POST" ? { "content-type": "application/json" } : {}),
    },
    body: input.method === "POST" ? body : undefined,
  });
  let envelope: TikTokApiEnvelope<T> | undefined;
  try {
    envelope = await response.json() as TikTokApiEnvelope<T>;
  } catch {
    envelope = undefined;
  }
  const apiCode = numberValue(envelope?.code);
  if (!response.ok || apiCode !== 0 || !envelope?.data) {
    throw new Error(`TikTok Open API request failed (HTTP ${response.status}, code ${apiCode ?? "unknown"})`);
  }
  return envelope.data;
}

export function hasValidTikTokWebhookSignature(rawBody: string, authorizationHeader: string | null) {
  const appKey = process.env.TIKTOK_SHOP_APP_KEY?.trim();
  const appSecret = process.env.TIKTOK_SHOP_APP_SECRET?.trim();
  const suppliedSignature = authorizationHeader?.trim().replace(/^(?:sha256=|HMAC-SHA256\s+)/i, "") ?? "";
  if (!appKey || !appSecret || !suppliedSignature || !/^[a-f0-9]{64}$/i.test(suppliedSignature)) return false;

  const expectedSignature = createHmac("sha256", appSecret).update(`${appKey}${rawBody}`, "utf8").digest("hex");
  const supplied = Buffer.from(suppliedSignature.toLowerCase(), "utf8");
  const expected = Buffer.from(expectedSignature, "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
