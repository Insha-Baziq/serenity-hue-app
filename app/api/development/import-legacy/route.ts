import { importLegacyInventoryMetadata } from "@/lib/legacy-inventory-import";
import { reconcileInventoryAlerts } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  if (process.env.NODE_ENV === "production") return Response.json({ ok: false, message: "Legacy import is disabled in production." }, { status: 403 });
  try {
    const result = await importLegacyInventoryMetadata();
    const alerts = await reconcileInventoryAlerts();
    return Response.json({ ok: true, ...result, alerts });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Legacy import failed";
    return Response.json({ ok: false, message }, { status: 500 });
  }
}
