import { addPhysicalInventoryVariant, deletePhysicalProduct, updatePhysicalProduct } from "@/lib/repository";
import { requireApiSession } from "@/lib/auth-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function body(request: Request) {
  return await request.json().catch(() => null) as Record<string, unknown> | null;
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unable to update master product";
  const status = message.includes("not found") ? 404 : message.includes("mappings") || message.includes("already exists") ? 409 : 400;
  return Response.json({ ok: false, message }, { status });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  if (!(await requireApiSession(request))) return Response.json({ ok: false, message: "Authentication required" }, { status: 401 });
  const { productId } = await params;
  const payload = await body(request);
  const title = typeof payload?.title === "string" ? payload.title.trim() : "";
  if (!title || title.length > 160) return Response.json({ ok: false, message: "Enter a product name up to 160 characters" }, { status: 400 });
  try { return Response.json({ ok: true, product: await updatePhysicalProduct({ itemId: productId, title }) }); } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  if (!(await requireApiSession(request))) return Response.json({ ok: false, message: "Authentication required" }, { status: 401 });
  const { productId } = await params;
  const payload = await body(request);
  const title = typeof payload?.title === "string" ? payload.title.trim() : "";
  const sku = typeof payload?.sku === "string" ? payload.sku.trim() : null;
  if (!title || title.length > 160) return Response.json({ ok: false, message: "Enter a variant name up to 160 characters" }, { status: 400 });
  if (sku && sku.length > 120) return Response.json({ ok: false, message: "SKU must be 120 characters or fewer" }, { status: 400 });
  try { return Response.json({ ok: true, product: await addPhysicalInventoryVariant({ itemId: productId, title, sku }) }); } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  if (!(await requireApiSession(request))) return Response.json({ ok: false, message: "Authentication required" }, { status: 401 });
  const { productId } = await params;
  try { await deletePhysicalProduct(productId); return Response.json({ ok: true }); } catch (error) { return errorResponse(error); }
}
