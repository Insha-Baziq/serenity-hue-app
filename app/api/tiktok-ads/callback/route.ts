import { consumeTikTokAdsOAuthState, saveTikTokAdsConnection } from "@/lib/repository";
import { exchangeTikTokAdsAuthorizationCode, hashTikTokAdsOAuthState, tiktokAdsAdvertiserId, tiktokAdsRedirectUri } from "@/lib/tiktok-ads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cookieValue(cookieHeader: string | null, name: string) {
  const prefix = `${name}=`;
  const value = cookieHeader?.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix));
  if (!value) return "";
  try {
    return decodeURIComponent(value.slice(prefix.length));
  } catch {
    return "";
  }
}

function clearStateCookie() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `tiktok_ads_oauth_state=; Max-Age=0; Path=/api/tiktok-ads/callback; HttpOnly; SameSite=Lax${secure}`;
}

function redirectToKpis(status: "connected" | "error", origin: string) {
  const url = new URL("/kpis", origin);
  url.searchParams.set("view", "ads");
  url.searchParams.set("tiktok_ads", status);
  return new Response(null, {
    status: 302,
    headers: { Location: url.toString(), "Set-Cookie": clearStateCookie(), "Cache-Control": "no-store" },
  });
}

function tiktokAdsCallbackOrigin() {
  return new URL(tiktokAdsRedirectUri()).origin;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = tiktokAdsCallbackOrigin();
  const authCode = url.searchParams.get("auth_code")?.trim() || url.searchParams.get("code")?.trim() || "";
  const state = url.searchParams.get("state")?.trim() ?? "";
  const error = url.searchParams.get("error")?.trim() ?? "";
  const expectedState = cookieValue(request.headers.get("cookie"), "tiktok_ads_oauth_state");

  if (error || !authCode || !state || !expectedState || state !== expectedState) return redirectToKpis("error", origin);

  try {
    if (!(await consumeTikTokAdsOAuthState(hashTikTokAdsOAuthState(state)))) return redirectToKpis("error", origin);
    const tokens = await exchangeTikTokAdsAuthorizationCode(authCode);
    const advertiserId = tiktokAdsAdvertiserId();
    if (!tokens.advertiserIds.includes(advertiserId)) return redirectToKpis("error", origin);
    await saveTikTokAdsConnection({ ...tokens, advertiserId });
    return redirectToKpis("connected", origin);
  } catch {
    return redirectToKpis("error", origin);
  }
}
