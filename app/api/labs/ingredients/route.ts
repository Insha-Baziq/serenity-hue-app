import { activityActorForSession, getCurrentSession, requireApiSession } from "@/lib/auth-guard";
import { updateLabIngredient } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  if (!(await requireApiSession(request))) return Response.json({ ok: false, message: "Authentication required" }, { status: 401 });
  const session = await getCurrentSession({ requestHeaders: request.headers, disableCookieCache: true });
  if (!session?.user) return Response.json({ ok: false, message: "Authentication required" }, { status: 401 });
  try {
    const body = await request.json() as { id?: unknown; quantityGrams?: unknown; reorderPointGrams?: unknown };
    if (typeof body.id !== "string" || typeof body.quantityGrams !== "number") return Response.json({ ok: false, message: "Ingredient and quantity in grams are required" }, { status: 400 });
    const items = await updateLabIngredient({ id: body.id, quantityGrams: body.quantityGrams, reorderPointGrams: typeof body.reorderPointGrams === "number" ? body.reorderPointGrams : undefined, actor: activityActorForSession(session)! });
    return Response.json({ ok: true, items });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update ingredient inventory";
    return Response.json({ ok: false, message: message === "LAB_INGREDIENT_NOT_FOUND" ? "That ingredient is no longer available" : message }, { status: message === "LAB_INGREDIENT_NOT_FOUND" ? 404 : 400 });
  }
}
