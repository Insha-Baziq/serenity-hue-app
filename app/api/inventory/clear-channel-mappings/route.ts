/** This one-time destructive migration endpoint is permanently retired. */
export async function POST() {
  return Response.json({ ok: false, message: "This migration endpoint has been retired." }, { status: 410 });
}
