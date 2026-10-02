import { removeVatInvoiceRecord } from "@/lib/vat-filing";
import { parseVatId, readVatJsonBody, vatApiActor, vatErrorResponse, vatJson, vatUnauthorized } from "@/lib/vat-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Retains the record (and moves its document to the removed folder); never deletes. */
export async function POST(request: Request, { params }: { params: Promise<{ invoiceId: string }> }) {
  const actor = await vatApiActor(request);
  if (!actor) return vatUnauthorized();
  try {
    const body = await readVatJsonBody(request);
    if (typeof body.expectedUpdatedAt !== "string" || typeof body.reason !== "string") {
      return vatJson({ ok: false, message: "A reason and the current update time are required." }, 400);
    }
    const result = await removeVatInvoiceRecord({ id: parseVatId((await params).invoiceId), reason: body.reason, expectedUpdatedAt: body.expectedUpdatedAt, actor });
    return vatJson({ ok: true, ...result });
  } catch (error) {
    return vatErrorResponse(error);
  }
}
