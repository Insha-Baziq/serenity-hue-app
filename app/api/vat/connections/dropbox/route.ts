import { disconnectVatDropbox } from "@/lib/vat-repository";
import { vatApiActor, vatErrorResponse, vatJson, vatUnauthorized } from "@/lib/vat-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Forgets the shared Dropbox authorization. Filed documents stay in Dropbox. */
export async function DELETE(request: Request) {
  const actor = await vatApiActor(request);
  if (!actor) return vatUnauthorized();
  try {
    if (!(await disconnectVatDropbox(actor))) return vatJson({ ok: false, message: "Dropbox is not connected." }, 404);
    return vatJson({ ok: true });
  } catch (error) {
    return vatErrorResponse(error);
  }
}
