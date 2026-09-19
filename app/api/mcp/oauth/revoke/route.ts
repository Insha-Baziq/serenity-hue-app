import { jsonResponse, mcpEnabled, revokeToken } from "@/lib/mcp-auth";
import { enforceMcpRateLimits } from "@/lib/mcp-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function ipAddress(request: Request) { return (request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown").slice(0, 128); }

export async function POST(request: Request) {
  if (!mcpEnabled()) return jsonResponse({ error: "not_found" }, 404);
  if (!(await enforceMcpRateLimits({ ip: ipAddress(request), endpoint: "oauth" }))) return jsonResponse({ error: "slow_down", error_description: "Too many revocation requests." }, 429, { "Retry-After": "60" });
  try {
    const body = new URLSearchParams(await request.text());
    const token = body.get("token");
    if (token) await revokeToken(token);
  } catch { /* RFC 7009 clients should not learn whether a token existed. */ }
  return jsonResponse({}, 200);
}
