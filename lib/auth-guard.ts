import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { assertBetterAuthConfiguration, auth, ensureAuthDatabase, getTrustedOrigins } from "@/lib/auth";
import { getTursoClient } from "@/lib/turso";

async function touchPresence(userId: string) {
  const db = await getTursoClient();
  const now = new Date();
  const staleBefore = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
  await db.execute({
    sql: "UPDATE \"session\" SET updatedAt = ? WHERE userId = ? AND updatedAt < ?",
    args: [now.toISOString(), userId, staleBefore],
  });
}

function isTrustedMutationRequest(request: Request) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return true;
  const origin = request.headers.get("origin");
  if (origin) return getTrustedOrigins().includes(origin);
  const fetchSite = request.headers.get("sec-fetch-site");
  return fetchSite === "same-origin" || fetchSite === "same-site";
}

const getPageSession = cache(async () => {
  assertBetterAuthConfiguration();
  await ensureAuthDatabase();
  return auth.api.getSession({ headers: await headers() });
});

export async function getCurrentSession(options: { requestHeaders?: Headers; disableCookieCache?: boolean } = {}) {
  const session = !options.requestHeaders && !options.disableCookieCache
    ? await getPageSession()
    : await (async () => {
        assertBetterAuthConfiguration();
        await ensureAuthDatabase();
        return auth.api.getSession({
          headers: options.requestHeaders ?? await headers(),
          query: options.disableCookieCache ? { disableCookieCache: true } : undefined,
        });
      })();
  if (session?.user?.id) await touchPresence(session.user.id);
  return session;
}

export async function requirePageSession() {
  const session = await getCurrentSession();
  if (!session?.user) redirect("/login");
  return session;
}

export async function requireApiSession(request: Request) {
  if (!isTrustedMutationRequest(request)) return false;
  const session = await getCurrentSession({ requestHeaders: request.headers, disableCookieCache: true });
  return Boolean(session?.user);
}
