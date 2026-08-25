import { getCurrentSession, requireApiSession } from "@/lib/auth-guard";
import { applyPhysicalInventoryAdjustments } from "@/lib/repository";
import type { PhysicalInventoryAdjustment } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  if (!(await requireApiSession(request))) return Response.json({ ok: false, message: "Authentication required" }, { status: 401 });
  const session = await getCurrentSession({ requestHeaders: request.headers, disableCookieCache: true });
  if (!session?.user) return Response.json({ ok: false, message: "Authentication required" }, { status: 401 });

  const body = await request.json().catch(() => null) as { adjustments?: unknown; note?: unknown } | null;
  if (!Array.isArray(body?.adjustments) || body.adjustments.length === 0 || body.adjustments.length > 200) {
    return Response.json({ ok: false, message: "Choose at least one variant to update" }, { status: 400 });
  }
  const adjustments: PhysicalInventoryAdjustment[] = [];
  const variantIds = new Set<string>();
  for (const candidate of body.adjustments) {
    if (!candidate || typeof candidate !== "object") return Response.json({ ok: false, message: "An inventory adjustment is invalid" }, { status: 400 });
    const value = candidate as Record<string, unknown>;
    if (typeof value.variantId !== "string" || !value.variantId || typeof value.quantity !== "number" || !Number.isSafeInteger(value.quantity) || value.quantity < 0) {
      return Response.json({ ok: false, message: "Inventory values must be whole numbers" }, { status: 400 });
    }
    if (variantIds.has(value.variantId)) return Response.json({ ok: false, message: "Each variant can only be updated once per save" }, { status: 400 });
    variantIds.add(value.variantId);
    adjustments.push({ variantId: value.variantId, quantity: value.quantity });
  }
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 240) : "";

  try {
    const result = await applyPhysicalInventoryAdjustments({ adjustments, note, actor: session.user.name || session.user.email || "Staff" });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return Response.json({ ok: false, message: error instanceof Error ? error.message : "Unable to save inventory" }, { status: 400 });
  }
}
