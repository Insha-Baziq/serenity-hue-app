/**
 * Retired with the legacy master_inventory model. Physical variant adjustments
 * are available only through /api/inventory/physical.
 */
export async function POST() {
  return Response.json({ ok: false, message: "This legacy inventory endpoint has been retired." }, { status: 410 });
}
