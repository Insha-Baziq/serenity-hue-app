import { consumeTikTokOAuthState, saveTikTokConnection } from "@/lib/repository";
import { exchangeTikTokAuthorizationCode, hashTikTokOAuthState } from "@/lib/tiktok";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cookieValue(cookieHeader: string | null, name: string) {
  const prefix = `${name}=`;
  const value = cookieHeader?.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix));
  return value ? decodeURIComponent(value.slice(prefix.length)) : "";
}

function clearStateCookie() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `tiktok_oauth_state=; Max-Age=0; Path=/api/tiktok/callback; HttpOnly; SameSite=Lax${secure}`;
}

function redirectToOrders(status: "connected" | "error", origin: string) {
  const url = new URL("/orders", origin);
  url.searchParams.set("tiktok", status);
  return new Response(null, {
    status: 302,
    headers: { Location: url.toString(), "Set-Cookie": clearStateCookie(), "Cache-Control": "no-store" },
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;
  const code = url.searchParams.get("code")?.trim() ?? "";
  const state = url.searchParams.get("state")?.trim() ?? "";
  const error = url.searchParams.get("error")?.trim() ?? "";
  const expectedState = cookieValue(request.headers.get("cookie"), "tiktok_oauth_state");

  if (error || !code || !state || !expectedState || state !== expectedState) return redirectToOrders("error", origin);
  if (!(await consumeTikTokOAuthState(hashTikTokOAuthState(state)))) return redirectToOrders("error", origin);

  try {
    const tokens = await exchangeTikTokAuthorizationCode(code);
    await saveTikTokConnection(tokens);
    return redirectToOrders("connected", origin);
  } catch {
    return redirectToOrders("error", origin);
  }
}
