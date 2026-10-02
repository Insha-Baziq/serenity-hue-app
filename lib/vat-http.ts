import "server-only";

import { activityActorForSession, getCurrentSession, requireApiSession } from "@/lib/auth-guard";
import { hasVatAccess, readCookie, VAT_ACCESS_COOKIE } from "@/lib/vat-access";
import { VatDropboxError } from "@/lib/vat-dropbox";
import { VatSetupRequiredError } from "@/lib/vat-filing";
import { VatRecordError } from "@/lib/vat-repository";
import { VatInputError } from "@/lib/vat-rules";
import type { ActivityActor } from "@/lib/types";

const noStore = { "Cache-Control": "no-store" };

export function vatJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: noStore });
}

/** The signed-in staff member for a VAT API request, or null (any staff member may act). */
export async function vatApiActor(request: Request): Promise<ActivityActor | null> {
  if (!(await requireApiSession(request))) return null;
  const session = await getCurrentSession({ requestHeaders: request.headers, disableCookieCache: true });
  const actor = activityActorForSession(session);
  // The VAT password must also have been entered in this browser.
  if (!actor || !hasVatAccess(readCookie(request.headers.get("cookie"), VAT_ACCESS_COOKIE), actor.id)) return null;
  return actor;
}

export function vatUnauthorized() {
  return vatJson({ ok: false, code: "locked", message: "Sign in and unlock the VAT workspace first." }, 401);
}

export async function readVatJsonBody(request: Request): Promise<Record<string, unknown>> {
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new VatInputError("The request body must be a JSON object.");
  return body as Record<string, unknown>;
}

export function parseVatId(value: string) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new VatRecordError("not_found", "That invoice is no longer available.");
  return id;
}

/** Maps known VAT failures to clear responses; anything else stays generic. */
export function vatErrorResponse(error: unknown) {
  if (error instanceof VatSetupRequiredError) return vatJson({ ok: false, code: error.code, message: error.message }, 409);
  if (error instanceof VatInputError) return vatJson({ ok: false, code: "invalid_input", message: error.message }, 400);
  if (error instanceof VatRecordError) {
    return vatJson({ ok: false, code: error.code, message: error.message }, error.code === "not_found" ? 404 : 409);
  }
  if (error instanceof VatDropboxError) {
    const status = error.code === "auth" ? 409 : error.code === "unavailable" ? 502 : 409;
    return vatJson({ ok: false, code: `dropbox_${error.code}`, message: error.message }, status);
  }
  return vatJson({ ok: false, code: "unexpected", message: "Something went wrong. Reload the page to check the current state, then try again." }, 500);
}
