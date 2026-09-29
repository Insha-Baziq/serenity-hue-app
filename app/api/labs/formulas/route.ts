import { activityActorForSession, getCurrentSession, requireApiSession } from "@/lib/auth-guard";
import { createLabFormula } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!(await requireApiSession(request))) return Response.json({ ok: false, message: "Authentication required" }, { status: 401 });
  const session = await getCurrentSession({ requestHeaders: request.headers, disableCookieCache: true });
  if (!session?.user) return Response.json({ ok: false, message: "Authentication required" }, { status: 401 });
  try {
    const body = await request.json() as {
      title?: unknown; subtitle?: unknown; notes?: unknown;
      lines?: Array<{ ingredient?: unknown; calculation?: unknown; percentage?: unknown; phase?: unknown; note?: unknown }>;
      output?: { physicalVariantId?: unknown; fillQuantity?: unknown; fillUnit?: unknown } | null;
    };
    if (typeof body.title !== "string" || !Array.isArray(body.lines)) return Response.json({ ok: false, message: "A formula name and at least one ingredient are required" }, { status: 400 });
    const formula = await createLabFormula({
      title: body.title,
      subtitle: typeof body.subtitle === "string" ? body.subtitle : "",
      notes: typeof body.notes === "string" ? body.notes : "",
      lines: body.lines.map((line) => ({
        ingredient: typeof line.ingredient === "string" ? line.ingredient : "",
        calculation: line.calculation === "remainder" || line.calculation === "manual" ? line.calculation : "fixed",
        percentage: typeof line.percentage === "number" ? line.percentage : undefined,
        phase: typeof line.phase === "string" ? line.phase : "",
        note: typeof line.note === "string" ? line.note : "",
      })),
      output: body.output && typeof body.output.physicalVariantId === "string" && typeof body.output.fillQuantity === "number" && (body.output.fillUnit === "g" || body.output.fillUnit === "ml")
        ? { physicalVariantId: body.output.physicalVariantId, fillQuantity: body.output.fillQuantity, fillUnit: body.output.fillUnit }
        : undefined,
      actor: activityActorForSession(session)!,
    });
    return Response.json({ ok: true, formula }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create this formula";
    return Response.json({ ok: false, message: message === "LAB_FORMULA_TITLE_EXISTS" ? "A formula with that name already exists" : message }, { status: 400 });
  }
}
