import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createSerenityHueMcpServer } from "@/lib/mcp-server";
import { authenticateAccessToken, bearerToken, jsonResponse, mcpEnabled, mcpIssuerUrl } from "@/lib/mcp-auth";
import { enforceMcpRateLimits, releaseTokenConcurrency, tryAcquireTokenConcurrency } from "@/lib/mcp-rate-limit";
import { logMcpEvent, mcpRequestId } from "@/lib/mcp-logging";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_MCP_REQUEST_BYTES = 64 * 1024;

function ipAddress(request: Request) {
  return (request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown").slice(0, 128);
}

function unauthorized(message = "A valid MCP bearer token is required.") {
  const metadata = `${mcpIssuerUrl()}/.well-known/oauth-protected-resource`;
  return jsonResponse({ error: "unauthorized", message }, 401, { "WWW-Authenticate": `Bearer realm="serenity-hue-mcp", resource_metadata="${metadata}"` });
}

export async function POST(request: Request) {
  if (!mcpEnabled()) return jsonResponse({ error: "not_found" }, 404);
  const requestId = mcpRequestId(request);
  const advertisedLength = Number(request.headers.get("content-length") ?? "0");
  if (advertisedLength > MAX_MCP_REQUEST_BYTES) return jsonResponse({ error: "request_too_large", message: "The MCP request body is too large." }, 413, { "X-Request-Id": requestId });
  try {
    const bodyLength = (await request.clone().arrayBuffer()).byteLength;
    if (bodyLength > MAX_MCP_REQUEST_BYTES) return jsonResponse({ error: "request_too_large", message: "The MCP request body is too large." }, 413, { "X-Request-Id": requestId });
  } catch {
    return jsonResponse({ error: "invalid_request", message: "The MCP request body could not be read." }, 400, { "X-Request-Id": requestId });
  }
  const token = bearerToken(request);
  if (!token) return unauthorized();
  if (!(await enforceMcpRateLimits({ token, ip: ipAddress(request), endpoint: "mcp" }))) return jsonResponse({ error: "rate_limited", message: "Too many MCP requests. Try again shortly." }, 429, { "Retry-After": "60" });

  let principal;
  try { principal = await authenticateAccessToken(token); }
  catch { return unauthorized("The MCP bearer token is invalid, expired, revoked, or bound to another resource."); }
  if (!tryAcquireTokenConcurrency(token)) return jsonResponse({ error: "concurrency_limited", message: "Too many concurrent MCP requests for this token." }, 429, { "Retry-After": "5" });
  try {
    const server = createSerenityHueMcpServer(principal, requestId);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-store");
    headers.set("Pragma", "no-cache");
    headers.set("X-Request-Id", requestId);
    logMcpEvent({ event: "mcp_request", success: response.status < 400, reasonCode: response.status < 400 ? undefined : "protocol_error", requestId, clientId: principal.clientId, userId: principal.userId, statusCode: response.status });
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  } finally { releaseTokenConcurrency(token); }
}

export async function GET(request: Request) {
  if (!mcpEnabled()) return jsonResponse({ error: "not_found" }, 404);
  const token = bearerToken(request);
  if (!token) return unauthorized();
  return jsonResponse({ error: "method_not_supported", message: "Use POST for stateless MCP requests." }, 405, { Allow: "POST" });
}

export async function DELETE() {
  if (!mcpEnabled()) return jsonResponse({ error: "not_found" }, 404);
  return jsonResponse({ error: "method_not_supported", message: "This connector is stateless; there is no server session to delete." }, 405, { Allow: "POST" });
}
