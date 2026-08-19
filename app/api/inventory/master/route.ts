import { getCurrentSession } from "@/lib/auth-guard";
import { setMasterQuantity } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session?.user) return Response.json({ ok: false, message: "Authentication required" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, message: "Invalid request body" }, { status: 400 });
  }
  const { variantId, quantity } = (body ?? {}) as { variantId?: unknown; quantity?: unknown };
  if (typeof variantId !== "string" || !variantId.trim()) {
    return Response.json({ ok: false, message: "variantId is required" }, { status: 400 });
  }
  const parsedQuantity = typeof quantity === "number" ? quantity : Number(quantity);
  if (!Number.isFinite(parsedQuantity) || parsedQuantity < 0) {
    return Response.json({ ok: false, message: "quantity must be a non-negative number" }, { status: 400 });
  }

  const actor = session.user.name || session.user.email || "Staff";
  const result = await setMasterQuantity({ variantId, quantity: parsedQuantity, actor });
  return Response.json({ ok: true, ...result });
}
