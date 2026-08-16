import { createTikTokOAuthState } from "@/lib/repository";
import { hasTikTokAppCredentials, hashTikTokOAuthState, tiktokAuthorizationUrl } from "@/lib/tiktok";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_TTL_MS = 10 * 60 * 1000;

function stateCookie(value: string, maxAge: number) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `tiktok_oauth_state=${value}; Max-Age=${maxAge}; Path=/api/tiktok/callback; HttpOnly; SameSite=Lax${secure}`;
}

export async function GET() {
  if (!hasTikTokAppCredentials()) {
    return Response.json({ message: "TikTok app credentials are not configured" }, { status: 503 });
  }

  const state = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + STATE_TTL_MS).toISOString();
  await createTikTokOAuthState({ id: `tiktok-state:${state}`, stateHash: hashTikTokOAuthState(state), expiresAt });

  return new Response(null, {
    status: 302,
    headers: {
      Location: tiktokAuthorizationUrl(state),
      "Set-Cookie": stateCookie(state, STATE_TTL_MS / 1000),
      "Cache-Control": "no-store",
    },
  });
}
