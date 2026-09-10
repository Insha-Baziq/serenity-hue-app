import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import { refreshTikTokAdsReporting } from "@/lib/tiktok-ads-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function refresh() {
  const result = await refreshTikTokAdsReporting("scheduled");
  console.info("[scheduled-tiktok-ads-summary]", {
    ok: result.ok,
    status: result.status,
    reportStatus: result.reportStatus,
    fetchMode: result.fetchMode,
    rowsFetched: result.rowsFetched,
    rowsWritten: result.rowsWritten,
    rowsSkipped: result.rowsSkipped,
  });
  return Response.json(result, { status: result.ok ? 200 : 503 });
}

const hasQStashKeys = Boolean(process.env.QSTASH_CURRENT_SIGNING_KEY && process.env.QSTASH_NEXT_SIGNING_KEY);

export const POST = hasQStashKeys
  ? verifySignatureAppRouter(refresh)
  : async () => Response.json({ ok: false, message: "QStash signing keys are not configured" }, { status: 503 });
