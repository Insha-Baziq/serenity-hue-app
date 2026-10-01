import { acceptEmployeeInvitation } from "@/lib/repository";
import { rateLimitedResponse, takeRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const limit = takeRateLimit(request, { name: "employee-invite-accept", limit: 20, windowMs: 60 * 60 * 1000 });
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);
  const json = request.headers.get("content-type")?.includes("application/json") ?? false;
  let input: Record<string, unknown>;
  try {
    input = json ? await request.json() as Record<string, unknown> : Object.fromEntries(await request.formData());
  } catch { return Response.json({ message: "Invalid invitation submission" }, { status: 400 }); }
  const token = String(input.token ?? "");
  const password = String(input.password ?? "");
  const confirmation = String(input.confirmation ?? "");
  const redirectToInvite = (error: string) => Response.redirect(new URL(`/invite/${encodeURIComponent(token)}?error=${error}`, request.url), 303);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return Response.json({ message: "Invalid invitation" }, { status: 400 });
  if (password !== confirmation || password.length < 8 || password.length > 128) {
    return json ? Response.json({ message: "Passwords must match and contain 8 to 128 characters" }, { status: 400 }) : redirectToInvite("password");
  }
  try {
    await acceptEmployeeInvitation({ token, password });
  } catch {
    return json ? Response.json({ message: "Invitation expired or already used" }, { status: 410 }) : redirectToInvite("expired");
  }
  return json ? Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } }) : Response.redirect(new URL("/login?invitation=complete", request.url), 303);
}
