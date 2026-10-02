import { getVatInvoiceDetail } from "@/lib/vat-repository";
import { saveVatInvoiceDetails } from "@/lib/vat-filing";
import { parseVatId, readVatJsonBody, vatApiActor, vatErrorResponse, vatJson, vatUnauthorized } from "@/lib/vat-http";
import type { VatInvoiceFieldsInput } from "@/lib/vat-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ invoiceId: string }> }) {
  if (!(await vatApiActor(request))) return vatUnauthorized();
  try {
    const invoice = await getVatInvoiceDetail(parseVatId((await params).invoiceId));
    if (!invoice) return vatJson({ ok: false, message: "That invoice is no longer available." }, 404);
    return vatJson({ ok: true, invoice });
  } catch (error) {
    return vatErrorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ invoiceId: string }> }) {
  const actor = await vatApiActor(request);
  if (!actor) return vatUnauthorized();
  try {
    const body = await readVatJsonBody(request);
    if (typeof body.expectedUpdatedAt !== "string" || !body.details || typeof body.details !== "object") {
      return vatJson({ ok: false, message: "Invoice details and the current update time are required." }, 400);
    }
    const result = await saveVatInvoiceDetails({
      id: parseVatId((await params).invoiceId),
      details: body.details as VatInvoiceFieldsInput,
      expectedUpdatedAt: body.expectedUpdatedAt,
      actor,
    });
    return vatJson({ ok: true, ...result });
  } catch (error) {
    return vatErrorResponse(error);
  }
}
