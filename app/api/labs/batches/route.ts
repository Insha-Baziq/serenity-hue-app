import { activityActorForSession, getCurrentSession, requireApiSession } from "@/lib/auth-guard";
import { createLabBatch } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!(await requireApiSession(request))) return Response.json({ ok: false, message: "Authentication required" }, { status: 401 });
  const session = await getCurrentSession({ requestHeaders: request.headers, disableCookieCache: true });
  if (!session?.user) return Response.json({ ok: false, message: "Authentication required" }, { status: 401 });
  try {
    const body = await request.json() as { formulaId?: unknown; batchNumber?: unknown; targetGrams?: unknown; outputQuantity?: unknown; outputUnit?: unknown };
    if (typeof body.formulaId !== "string" || typeof body.batchNumber !== "string" || typeof body.targetGrams !== "number") return Response.json({ ok: false, message: "Formula, batch number, and batch size in grams are required" }, { status: 400 });
    if (body.outputQuantity !== undefined && typeof body.outputQuantity !== "number") return Response.json({ ok: false, message: "Bulk output quantity must be a number" }, { status: 400 });
    if (body.outputUnit !== undefined && body.outputUnit !== "g" && body.outputUnit !== "ml") return Response.json({ ok: false, message: "Bulk output unit must be grams or milliliters" }, { status: 400 });
    const batch = await createLabBatch({ formulaId: body.formulaId, batchNumber: body.batchNumber, targetGrams: body.targetGrams, outputQuantity: body.outputQuantity as number | undefined, outputUnit: body.outputUnit as "g" | "ml" | undefined, actor: activityActorForSession(session)! });
    return Response.json({ ok: true, batch }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create this batch";
    if (message === "LAB_BATCH_ALREADY_EXISTS") return Response.json({ ok: false, message: "That batch number already exists" }, { status: 409 });
    if (message === "LAB_OUTPUT_QUANTITY_REQUIRED") return Response.json({ ok: false, message: "Enter the bulk output quantity for this linked formula" }, { status: 400 });
    if (message === "LAB_PACKAGING_UNIT_MISMATCH") return Response.json({ ok: false, message: "Bulk output must use the formula fill unit" }, { status: 400 });
    return Response.json({ ok: false, message: message === "LAB_FORMULA_NOT_FOUND" ? "That formula is no longer available" : message }, { status: 400 });
  }
}
