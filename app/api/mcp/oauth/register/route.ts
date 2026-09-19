import { jsonResponse, mcpDcrEnabled, mcpEnabled, registerClient } from "@/lib/mcp-auth";
import { enforceMcpRateLimits } from "@/lib/mcp-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function ipAddress(request: Request) { return (request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown").slice(0, 128); }

export async function POST(request: Request) {
  if (!mcpEnabled()) return jsonResponse({ error: "not_found" }, 404);
  if (!mcpDcrEnabled()) return jsonResponse({ error: "invalid_request", error_description: "Dynamic client registration is disabled." }, 403);
  if (!(await enforceMcpRateLimits({ ip: ipAddress(request), endpoint: "oauth" }))) return jsonResponse({ error: "slow_down", error_description: "Too many registration requests." }, 429, { "Retry-After": "60" });
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > 64 * 1024) return jsonResponse({ error: "invalid_request", error_description: "Registration metadata is too large." }, 400);
    const body = JSON.parse(text) as Record<string, unknown>;
    const record = await registerClient({ clientName: body.client_name, clientUri: body.client_uri, redirectUris: body.redirect_uris });
    return jsonResponse({ client_id: record.clientId, client_name: record.clientName, client_uri: record.clientUri, redirect_uris: record.redirectUris, token_endpoint_auth_method: "none" }, 201);
  } catch (error) {
    const message = error instanceof Error && /metadata|client_name|client_uri|redirect|URL|allowlist|HTTPS|loopback/.test(error.message) ? error.message : "Registration metadata is invalid.";
    return jsonResponse({ error: "invalid_client_metadata", error_description: message }, 400);
  }
}
