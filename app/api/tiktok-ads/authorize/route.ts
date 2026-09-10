import { createTikTokAdsOAuthState } from "@/lib/repository";
import { hasTikTokAdsAdvertiserId, hasTikTokAdsAppCredentials, hashTikTokAdsOAuthState, tiktokAdsAuthorizationUrl } from "@/lib/tiktok-ads";
import { requireApiSession } from "@/lib/auth-guard";
import { rateLimitedResponse, takeRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_TTL_MS = 10 * 60 * 1000;

function stateCookie(value: string, maxAge: number) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `tiktok_ads_oauth_state=${value}; Max-Age=${maxAge}; Path=/api/tiktok-ads/callback; HttpOnly; SameSite=Lax${secure}`;
}

export async function GET(request: Request) {
  if (!(await requireApiSession(request))) return Response.json({ message: "Authentication required" }, { status: 401 });
  const limit = takeRateLimit(request, { name: "tiktok-ads-authorize", limit: 10, windowMs: 10 * 60 * 1000 });
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);
  if (!hasTikTokAdsAppCredentials() || !hasTikTokAdsAdvertiserId()) {
    return Response.json({ message: "TikTok Ads configuration is incomplete" }, { status: 503 });
  }

  const state = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + STATE_TTL_MS).toISOString();
  await createTikTokAdsOAuthState({ id: `tiktok-ads-state:${state}`, stateHash: hashTikTokAdsOAuthState(state), expiresAt });

  return new Response(null, {
    status: 302,
    headers: {
      Location: tiktokAdsAuthorizationUrl(state),
      "Set-Cookie": stateCookie(state, STATE_TTL_MS / 1000),
      "Cache-Control": "no-store",
    },
  });
}
