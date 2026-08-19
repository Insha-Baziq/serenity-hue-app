import { toNextJsHandler } from "better-auth/next-js";
import { auth, ensureAuthDatabase } from "@/lib/auth";

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
