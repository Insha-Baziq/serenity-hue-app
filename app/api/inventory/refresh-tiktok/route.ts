import { activityActorForSession, getCurrentSession, requireApiSession } from "@/lib/auth-guard";
import { ensurePhysicalChannelListings, getPhysicalChannelListings, recordActivityEvent } from "@/lib/repository";
import { storeTikTokInventory } from "@/lib/tiktok-inventory";
import { TikTokNotConnectedError } from "@/lib/tiktok-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Fetches live TikTok Shop inventory and caches it into channel_inventory. Read-only against TikTok. */
export async function POST(request: Request) {
  if (!(await requireApiSession(request))) {
    return Response.json({ ok: false, message: "Authentication required" }, { status: 401 });
  }
  const session = await getCurrentSession({ requestHeaders: request.headers, disableCookieCache: true });
  if (!session?.user) return Response.json({ ok: false, message: "Authentication required" }, { status: 401 });
  const actor = activityActorForSession(session)!;
  const syncId = crypto.randomUUID();
  try {
    const result = await storeTikTokInventory();
    await recordActivityEvent({ actor, source: "manual", provider: "tiktok", eventName: "sync.tiktok-inventory", entityType: "sync", entityId: syncId, summary: `TikTok inventory refresh completed: ${result.skus} live SKUs inspected`, details: { trigger: "manual", skus: result.skus, products: result.products, matched: result.matched, removed: result.removed }, outcome: "succeeded", dedupeKey: `${syncId}:sync.tiktok-inventory` });
    await ensurePhysicalChannelListings();
    const listings = await getPhysicalChannelListings("tiktok");
    return Response.json({ ok: true, ...result, listings });
  } catch (error) {
    await recordActivityEvent({ actor, source: "manual", provider: "tiktok", eventName: "sync.tiktok-inventory", entityType: "sync", entityId: syncId, summary: error instanceof TikTokNotConnectedError ? "Skipped TikTok inventory refresh because the provider is not connected" : "TikTok inventory refresh failed", details: { trigger: "manual", reason: error instanceof TikTokNotConnectedError ? "not_connected" : "provider_error" }, outcome: error instanceof TikTokNotConnectedError ? "skipped" : "failed", dedupeKey: `${syncId}:sync.tiktok-inventory` }).catch(() => undefined);
    if (error instanceof TikTokNotConnectedError) {
      return Response.json({ ok: false, message: "TikTok Shop is not connected on this deployment" }, { status: 409 });
    }
    return Response.json(
      { ok: false, message: error instanceof Error ? error.message : "TikTok inventory refresh failed" },
      { status: 502 },
    );
  }
}
