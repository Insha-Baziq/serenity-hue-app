import { jsonResponse, mcpEnabled, protectedResourceMetadata } from "@/lib/mcp-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  if (!mcpEnabled()) return jsonResponse({ error: "not_found" }, 404);
  return jsonResponse(protectedResourceMetadata());
}
