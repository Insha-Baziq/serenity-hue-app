import { getCurrentSession } from "@/lib/auth-guard";
import { setMasterQuantities } from "@/lib/repository";

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
  const raw = (body as { updates?: unknown })?.updates;
  if (!Array.isArray(raw) || raw.length === 0) {
    return Response.json({ ok: false, message: "updates array is required" }, { status: 400 });
  }
  const updates = raw
    .map((item) => {
      const { variantId, quantity } = (item ?? {}) as { variantId?: unknown; quantity?: unknown };
      const parsed = typeof quantity === "number" ? quantity : Number(quantity);
      return { variantId: typeof variantId === "string" ? variantId : "", quantity: parsed };
    })
    .filter((item) => item.variantId && Number.isFinite(item.quantity) && item.quantity >= 0);

  if (updates.length === 0) {
    return Response.json({ ok: false, message: "No valid updates supplied" }, { status: 400 });
  }

  const actor = session.user.name || session.user.email || "Staff";
  const result = await setMasterQuantities({ updates, actor });
  return Response.json({ ok: true, ...result });
}
