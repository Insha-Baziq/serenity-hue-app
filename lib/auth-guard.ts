import { headers } from "next/headers";
import { auth, ensureAuthDatabase, isBetterAuthConfigured } from "@/lib/auth";

export async function getCurrentSession() {
  if (!isBetterAuthConfigured()) return null;
  await ensureAuthDatabase();
  return auth.api.getSession({ headers: await headers() });
}

export async function requireApiSession(request: Request) {
  if (!isBetterAuthConfigured()) return true;
  await ensureAuthDatabase();
  const session = await auth.api.getSession({ headers: request.headers });
  return Boolean(session?.user);
}
