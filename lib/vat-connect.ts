import "server-only";

import { getCanonicalAppUrl } from "@/lib/auth";
import { hasVatAccess, readCookie, VAT_ACCESS_COOKIE } from "@/lib/vat-access";
import { activityActorForSession, getCurrentSession } from "@/lib/auth-guard";
import { rateLimitedResponse, takeRateLimit } from "@/lib/rate-limit";
import { isVatDropboxConfigured, isVatOutlookConfigured } from "@/lib/vat-config";
import { exchangeVatDropboxCode, getVatDropboxAccount, vatDropboxAuthorizationUrl, VatDropboxError } from "@/lib/vat-dropbox";
import { exchangeVatOutlookCode, getVatOutlookAccountEmail, vatOutlookAuthorizationUrl } from "@/lib/vat-outlook";
import { consumeVatOAuthState, createVatOAuthState, saveVatDropboxConnection, saveVatMailbox } from "@/lib/vat-repository";

// Business-wide connection flows. Any signed-in staff member may connect the
// shared Dropbox or an inbox; the resulting connection is visible to all staff.
// Connecting an inbox stores its authorization only and never reads mail.

type Provider = "dropbox" | "outlook";
const stateProvider = { dropbox: "dropbox", outlook: "microsoft" } as const;

function cookieName(provider: Provider) {
  return `vat_oauth_${provider}`;
}

function stateCookie(provider: Provider, value: string, maxAge: number) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${cookieName(provider)}=${value}; Max-Age=${maxAge}; Path=/api/vat/connections/${provider}/callback; HttpOnly; SameSite=Lax${secure}`;
}

function redirectToVat(provider: Provider, outcome: { connected: true } | { error: string }) {
  const url = new URL("/vat", getCanonicalAppUrl());
  if ("connected" in outcome) url.searchParams.set("connected", provider);
  else url.searchParams.set("connection_error", outcome.error.slice(0, 200));
  return new Response(null, {
    status: 302,
    headers: { Location: url.toString(), "Set-Cookie": stateCookie(provider, "", 0), "Cache-Control": "no-store" },
  });
}

function cookieValue(header: string | null, name: string) {
  const match = header?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : "";
}

export async function startVatConnection(request: Request, provider: Provider) {
  const session = await getCurrentSession({ requestHeaders: request.headers, disableCookieCache: true });
  if (!session?.user) return Response.redirect(new URL("/login", getCanonicalAppUrl()), 302);
  if (!hasVatAccess(readCookie(request.headers.get("cookie"), VAT_ACCESS_COOKIE), session.user.id)) return Response.redirect(new URL("/vat", getCanonicalAppUrl()), 302);
  const limit = takeRateLimit(request, { name: `vat-connect-${provider}`, limit: 10, windowMs: 10 * 60 * 1000 });
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);
  const configured = provider === "dropbox" ? isVatDropboxConfigured() : isVatOutlookConfigured();
  if (!configured) {
    return redirectToVat(provider, { error: `${provider === "dropbox" ? "Dropbox" : "Outlook"} isn't set up yet. Add its VAT settings first.` });
  }
  const { state, maxAgeSeconds } = await createVatOAuthState(stateProvider[provider], session.user.id);
  const location = provider === "dropbox" ? vatDropboxAuthorizationUrl(state) : vatOutlookAuthorizationUrl(state);
  return new Response(null, {
    status: 302,
    headers: { Location: location, "Set-Cookie": stateCookie(provider, state, maxAgeSeconds), "Cache-Control": "no-store" },
  });
}

export async function finishVatConnection(request: Request, provider: Provider) {
  const session = await getCurrentSession({ requestHeaders: request.headers, disableCookieCache: true });
  const actor = activityActorForSession(session);
  if (!session?.user || !actor) return Response.redirect(new URL("/login", getCanonicalAppUrl()), 302);
  if (!hasVatAccess(readCookie(request.headers.get("cookie"), VAT_ACCESS_COOKIE), session.user.id)) return Response.redirect(new URL("/vat", getCanonicalAppUrl()), 302);

  const url = new URL(request.url);
  const code = url.searchParams.get("code")?.trim() ?? "";
  const state = url.searchParams.get("state")?.trim() ?? "";
  const expected = cookieValue(request.headers.get("cookie"), cookieName(provider));
  if (url.searchParams.get("error")) return redirectToVat(provider, { error: "The connection was cancelled or refused." });
  if (!code || !state || !expected || state !== expected || !(await consumeVatOAuthState(stateProvider[provider], state, session.user.id))) {
    return redirectToVat(provider, { error: "The connection request expired. Start it again." });
  }

  try {
    if (provider === "dropbox") {
      const tokens = await exchangeVatDropboxCode(code);
      const account = await getVatDropboxAccount(tokens.accessToken);
      await saveVatDropboxConnection({ ...tokens, accountId: account.accountId, email: account.email, actor });
    } else {
      const tokens = await exchangeVatOutlookCode(code);
      const email = await getVatOutlookAccountEmail(tokens.accessToken);
      if (!email) return redirectToVat(provider, { error: "Couldn't tell which Outlook account was connected. Try again." });
      await saveVatMailbox({ ...tokens, email, actor });
    }
    return redirectToVat(provider, { connected: true });
  } catch (error) {
    const message = error instanceof VatDropboxError || (error instanceof Error && /^Microsoft /.test(error.message))
      ? error.message
      : "The connection could not be completed. Try again.";
    return redirectToVat(provider, { error: message });
  }
}
