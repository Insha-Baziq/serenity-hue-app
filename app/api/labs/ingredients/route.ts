import { activityActorForSession, getCurrentSession, requireApiSession } from "@/lib/auth-guard";
import { createLabIngredients, deleteLabIngredient, updateLabIngredient } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!(await requireApiSession(request))) return Response.json({ ok: false, message: "Authentication required" }, { status: 401 });
  const session = await getCurrentSession({ requestHeaders: request.headers, disableCookieCache: true });
  if (!session?.user) return Response.json({ ok: false, message: "Authentication required" }, { status: 401 });
  try {
    const body = await request.json() as { title?: unknown; quantityGrams?: unknown; reorderPointGrams?: unknown };
    if (typeof body.title !== "string") return Response.json({ ok: false, message: "An ingredient name is required" }, { status: 400 });
    if (body.quantityGrams !== undefined && typeof body.quantityGrams !== "number") return Response.json({ ok: false, message: "Quantity must be a number of grams" }, { status: 400 });
    if (body.reorderPointGrams !== undefined && typeof body.reorderPointGrams !== "number") return Response.json({ ok: false, message: "Reorder point must be a number of grams" }, { status: 400 });
    const result = await createLabIngredients({
      ingredients: [{
        title: body.title,
        quantityGrams: body.quantityGrams as number | undefined,
        reorderPointGrams: body.reorderPointGrams as number | undefined,
      }],
      actor: activityActorForSession(session)!,
    });
    if (!result.createdCount) return Response.json({ ok: false, message: "An ingredient with that name already exists" }, { status: 409 });
    return Response.json({ ok: true, ingredient: result.created[0] }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to add this ingredient";
    return Response.json({ ok: false, message }, { status: 400 });
  }
}

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

export async function DELETE(request: Request) {
  if (!(await requireApiSession(request))) return Response.json({ ok: false, message: "Authentication required" }, { status: 401 });
  const session = await getCurrentSession({ requestHeaders: request.headers, disableCookieCache: true });
  if (!session?.user) return Response.json({ ok: false, message: "Authentication required" }, { status: 401 });
  try {
    const body = await request.json() as { id?: unknown };
    if (typeof body.id !== "string" || !body.id.trim()) return Response.json({ ok: false, message: "Ingredient is required" }, { status: 400 });
    await deleteLabIngredient({ id: body.id, actor: activityActorForSession(session)! });
    return Response.json({ ok: true });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "LAB_INGREDIENT_LINKED_TO_FORMULA") return Response.json({ ok: false, message: "Ingredient linked to formula. Remove it from the formula before deleting it." }, { status: 409 });
    if (code === "LAB_INGREDIENT_NOT_FOUND") return Response.json({ ok: false, message: "That ingredient is no longer available." }, { status: 404 });
    return Response.json({ ok: false, message: "Unable to delete this ingredient." }, { status: 400 });
  }
}
