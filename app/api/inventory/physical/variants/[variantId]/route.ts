import { deletePhysicalInventoryVariant, updatePhysicalInventoryVariant } from "@/lib/repository";
import { requireApiSession } from "@/lib/auth-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function payload(request: Request) { return await request.json().catch(() => null) as Record<string, unknown> | null; }
function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unable to update variant";
  const status = message.includes("not found") ? 404 : message.includes("mappings") || message.includes("exists") || message.includes("at least one") ? 409 : 400;
  return Response.json({ ok: false, message }, { status });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ variantId: string }> }) {
  if (!(await requireApiSession(request))) return Response.json({ ok: false, message: "Authentication required" }, { status: 401 });
  const { variantId } = await params;
  const body = await payload(request);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const sku = typeof body?.sku === "string" ? body.sku.trim() : null;
  if (!title || title.length > 160) return Response.json({ ok: false, message: "Enter a variant name up to 160 characters" }, { status: 400 });
  if (sku && sku.length > 120) return Response.json({ ok: false, message: "SKU must be 120 characters or fewer" }, { status: 400 });
  try { return Response.json({ ok: true, product: await updatePhysicalInventoryVariant({ variantId, title, sku }) }); } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ variantId: string }> }) {
  if (!(await requireApiSession(request))) return Response.json({ ok: false, message: "Authentication required" }, { status: 401 });
  const { variantId } = await params;
  try { return Response.json({ ok: true, product: await deletePhysicalInventoryVariant(variantId) }); } catch (error) { return errorResponse(error); }
}
