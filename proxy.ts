import { NextResponse } from "next/server";

export function proxy() {
  // Authentication is enforced by the operations layout and API route guards.
  // Keep the proxy pass-through so browsers never receive a Basic Auth challenge.
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|login(?:/|$)|api/auth(?:/|$)|api/jobs/reconcile|api/webhooks/parcel2go|api/tiktok/callback|api/tiktok/webhook).*)"],
};
