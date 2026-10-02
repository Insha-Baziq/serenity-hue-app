import { removeVatApiKey, saveVatApiKey, VAT_KEY_SERVICES, type VatKeyService } from "@/lib/vat-api-keys";
import { readVatJsonBody, vatApiActor, vatErrorResponse, vatJson, vatUnauthorized } from "@/lib/vat-http";
import { rateLimitedResponse, takeRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isService = (value: unknown): value is VatKeyService => VAT_KEY_SERVICES.includes(value as VatKeyService);

/** Tests a replacement key with its provider, then saves it encrypted. Never returns keys. */
export async function PUT(request: Request) {
  const actor = await vatApiActor(request);
  if (!actor) return vatUnauthorized();
  const limit = takeRateLimit(request, { name: "vat-api-keys", limit: 10, windowMs: 10 * 60 * 1000 });
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);
  try {
    const body = await readVatJsonBody(request);
    if (!isService(body.service) || typeof body.key !== "string") return vatJson({ ok: false, message: "Choose a service and paste its key." }, 400);
    await saveVatApiKey(body.service, body.key, actor);
    return vatJson({ ok: true });
  } catch (error) {
    return vatErrorResponse(error);
  }
}

/** Removes the app-saved key so the server environment key applies again. */
export async function DELETE(request: Request) {
  const actor = await vatApiActor(request);
  if (!actor) return vatUnauthorized();
  try {
    const service = new URL(request.url).searchParams.get("service");
    if (!isService(service)) return vatJson({ ok: false, message: "Choose a service." }, 400);
    if (!(await removeVatApiKey(service, actor))) return vatJson({ ok: false, message: "No key is saved in the app for this service." }, 404);
    return vatJson({ ok: true });
  } catch (error) {
    return vatErrorResponse(error);
  }
}
