import { restoreVatInvoiceRecord } from "@/lib/vat-filing";
import { parseVatId, readVatJsonBody, vatApiActor, vatErrorResponse, vatJson, vatUnauthorized } from "@/lib/vat-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ invoiceId: string }> }) {
  const actor = await vatApiActor(request);
  if (!actor) return vatUnauthorized();
  try {
    const body = await readVatJsonBody(request);
    if (typeof body.expectedUpdatedAt !== "string") return vatJson({ ok: false, message: "The current update time is required." }, 400);
    const result = await restoreVatInvoiceRecord({ id: parseVatId((await params).invoiceId), expectedUpdatedAt: body.expectedUpdatedAt, actor });
    return vatJson({ ok: true, ...result });
  } catch (error) {
    return vatErrorResponse(error);
  }
}
