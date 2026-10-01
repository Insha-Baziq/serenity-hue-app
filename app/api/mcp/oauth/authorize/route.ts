import { randomBytes } from "node:crypto";
import { authenticateBrowserUser, createAuthorizationCode, jsonResponse, loginReturnTo, mayGrantWriteScopes, mcpEnabled, mcpIssuerUrl, redirectNoStore, safeExternalRedirect, signConsentRequest, validateAuthorizationRequest, verifyConsentRequest } from "@/lib/mcp-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function escapeHtml(value: string) { return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!); }
function escapeScriptString(value: string) {
  return JSON.stringify(value).replace(/[<>&]/g, (character) => ({ "<": "\\u003c", ">": "\\u003e", "&": "\\u0026" })[character]!);
}

function html(body: string, status = 200, scriptNonce?: string) {
  const scriptSource = scriptNonce ? `; script-src 'nonce-${scriptNonce}'` : "";
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": `default-src 'none'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'; style-src 'unsafe-inline'; form-action 'self'${scriptSource}`, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store", Pragma: "no-cache" } });
}

function authorizationRedirectPage(target: string) {
  const nonce = randomBytes(18).toString("base64url");
  const escapedTarget = escapeHtml(target);
  return html(`<!doctype html><html><head><title>Authorization approved</title></head><body style="font:16px system-ui;max-width:600px;margin:4rem auto;padding:0 1rem"><h1>Authorization approved</h1><p>Returning you to your assistant…</p><p><a href="${escapedTarget}">Continue</a> if you are not redirected automatically.</p><script nonce="${nonce}">window.location.replace(${escapeScriptString(target)});</script></body></html>`, 200, nonce);
}

function deniedRedirect(request: { redirectUri: string; state: string | null }, issuer: string, reason: string) {
  return safeExternalRedirect(request.redirectUri, { error: "access_denied", error_description: reason, ...(request.state ? { state: request.state } : {}), iss: issuer });
}

async function consentPage(request: Request, method: "GET" | "POST") {
  if (!mcpEnabled()) return jsonResponse({ error: "not_found" }, 404);
  const url = new URL(request.url);
  let validated;
  try { validated = await validateAuthorizationRequest(url); }
  catch (error) { return jsonResponse({ error: "invalid_request", error_description: error instanceof Error ? error.message : "The authorization request is invalid." }, 400); }
  let user;
  try { user = await authenticateBrowserUser(request); }
  catch { return jsonResponse({ error: "server_error", error_description: "MCP authorization is not configured." }, 503); }
  if (!user) {
    const target = `/login?returnTo=${encodeURIComponent(loginReturnTo(request))}`;
    return redirectNoStore(new URL(target, url.origin));
  }
  if (!mayGrantWriteScopes(user.id, validated.request.clientId, validated.request.scope)) {
    return html("<!doctype html><title>Write access unavailable</title><p>This account and connector are not approved for Serenity Hue write access.</p>", 403);
  }
  if (method === "POST") {
    const form = await request.formData();
    const consent = String(form.get("consent") ?? "deny");
    const csrf = String(form.get("csrf") ?? "");
    if (!verifyConsentRequest(csrf, validated.request, user.id)) return html("<!doctype html><title>Authorization failed</title><p>This authorization request expired. Start again from your assistant app.</p>", 400);
    if (consent !== "approve") return authorizationRedirectPage(deniedRedirect(validated.request, mcpIssuerUrl(), "The user declined access."));
    try {
      const code = await createAuthorizationCode({ request: validated.request, userId: user.id });
      return authorizationRedirectPage(safeExternalRedirect(validated.request.redirectUri, { code, ...(validated.request.state ? { state: validated.request.state } : {}), iss: mcpIssuerUrl() }));
    } catch { return html("<!doctype html><title>Authorization failed</title><p>We could not create the authorization code. Try again.</p>", 500); }
  }
  const csrf = signConsentRequest(validated.request, user.id);
  const scopeDescriptions: Record<string, string> = {
    "assistant:read": "read operational data", "assistant:pii": "read approved contact fields",
    "assistant:write:inventory": "change physical products, variants, and stock counts",
    "assistant:write:packaging": "change packaging materials and counts",
    "assistant:write:mappings": "change channel listing and product links",
    "assistant:write:labs": "change ingredients, formulas, batches, and Labs packaging",
    "assistant:write:shipments": "link Parcel2Go shipments to orders",
    "assistant:write:team": "invite employees",
    "assistant:write:integrations": "run manual syncs and report refreshes",
    "assistant:write:connections": "start TikTok Shop and Ads connection flows",
    offline_access: "keep this connection active through refresh tokens",
  };
  const scopes = validated.request.scope.map((scope) => `<li><code>${escapeHtml(scope)}</code> — ${escapeHtml(scopeDescriptions[scope] ?? scope)}</li>`).join("");
  const writeNotice = validated.request.scope.some((scope) => scope.startsWith("assistant:write:"))
    ? "<p>With these permissions, your assistant can make the selected business changes directly after you connect it. Routine changes will not require another Serenity Hue login or approval.</p>"
    : "<p>This grant is read-only and cannot change business records.</p>";
  return html(`<!doctype html><html><head><title>Connect Serenity Hue</title></head><body style="font:16px system-ui;max-width:600px;margin:4rem auto;padding:0 1rem"><h1>Connect Serenity Hue Operations</h1><p><strong>${escapeHtml(validated.client.clientName)}</strong> is requesting access to Serenity Hue Operations.</p>${writeNotice}<h2>Requested access</h2><ul>${scopes}</ul><p>Signed in as <strong>${escapeHtml(user.email ?? user.name ?? "approved user")}</strong>.</p><form method="post" action="${escapeHtml(url.toString())}"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}" /><button name="consent" value="approve" type="submit">Approve access</button> <button name="consent" value="deny" type="submit">Decline</button></form></body></html>`);
}

export async function GET(request: Request) { return consentPage(request, "GET"); }
export async function POST(request: Request) { return consentPage(request, "POST"); }
