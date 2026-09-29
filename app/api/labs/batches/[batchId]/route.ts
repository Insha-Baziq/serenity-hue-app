import { activityActorForSession, getCurrentSession, requireApiSession } from "@/lib/auth-guard";
import { updateLabBatchPackaging } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  if (!(await requireApiSession(request))) return Response.json({ ok: false, message: "Authentication required" }, { status: 401 });
  const session = await getCurrentSession({ requestHeaders: request.headers, disableCookieCache: true });
  if (!session?.user) return Response.json({ ok: false, message: "Authentication required" }, { status: 401 });
  try {
    const { batchId } = await params;
    const body = await request.json() as { addedQuantity?: unknown; updateInventory?: unknown };
    if (typeof body.addedQuantity !== "number") return Response.json({ ok: false, message: "Enter the amount packaged now" }, { status: 400 });
    if (body.updateInventory !== undefined && typeof body.updateInventory !== "boolean") return Response.json({ ok: false, message: "Choose whether to update inventory" }, { status: 400 });
    const batch = await updateLabBatchPackaging({ batchId, addedQuantity: body.addedQuantity, updateInventory: body.updateInventory !== false, actor: activityActorForSession(session)! });
    return Response.json({ ok: true, batch });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update this batch";
    const friendly = message === "LAB_BATCH_NOT_FOUND" ? "That batch is no longer available"
      : message === "LAB_OUTPUT_NOT_LINKED" ? "Set packaging details for this formula before adding finished units"
      : message === "LAB_OUTPUT_UNIT_MISMATCH" ? "The batch unit and formula fill unit must match"
      : message === "PACKAGED_EXCEEDS_BATCH" ? "Packaged output cannot exceed the batch size"
      : message === "PACKAGED_NOT_WHOLE_UNITS" ? "Packaged output must make a whole number of finished units"
      : message === "PACKAGED_UNIT_MISMATCH" ? "Packaged output and fill size must use the same unit"
      : message;
    return Response.json({ ok: false, message: friendly }, { status: 400 });
  }
}
