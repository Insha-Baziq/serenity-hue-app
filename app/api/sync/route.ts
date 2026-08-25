import { syncDirectChannels } from "@/lib/sync";
import { requireApiSession } from "@/lib/auth-guard";
import { rateLimitedResponse, takeRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  if (!(await requireApiSession(request))) return Response.json({ ok: false, message: "Authentication required" }, { status: 401 });
  const limit = takeRateLimit(request, { name: "manual-sync", limit: 5, windowMs: 5 * 60 * 1000 });
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);
  const result = await syncDirectChannels("manual");
  return Response.json(result, { status: result.ok ? 200 : 503 });
}
