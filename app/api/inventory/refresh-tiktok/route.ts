import { requireApiSession } from "@/lib/auth-guard";
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
  try {
    const result = await storeTikTokInventory();
    return Response.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof TikTokNotConnectedError) {
      return Response.json({ ok: false, message: "TikTok Shop is not connected on this deployment" }, { status: 409 });
    }
    return Response.json(
      { ok: false, message: error instanceof Error ? error.message : "TikTok inventory refresh failed" },
      { status: 502 },
    );
  }
}
