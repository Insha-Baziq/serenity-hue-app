import { requireApiSession } from "@/lib/auth-guard";
import { savePhysicalChannelProductLink } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProductLinkPayload = {
  channel?: unknown;
  externalProductId?: unknown;
  physicalItemId?: unknown;
};

/** Stores a product-family association without changing exact variant deductions. */
export async function PATCH(request: Request) {
  if (!(await requireApiSession(request))) return Response.json({ ok: false, message: "Authentication required" }, { status: 401 });

  let body: ProductLinkPayload;
  try {
    body = await request.json() as ProductLinkPayload;
  } catch {
    return Response.json({ ok: false, message: "A JSON product association payload is required" }, { status: 400 });
  }
  const channel = body.channel === "shopify" || body.channel === "tiktok" ? body.channel : null;
  const externalProductId = typeof body.externalProductId === "string" ? body.externalProductId.trim() : "";
  const physicalItemId = typeof body.physicalItemId === "string" && body.physicalItemId.trim() ? body.physicalItemId.trim() : null;
  if (!channel || !externalProductId) return Response.json({ ok: false, message: "Channel and product details are required" }, { status: 400 });

  try {
    const listings = await savePhysicalChannelProductLink({ channel, externalProductId, physicalItemId });
    return Response.json({ ok: true, listings });
  } catch (error) {
    return Response.json({ ok: false, message: error instanceof Error ? error.message : "Unable to save the product association" }, { status: 400 });
  }
}
