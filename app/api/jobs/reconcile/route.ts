import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import { syncDirectChannels } from "@/lib/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function reconcile() {
  const result = await syncDirectChannels("scheduled");
  console.info("[scheduled-sync-summary]", {
    ok: result.ok,
    status: result.status,
    recordsSeen: result.recordsSeen,
    recordsChanged: result.recordsChanged,
    message: result.message,
    tiktokSample: result.tiktokSample,
  });
  return Response.json(result, { status: result.ok ? 200 : 503 });
}

const hasQStashKeys = Boolean(process.env.QSTASH_CURRENT_SIGNING_KEY && process.env.QSTASH_NEXT_SIGNING_KEY);

export const POST = hasQStashKeys
  ? verifySignatureAppRouter(reconcile)
  : async () => Response.json({ ok: false, message: "QStash signing keys are not configured" }, { status: 503 });
