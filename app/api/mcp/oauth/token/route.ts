import { exchangeAuthorizationCode, jsonResponse, mcpEnabled, mcpResourceUrl, resolveClient, rotateRefreshToken, validateRedirectUri } from "@/lib/mcp-auth";
import { enforceMcpRateLimits } from "@/lib/mcp-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function ipAddress(request: Request) { return (request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown").slice(0, 128); }

export async function POST(request: Request) {
  if (!mcpEnabled()) return jsonResponse({ error: "not_found" }, 404);
  if (!(await enforceMcpRateLimits({ ip: ipAddress(request), endpoint: "oauth" }))) return jsonResponse({ error: "slow_down", error_description: "Too many token requests." }, 429, { "Retry-After": "60" });
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > 64 * 1024) return jsonResponse({ error: "invalid_request", error_description: "Token request is too large." }, 400);
    const body = new URLSearchParams(text);
    const clientId = body.get("client_id") ?? "";
    const client = await resolveClient(clientId);
    if (!client) return jsonResponse({ error: "invalid_client" }, 401);
    if (body.get("grant_type") === "authorization_code") {
      const resource = body.get("resource") ?? "";
      if (resource !== mcpResourceUrl()) return jsonResponse({ error: "invalid_target", error_description: "The resource does not match this MCP server." }, 400);
      const redirectUri = validateRedirectUri(body.get("redirect_uri") ?? "", client.redirectUris);
      if (!body.get("code") || !body.get("code_verifier")) return jsonResponse({ error: "invalid_request", error_description: "code and code_verifier are required." }, 400);
      return jsonResponse(await exchangeAuthorizationCode({ code: body.get("code")!, clientId, redirectUri, verifier: body.get("code_verifier")! }));
    }
    if (body.get("grant_type") === "refresh_token") {
      if (!body.get("refresh_token") || body.get("resource") !== mcpResourceUrl()) return jsonResponse({ error: "invalid_grant" }, 400);
      return jsonResponse(await rotateRefreshToken({ refreshToken: body.get("refresh_token")!, clientId, resource: mcpResourceUrl() }));
    }
    return jsonResponse({ error: "unsupported_grant_type" }, 400);
  } catch (error) {
    const code = error instanceof Error && error.message === "invalid_grant" ? "invalid_grant" : "invalid_request";
    return jsonResponse({ error: code, error_description: code === "invalid_grant" ? "The authorization code, verifier, or refresh token is invalid." : "The token request is invalid." }, 400);
  }
}
