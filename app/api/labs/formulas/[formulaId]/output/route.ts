import { activityActorForSession, getCurrentSession, requireApiSession } from "@/lib/auth-guard";
import { updateLabFormulaOutput } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(request: Request, { params }: { params: Promise<{ formulaId: string }> }) {
  if (!(await requireApiSession(request))) return Response.json({ ok: false, message: "Authentication required" }, { status: 401 });
  const session = await getCurrentSession({ requestHeaders: request.headers, disableCookieCache: true });
  if (!session?.user) return Response.json({ ok: false, message: "Authentication required" }, { status: 401 });
  try {
    const { formulaId } = await params;
    const body = await request.json() as { physicalVariantId?: unknown; fillQuantity?: unknown; fillUnit?: unknown };
    if (typeof body.physicalVariantId !== "string" || typeof body.fillQuantity !== "number" || (body.fillUnit !== "g" && body.fillUnit !== "ml")) {
      return Response.json({ ok: false, message: "Choose a master-inventory variant, fill amount, and unit" }, { status: 400 });
    }
    const formula = await updateLabFormulaOutput({ formulaId, physicalVariantId: body.physicalVariantId, fillQuantity: body.fillQuantity, fillUnit: body.fillUnit, actor: activityActorForSession(session)! });
    return Response.json({ ok: true, formula });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save packaging setup";
    const friendly = message === "LAB_FORMULA_NOT_FOUND" ? "That formula is no longer available" : message === "LAB_OUTPUT_VARIANT_NOT_FOUND" ? "That master-inventory variant is no longer available" : message;
    return Response.json({ ok: false, message: friendly }, { status: 400 });
  }
}
