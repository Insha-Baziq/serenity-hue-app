import { getCurrentSession, requireApiSession } from "@/lib/auth-guard";
import { createLabBatch } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!(await requireApiSession(request))) return Response.json({ ok: false, message: "Authentication required" }, { status: 401 });
  const session = await getCurrentSession({ requestHeaders: request.headers, disableCookieCache: true });
  if (!session?.user) return Response.json({ ok: false, message: "Authentication required" }, { status: 401 });
  try {
    const body = await request.json() as { formulaId?: unknown; batchNumber?: unknown; targetGrams?: unknown };
    if (typeof body.formulaId !== "string" || typeof body.batchNumber !== "string" || typeof body.targetGrams !== "number") return Response.json({ ok: false, message: "Formula, batch number, and batch size in grams are required" }, { status: 400 });
    const batch = await createLabBatch({ formulaId: body.formulaId, batchNumber: body.batchNumber, targetGrams: body.targetGrams, actor: session.user.name || session.user.email || "Staff" });
    return Response.json({ ok: true, batch }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create this batch";
    if (message.startsWith("LAB_INGREDIENTS_UNAVAILABLE:")) return Response.json({ ok: false, message: `Count or replenish before creating this batch: ${message.slice("LAB_INGREDIENTS_UNAVAILABLE:".length)}` }, { status: 409 });
    if (message === "LAB_BATCH_ALREADY_EXISTS") return Response.json({ ok: false, message: "That batch number already exists" }, { status: 409 });
    return Response.json({ ok: false, message: message === "LAB_FORMULA_NOT_FOUND" ? "That formula is no longer available" : message }, { status: 400 });
  }
}
