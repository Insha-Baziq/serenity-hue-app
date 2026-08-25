import { getCurrentSession, requireApiSession } from "@/lib/auth-guard";
import { createPackagingMaterial, deletePackagingMaterial, updatePackagingMaterial } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PackagingPayload = { id?: unknown; title?: unknown; quantity?: unknown };

function parsePayload(value: unknown) {
  const body = (value ?? {}) as PackagingPayload;
  const title = typeof body.title === "string" ? body.title : "";
  const quantity =
    typeof body.quantity === "number"
      ? body.quantity
      : typeof body.quantity === "string" && body.quantity.trim() !== ""
        ? Number(body.quantity)
        : Number.NaN;
  return { id: typeof body.id === "string" ? body.id : "", title, quantity };
}

function errorResponse(error: unknown) {
  if (error instanceof Error && error.message === "PACKAGING_ALREADY_EXISTS") {
    return Response.json({ ok: false, message: "A packaging option with that name already exists" }, { status: 409 });
  }
  if (error instanceof Error && error.message === "PACKAGING_NOT_FOUND") {
    return Response.json({ ok: false, message: "That packaging option is no longer available" }, { status: 404 });
  }
  if (error instanceof Error && (error.message.includes("Packaging name") || error.message.includes("Packaging quantity"))) {
    return Response.json({ ok: false, message: error.message }, { status: 400 });
  }
  return Response.json({ ok: false, message: "Unable to update packaging right now" }, { status: 500 });
}

export async function POST(request: Request) {
  if (!(await requireApiSession(request))) return Response.json({ ok: false, message: "Authentication required" }, { status: 401 });
  const session = await getCurrentSession({ requestHeaders: request.headers, disableCookieCache: true });
  if (!session?.user) return Response.json({ ok: false, message: "Authentication required" }, { status: 401 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, message: "Invalid request body" }, { status: 400 });
  }
  const { title, quantity } = parsePayload(body);
  try {
    const item = await createPackagingMaterial({ title, quantity });
    return Response.json({ ok: true, item }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  if (!(await requireApiSession(request))) return Response.json({ ok: false, message: "Authentication required" }, { status: 401 });
  const session = await getCurrentSession({ requestHeaders: request.headers, disableCookieCache: true });
  if (!session?.user) return Response.json({ ok: false, message: "Authentication required" }, { status: 401 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, message: "Invalid request body" }, { status: 400 });
  }
  const { id, title, quantity } = parsePayload(body);
  if (!id) return Response.json({ ok: false, message: "Packaging id is required" }, { status: 400 });
  const actor = session.user.name || session.user.email || "Staff";
  try {
    const result = await updatePackagingMaterial({ id, title, quantity, actor });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  if (!(await requireApiSession(request))) return Response.json({ ok: false, message: "Authentication required" }, { status: 401 });
  const session = await getCurrentSession({ requestHeaders: request.headers, disableCookieCache: true });
  if (!session?.user) return Response.json({ ok: false, message: "Authentication required" }, { status: 401 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, message: "Invalid request body" }, { status: 400 });
  }
  const { id } = parsePayload(body);
  if (!id) return Response.json({ ok: false, message: "Packaging id is required" }, { status: 400 });
  try {
    const result = await deletePackagingMaterial({ id, actor: session.user.name || session.user.email || "Staff" });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
