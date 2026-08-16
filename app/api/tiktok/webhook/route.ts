import { recordTikTokWebhook } from "@/lib/repository";
import { hasValidTikTokWebhookSignature } from "@/lib/tiktok";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

type TikTokWebhookPayload = {
  tts_notification_id?: unknown;
  type?: unknown;
};

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!hasValidTikTokWebhookSignature(rawBody, request.headers.get("authorization"))) {
    return new Response(null, { status: 401 });
  }

  let payload: TikTokWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as TikTokWebhookPayload;
  } catch {
    return new Response(null, { status: 400 });
  }

  const externalEventId = text(payload.tts_notification_id);
  if (!externalEventId) return new Response(null, { status: 400 });
  await recordTikTokWebhook({ externalEventId, topic: text(payload.type) || "unknown" });

  // TikTok requires an empty 200 response within three seconds. Detailed order
  // reconciliation will run separately so a webhook cannot be lost to a slow API call.
  return new Response(null, { status: 200 });
}
