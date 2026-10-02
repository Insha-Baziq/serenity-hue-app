import "server-only";

import { vatMicrosoftCredentials, vatOutlookRedirectUri } from "@/lib/vat-config";

// Microsoft sign-in for business inboxes. Connecting stores the authorization
// only: it reads the account's address (User.Read) and never lists or fetches
// mail. Mail.Read is requested now so deferred inbox sync needs no re-consent.
export const VAT_OUTLOOK_SCOPES = ["openid", "email", "offline_access", "User.Read", "Mail.Read"];

function credentials() {
  const value = vatMicrosoftCredentials();
  if (!value) throw new Error("Outlook is not configured for the VAT workspace.");
  return value;
}

const authority = () => `https://login.microsoftonline.com/${encodeURIComponent(credentials().tenant)}/oauth2/v2.0`;

export function vatOutlookAuthorizationUrl(state: string) {
  const url = new URL(`${authority()}/authorize`);
  url.searchParams.set("client_id", credentials().clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", vatOutlookRedirectUri());
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", VAT_OUTLOOK_SCOPES.join(" "));
  url.searchParams.set("prompt", "select_account");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeVatOutlookCode(code: string) {
  const { clientId, clientSecret } = credentials();
  const response = await fetch(`${authority()}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: VAT_OUTLOOK_SCOPES.join(" "),
      grant_type: "authorization_code",
      code,
      redirect_uri: vatOutlookRedirectUri(),
    }),
    cache: "no-store",
  });
  const json = await response.json().catch(() => ({})) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string };
  if (!response.ok || !json.access_token) throw new Error("Microsoft sign-in failed. Try connecting the inbox again.");
  if (!json.refresh_token) throw new Error("Microsoft did not grant offline access. Try connecting the inbox again.");
  if (!json.scope?.toLowerCase().split(" ").some((scope) => scope.endsWith("mail.read"))) {
    throw new Error("Microsoft did not allow reading email. Connect the inbox again and accept the permissions.");
  }
  return { accessToken: json.access_token, refreshToken: json.refresh_token, expiresIn: json.expires_in ?? 3600 };
}

/** A fresh access token for a connected inbox; Microsoft may also rotate the refresh token. */
export async function refreshVatOutlookToken(refreshToken: string) {
  const { clientId, clientSecret } = credentials();
  const response = await fetch(`${authority()}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: VAT_OUTLOOK_SCOPES.join(" "),
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    cache: "no-store",
  });
  const json = await response.json().catch(() => ({})) as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!response.ok || !json.access_token) return null;
  return { accessToken: json.access_token, refreshToken: json.refresh_token ?? refreshToken, expiresIn: json.expires_in ?? 3600 };
}

/** The connected account's address, from the profile endpoint (not the mailbox). */
export async function getVatOutlookAccountEmail(accessToken: string) {
  const response = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!response.ok) return null;
  const me = await response.json() as { mail?: string | null; userPrincipalName?: string };
  return (me.mail ?? me.userPrincipalName ?? null)?.toLowerCase() ?? null;
}
