import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

function unauthorized() {
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Serenity Hue Operations"' },
  });
}

export function proxy(request: NextRequest) {
  const username = process.env.INTERNAL_APP_USERNAME;
  const password = process.env.INTERNAL_APP_PASSWORD;

  // Local setup stays frictionless; deployment must define both values.
  if (!username || !password) return NextResponse.next();

  const header = request.headers.get("authorization");
  if (!header?.startsWith("Basic ")) return unauthorized();
  try {
    const [providedUsername, providedPassword] = atob(header.slice(6)).split(":");
    return providedUsername === username && providedPassword === password ? NextResponse.next() : unauthorized();
  } catch {
    return unauthorized();
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/jobs/reconcile|api/webhooks/parcel2go|api/tiktok/callback|api/tiktok/webhook).*)"],
};
