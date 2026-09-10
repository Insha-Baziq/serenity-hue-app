import { requireApiSession } from "@/lib/auth-guard";
import { rateLimitedResponse, takeRateLimit } from "@/lib/rate-limit";
import { refreshTikTokAdsReporting } from "@/lib/tiktok-ads-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  if (!(await requireApiSession(request))) return Response.json({ ok: false, message: "Authentication required" }, { status: 401 });
  const limit = takeRateLimit(request, { name: "tiktok-ads-refresh", limit: 5, windowMs: 5 * 60 * 1000 });
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);
  const result = await refreshTikTokAdsReporting("manual");
  const status = result.status === "failed" ? 503 : result.status === "skipped" ? 409 : 200;
  return Response.json(result, { status });
}
