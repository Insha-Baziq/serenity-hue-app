import { activityActorForSession, getCurrentSession, requireApiSession } from "@/lib/auth-guard";
import { checkVatPassword, createVatAccessToken, VAT_ACCESS_COOKIE } from "@/lib/vat-access";
import { rateLimitedResponse, takeRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Checks the VAT password for the signed-in staff member and sets the 8-hour access cookie. */
export async function POST(request: Request) {
  if (!(await requireApiSession(request))) return Response.json({ ok: false, message: "Sign in first." }, { status: 401 });
  const actor = activityActorForSession(await getCurrentSession({ requestHeaders: request.headers, disableCookieCache: true }));
  if (!actor) return Response.json({ ok: false, message: "Sign in first." }, { status: 401 });
  const limit = takeRateLimit(request, { name: "vat-unlock", limit: 8, windowMs: 10 * 60 * 1000 });
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);
  const body = await request.json().catch(() => null) as { password?: unknown } | null;
  if (typeof body?.password !== "string" || !checkVatPassword(body.password)) {
    return Response.json({ ok: false, message: "That password isn't right." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const token = createVatAccessToken(actor.id);
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return Response.json({ ok: true }, {
    headers: {
      "Cache-Control": "no-store",
      "Set-Cookie": `${VAT_ACCESS_COOKIE}=${encodeURIComponent(token.value)}; Max-Age=${token.maxAgeSeconds}; Path=/; HttpOnly; SameSite=Lax${secure}`,
    },
  });
}
