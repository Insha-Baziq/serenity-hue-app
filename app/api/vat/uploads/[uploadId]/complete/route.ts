import { completeVatUploadFiling } from "@/lib/vat-filing";
import { readVatJsonBody, vatApiActor, vatErrorResponse, vatJson, vatUnauthorized } from "@/lib/vat-http";
import type { VatInvoiceFieldsInput } from "@/lib/vat-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ uploadId: string }> }) {
  const actor = await vatApiActor(request);
  if (!actor) return vatUnauthorized();
  try {
    const body = await readVatJsonBody(request);
    if (!body.details || typeof body.details !== "object") return vatJson({ ok: false, message: "Invoice details are required." }, 400);
    const { uploadId } = await params;
    if (!/^[0-9a-f-]{36}$/.test(uploadId)) return vatJson({ ok: false, message: "That upload is no longer available." }, 404);
    const result = await completeVatUploadFiling({ uploadId, details: body.details as VatInvoiceFieldsInput, actor });
    return vatJson({ ok: true, ...result });
  } catch (error) {
    return vatErrorResponse(error);
  }
}
