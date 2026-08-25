import { toNextJsHandler } from "better-auth/next-js";
import { auth, ensureAuthDatabase } from "@/lib/auth";
import { rateLimitedResponse, takeRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = toNextJsHandler(auth);

async function withDatabase<T extends (request: Request) => Promise<Response>>(handler: T, request: Request) {
  await ensureAuthDatabase();
  return handler(request);
}

export function GET(request: Request) {
  return withDatabase(handlers.GET, request);
}

export function POST(request: Request) {
  const path = new URL(request.url).pathname;
  if (path.endsWith("/sign-in/email") || path.endsWith("/sign-up/email")) {
    const limit = takeRateLimit(request, { name: "auth-credentials", limit: 8, windowMs: 15 * 60 * 1000 });
    if (!limit.allowed) return Promise.resolve(rateLimitedResponse(limit.retryAfterSeconds));
  }
  return withDatabase(handlers.POST, request);
}

export function PATCH(request: Request) {
  return withDatabase(handlers.PATCH, request);
}

export function PUT(request: Request) {
  return withDatabase(handlers.PUT, request);
}

export function DELETE(request: Request) {
  return withDatabase(handlers.DELETE, request);
}
