import { disconnectVatMailbox } from "@/lib/vat-repository";
import { vatApiActor, vatErrorResponse, vatJson, vatUnauthorized } from "@/lib/vat-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Forgets the inbox's authorization. Its emails and invoices are kept. */
export async function DELETE(request: Request, { params }: { params: Promise<{ mailboxId: string }> }) {
  const actor = await vatApiActor(request);
  if (!actor) return vatUnauthorized();
  try {
    const id = Number((await params).mailboxId);
    if (!Number.isSafeInteger(id) || id <= 0 || !(await disconnectVatMailbox(id, actor))) {
      return vatJson({ ok: false, message: "That inbox is not connected." }, 404);
    }
    return vatJson({ ok: true });
  } catch (error) {
    return vatErrorResponse(error);
  }
}
