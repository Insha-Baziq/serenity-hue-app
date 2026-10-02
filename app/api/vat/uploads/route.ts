import { prepareVatUpload } from "@/lib/vat-filing";
import { parseVatId, readVatJsonBody, vatApiActor, vatErrorResponse, vatJson, vatUnauthorized } from "@/lib/vat-http";
import { rateLimitedResponse, takeRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Returns a single-use Dropbox upload link. The browser sends the file straight
 * to Dropbox, so documents never pass through this function's 4.5 MB limit.
 */
export async function POST(request: Request) {
  const actor = await vatApiActor(request);
  if (!actor) return vatUnauthorized();
  const limit = takeRateLimit(request, { name: "vat-upload", limit: 30, windowMs: 10 * 60 * 1000 });
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);
  try {
    const body = await readVatJsonBody(request);
    if (typeof body.fileName !== "string" || typeof body.contentType !== "string" || typeof body.size !== "number") {
      return vatJson({ ok: false, message: "File name, type and size are required." }, 400);
    }
    const invoiceId = body.invoiceId === null || body.invoiceId === undefined ? null : parseVatId(String(body.invoiceId));
    const upload = await prepareVatUpload({ fileName: body.fileName, contentType: body.contentType, size: body.size, invoiceId, actor });
    return vatJson({ ok: true, ...upload });
  } catch (error) {
    return vatErrorResponse(error);
  }
}
