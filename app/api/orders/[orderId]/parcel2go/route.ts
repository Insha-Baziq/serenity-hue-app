import { linkParcel2GoShipment } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: RouteContext<"/api/orders/[orderId]/parcel2go">) {
  const { orderId } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ message: "Request body must be JSON" }, { status: 400 });
  }
  const shipmentId = body && typeof body === "object" && "shipmentId" in body && typeof body.shipmentId === "string" ? body.shipmentId : "";
  if (!shipmentId) return Response.json({ message: "Choose a Parcel2Go delivery first" }, { status: 400 });

  try {
    await linkParcel2GoShipment(orderId, shipmentId);
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to link Parcel2Go delivery";
    return Response.json({ message }, { status: 400 });
  }
}
