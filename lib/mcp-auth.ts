import "server-only";

import { lookup } from "node:dns/promises";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { getCurrentSession } from "@/lib/auth-guard";
import { getCanonicalAppUrl } from "@/lib/auth";
import { getTursoClient } from "@/lib/turso";
import type { AssistantPrincipal, AssistantScope } from "@/lib/mcp-contracts";
import { MCP_OAUTH_SCOPES, parseMcpOAuthScopes, type McpOAuthScope } from "@/lib/mcp-oauth-scopes";

const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;
const MAX_METADATA_BYTES = 64 * 1024;
const MAX_CLIENT_NAME = 120;

type ClientRecord = {
  clientId: string;
  clientName: string;
  clientUri: string | null;
  redirectUris: string[];
};

type OAuthScope = McpOAuthScope;

type AuthorizationRequest = {
  clientId: string;
  redirectUri: string;
  scope: OAuthScope[];
  resource: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  state: string | null;
};

function productionRuntime() {
  return process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build";
}

function secureSecret() {
  const configured = process.env.MCP_OAUTH_SECRET?.trim();
  if (configured && configured.length >= 32) return configured;
  if (productionRuntime()) throw new Error("MCP_OAUTH_SECRET must be a random value of at least 32 characters in production.");
  return createHash("sha256").update(`serenity-hue-mcp:${process.cwd()}:development`).digest("hex");
}

function absoluteUrl(value: string, name: string) {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error(`${name} must be an absolute URL.`); }
  if (!parsed.protocol || !parsed.hostname) throw new Error(`${name} must be an absolute URL.`);
  if (productionRuntime() && parsed.protocol !== "https:") throw new Error(`${name} must use HTTPS in production.`);
  return parsed.toString().replace(/\/$/, "");
}

export function mcpEnabled() { return process.env.MCP_ENABLED === "true"; }
export function mcpPiiEnabled() { return process.env.MCP_PII_ENABLED === "true"; }
export function mcpWriteEnabled() { return process.env.MCP_WRITE_ENABLED === "true"; }
export function mcpWriteAllowedUserIds() { return (process.env.MCP_WRITE_ALLOWED_USER_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean); }
export function mcpWriteAllowedClientIds() { return (process.env.MCP_WRITE_ALLOWED_CLIENT_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean); }
export function mcpAllowedUserId() { return process.env.MCP_ALLOWED_USER_ID?.trim() || null; }
export function mcpAllowAllAuthenticatedUsers() { return process.env.MCP_ALLOW_ALL_AUTHENTICATED_USERS === "true"; }
export function mcpDcrEnabled() { return process.env.MCP_DCR_ENABLED !== "false"; }

function assertUserAccessPolicy() {
  const allowedUserId = mcpAllowedUserId();
  const allowAllAuthenticatedUsers = mcpAllowAllAuthenticatedUsers();
  if (allowedUserId && allowAllAuthenticatedUsers) {
    throw new Error("Configure either MCP_ALLOWED_USER_ID or MCP_ALLOW_ALL_AUTHENTICATED_USERS, not both.");
  }
  if (!allowedUserId && !allowAllAuthenticatedUsers) {
    throw new Error("MCP user access policy is not configured.");
  }
  return { allowedUserId, allowAllAuthenticatedUsers };
}

export function mcpIssuerUrl() {
  const configured = process.env.MCP_ISSUER_URL?.trim();
  if (configured) return absoluteUrl(configured, "MCP_ISSUER_URL");
  if (productionRuntime()) throw new Error("MCP_ISSUER_URL is required in production.");
  return getCanonicalAppUrl();
}

export function mcpResourceUrl() {
  const configured = process.env.MCP_RESOURCE_URL?.trim();
  if (configured) return absoluteUrl(configured, "MCP_RESOURCE_URL");
  if (productionRuntime()) throw new Error("MCP_RESOURCE_URL is required in production.");
  return `${getCanonicalAppUrl()}/api/mcp`;
}

export function mcpConfig() {
  const userAccess = assertUserAccessPolicy();
  return {
    issuer: mcpIssuerUrl(),
    resource: mcpResourceUrl(),
    ...userAccess,
    piiEnabled: mcpPiiEnabled(),
    secret: secureSecret(),
  };
}

export function noStoreHeaders(extra: HeadersInit = {}) {
  const headers = new Headers(extra);
  headers.set("Cache-Control", "no-store");
  headers.set("Pragma", "no-cache");
  return headers;
}

export function jsonResponse(body: unknown, status = 200, extra: HeadersInit = {}) {
  return new Response(JSON.stringify(body), { status, headers: noStoreHeaders({ "Content-Type": "application/json", ...extra }) });
}

export function redirectNoStore(url: string | URL, status = 302) {
  return new Response(null, { status, headers: noStoreHeaders({ Location: String(url) }) });
}

export function oauthError(error: string, description: string, status = 400, extra: Record<string, string> = {}) {
  return jsonResponse({ error, error_description: description, ...extra }, status);
}

export function hashOpaque(value: string) {
  return createHmac("sha256", secureSecret()).update(value).digest("hex");
}

export function randomOpaque(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

function constantTimeEquals(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function nowIso() { return new Date().toISOString(); }
function futureIso(seconds: number) { return new Date(Date.now() + seconds * 1000).toISOString(); }

function parseScope(value: string | null | undefined, allowPii = mcpPiiEnabled()): OAuthScope[] {
  return parseMcpOAuthScopes(value, { allowPii, allowWrite: mcpWriteEnabled() });
}

export function mayGrantWriteScopes(userId: string, clientId: string, scopes: readonly OAuthScope[]) {
  if (!scopes.some((scope) => scope.startsWith("assistant:write:"))) return true;
  return mcpWriteEnabled() && mcpWriteAllowedUserIds().includes(userId) && mcpWriteAllowedClientIds().includes(clientId);
}

export function hasScope(scopes: AssistantScope[], scope: AssistantScope) { return scopes.includes(scope); }

function assistantScopes(scopes: OAuthScope[]): AssistantScope[] {
  return scopes.filter((scope): scope is AssistantScope => scope !== "offline_access");
}

function parseRedirect(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("redirect_uri must be an absolute URL."); }
  if (url.username || url.password || url.hash) throw new Error("redirect_uri may not contain credentials or a fragment.");
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname.toLowerCase());
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) throw new Error("redirect_uri must use HTTPS, except for validated loopback redirects.");
  if (loopback && (url.port && (!Number.isInteger(Number(url.port)) || Number(url.port) < 1 || Number(url.port) > 65535))) throw new Error("redirect_uri has an invalid loopback port.");
  return url.toString();
}

function configuredRedirects() {
  return new Set((process.env.MCP_ALLOWED_REDIRECT_URIS?.split(",") ?? []).map((value) => value.trim()).filter(Boolean).map(parseRedirect));
}

export function validateRedirectUri(value: string, registered: string[]) {
  const redirect = parseRedirect(value);
  if (!registered.some((candidate) => candidate === redirect)) throw new Error("redirect_uri does not match the registered redirect URI exactly.");
  const allowed = configuredRedirects();
  const parsed = new URL(redirect);
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname.toLowerCase());
  if (allowed.size && !allowed.has(redirect) && !loopback) throw new Error("redirect_uri is not in the server allowlist.");
  return redirect;
}

function validClientName(value: unknown) {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || name.length > MAX_CLIENT_NAME) throw new Error("client_name is required and must be at most 120 characters.");
  return name;
}

function validClientUri(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new Error("client_uri must be a URL.");
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("client_uri must use HTTPS.");
  return url.toString();
}

function validRedirects(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) throw new Error("redirect_uris must contain between 1 and 10 exact URLs.");
  const redirects = [...new Set(value.map((item) => parseRedirect(String(item))))];
  const allowed = configuredRedirects();
  for (const redirect of redirects) {
    const parsed = new URL(redirect);
    const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname.toLowerCase());
    if (allowed.size && !allowed.has(redirect) && !loopback) throw new Error("redirect_uri is not in the server allowlist.");
  }
  return redirects;
}

function parseClientRow(row: Record<string, unknown>): ClientRecord {
  let redirects: unknown;
  try { redirects = JSON.parse(String(row.redirect_uris_json)); } catch { throw new Error("Stored client registration is invalid."); }
  if (!Array.isArray(redirects) || redirects.some((item) => typeof item !== "string")) throw new Error("Stored client registration is invalid.");
  return { clientId: String(row.client_id), clientName: String(row.client_name), clientUri: row.client_uri ? String(row.client_uri) : null, redirectUris: redirects };
}

async function lookupPrivateNetwork(hostname: string) {
  const lower = hostname.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".localhost") || lower.endsWith(".local") || lower.endsWith(".internal")) return true;
  const ip = isIP(lower) ? lower : (await lookup(lower)).address;
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a === 169 && b === 254;
  }
  return ip === "::1" || ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80:");
}

async function clientFromMetadataDocument(clientId: string): Promise<ClientRecord | null> {
  if (!clientId.startsWith("https://")) return null;
  const url = new URL(clientId);
  if (url.username || url.password || url.hash || await lookupPrivateNetwork(url.hostname)) throw new Error("Client metadata URL is not safe to fetch.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(url, { redirect: "manual", signal: controller.signal, headers: { Accept: "application/json" } });
    if (!response.ok || response.headers.get("location")) throw new Error("Client metadata document could not be fetched.");
    const length = Number(response.headers.get("content-length") ?? "0");
    if (length > MAX_METADATA_BYTES) throw new Error("Client metadata document is too large.");
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_METADATA_BYTES) throw new Error("Client metadata document is too large.");
    const data = JSON.parse(text) as Record<string, unknown>;
    if (data.client_id !== clientId) throw new Error("Client metadata client_id does not match.");
    const record = { clientId, clientName: validClientName(data.client_name), clientUri: validClientUri(data.client_uri), redirectUris: validRedirects(data.redirect_uris) };
    return record;
  } finally { clearTimeout(timeout); }
}

export async function registerClient(input: { clientName: unknown; clientUri?: unknown; redirectUris: unknown }) {
  const record: ClientRecord = { clientId: `mcp_${randomOpaque(18)}`, clientName: validClientName(input.clientName), clientUri: validClientUri(input.clientUri), redirectUris: validRedirects(input.redirectUris) };
  const db = await getTursoClient();
  const now = nowIso();
  await db.execute({ sql: `INSERT INTO mcp_oauth_clients (client_id, client_name, client_uri, redirect_uris_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`, args: [record.clientId, record.clientName, record.clientUri, JSON.stringify(record.redirectUris), now, now] });
  return record;
}

export async function resolveClient(clientId: string) {
  const metadata = await clientFromMetadataDocument(clientId);
  if (metadata) return metadata;
  const db = await getTursoClient();
  const result = await db.execute({ sql: "SELECT client_id, client_name, client_uri, redirect_uris_json FROM mcp_oauth_clients WHERE client_id = ?", args: [clientId] });
  return result.rows[0] ? parseClientRow(result.rows[0] as Record<string, unknown>) : null;
}

function canonicalRequest(request: AuthorizationRequest, userId: string) {
  return [userId, request.clientId, request.redirectUri, request.scope.join(" "), request.resource, request.codeChallenge, request.state ?? ""].join("|");
}

export function signConsentRequest(request: AuthorizationRequest, userId: string) {
  const payload = Buffer.from(JSON.stringify({ ...request, userId, exp: Date.now() + 5 * 60 * 1000 })).toString("base64url");
  const signature = createHmac("sha256", secureSecret()).update(`${payload}|${canonicalRequest(request, userId)}`).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyConsentRequest(value: string, expected: AuthorizationRequest, userId: string) {
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return false;
  let data: Record<string, unknown>;
  try { data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch { return false; }
  if (data.userId !== userId || Number(data.exp) < Date.now()) return false;
  const expectedSignature = createHmac("sha256", secureSecret()).update(`${payload}|${canonicalRequest(expected, userId)}`).digest("base64url");
  return constantTimeEquals(signature, expectedSignature);
}

export async function validateAuthorizationRequest(url: URL): Promise<{ request: AuthorizationRequest; client: ClientRecord }> {
  const responseType = url.searchParams.get("response_type");
  if (responseType !== "code") throw new Error("Only response_type=code is supported.");
  const clientId = url.searchParams.get("client_id") ?? "";
  const client = await resolveClient(clientId);
  if (!client) throw new Error("Unknown OAuth client.");
  const redirectUri = validateRedirectUri(url.searchParams.get("redirect_uri") ?? "", client.redirectUris);
  const codeChallenge = url.searchParams.get("code_challenge") ?? "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) throw new Error("A valid S256 code_challenge is required.");
  if (url.searchParams.get("code_challenge_method") !== "S256") throw new Error("S256 PKCE is required.");
  const resource = url.searchParams.get("resource") ?? mcpResourceUrl();
  if (resource !== mcpResourceUrl()) throw new Error("The OAuth resource does not match this MCP server.");
  const request: AuthorizationRequest = { clientId, redirectUri, scope: parseScope(url.searchParams.get("scope")), resource, codeChallenge, codeChallengeMethod: "S256", state: url.searchParams.get("state") };
  return { request, client };
}

export async function currentAuthorizedUser(request: Request) {
  const { allowedUserId } = assertUserAccessPolicy();
  const session = await getCurrentSession({ requestHeaders: request.headers, disableCookieCache: true });
  if (!session?.user?.id) return null;
  if (allowedUserId && session.user.id !== allowedUserId) return null;
  return session.user;
}

export async function createAuthorizationCode(input: { request: AuthorizationRequest; userId: string }) {
  const db = await getTursoClient();
  const code = randomOpaque(32);
  const now = nowIso();
  await db.execute({ sql: `INSERT INTO mcp_oauth_authorization_codes (code_hash, client_id, user_id, redirect_uri, code_challenge, code_challenge_method, resource, scope, expires_at, used_at, created_at) VALUES (?, ?, ?, ?, ?, 'S256', ?, ?, ?, NULL, ?)`, args: [hashOpaque(code), input.request.clientId, input.userId, input.request.redirectUri, input.request.codeChallenge, input.request.resource, input.request.scope.join(" "), futureIso(60), now] });
  return code;
}

async function consumeAuthorizationCode(code: string, clientId: string, redirectUri: string) {
  const db = await getTursoClient();
  const result = await db.execute({ sql: `UPDATE mcp_oauth_authorization_codes SET used_at = ? WHERE code_hash = ? AND client_id = ? AND redirect_uri = ? AND used_at IS NULL AND expires_at > ? RETURNING user_id, code_challenge, code_challenge_method, resource, scope`, args: [nowIso(), hashOpaque(code), clientId, redirectUri, nowIso()] });
  return result.rows[0] as Record<string, unknown> | undefined;
}

async function getAuthorizationCode(code: string, clientId: string, redirectUri: string) {
  const db = await getTursoClient();
  const result = await db.execute({ sql: `SELECT code_challenge, expires_at, used_at FROM mcp_oauth_authorization_codes WHERE code_hash = ? AND client_id = ? AND redirect_uri = ?`, args: [hashOpaque(code), clientId, redirectUri] });
  return result.rows[0] as Record<string, unknown> | undefined;
}

function verifyPkce(verifier: string, challenge: string) {
  const computed = createHash("sha256").update(verifier).digest("base64url");
  return /^[A-Za-z0-9._~-]{43,128}$/.test(verifier) && constantTimeEquals(computed, challenge);
}

async function issueTokenPair(input: { clientId: string; userId: string; scope: string; resource: string; familyId?: string }) {
  const db = await getTursoClient();
  const accessToken = randomOpaque(32);
  const refreshToken = randomOpaque(48);
  const familyId = input.familyId ?? randomOpaque(18);
  const now = nowIso();
  const transaction = await db.transaction("write");
  try {
    await transaction.execute({ sql: `INSERT INTO mcp_oauth_tokens (token_hash, token_kind, client_id, user_id, scope, resource, audience, token_family_id, expires_at, created_at, used_at, revoked_at) VALUES (?, 'access', ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`, args: [hashOpaque(accessToken), input.clientId, input.userId, input.scope, input.resource, input.resource, familyId, futureIso(ACCESS_TTL_SECONDS), now] });
    await transaction.execute({ sql: `INSERT INTO mcp_oauth_tokens (token_hash, token_kind, client_id, user_id, scope, resource, audience, token_family_id, expires_at, created_at, used_at, revoked_at) VALUES (?, 'refresh', ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`, args: [hashOpaque(refreshToken), input.clientId, input.userId, input.scope, input.resource, input.resource, familyId, futureIso(REFRESH_TTL_SECONDS), now] });
    await transaction.commit();
  } catch (error) { await transaction.rollback(); throw error; } finally { transaction.close(); }
  return { access_token: accessToken, token_type: "Bearer", expires_in: ACCESS_TTL_SECONDS, refresh_token: refreshToken, scope: input.scope };
}

export async function exchangeAuthorizationCode(input: { code: string; clientId: string; redirectUri: string; verifier: string }) {
  // Validate PKCE before consuming the code. A guessed verifier must not let a
  // third party burn a legitimate one-time authorization code.
  const candidate = await getAuthorizationCode(input.code, input.clientId, input.redirectUri);
  if (!candidate || candidate.used_at || String(candidate.expires_at) <= nowIso() || !verifyPkce(input.verifier, String(candidate.code_challenge))) throw new Error("invalid_grant");
  const row = await consumeAuthorizationCode(input.code, input.clientId, input.redirectUri);
  if (!row) throw new Error("invalid_grant");
  const scopes = parseScope(String(row.scope));
  return issueTokenPair({ clientId: input.clientId, userId: String(row.user_id), scope: scopes.join(" "), resource: String(row.resource) });
}

export async function rotateRefreshToken(input: { refreshToken: string; clientId: string; resource: string }) {
  const db = await getTursoClient();
  const rowResult = await db.execute({ sql: `SELECT token_hash, token_kind, client_id, user_id, scope, resource, audience, token_family_id, expires_at, used_at, revoked_at FROM mcp_oauth_tokens WHERE token_hash = ? AND token_kind = 'refresh'`, args: [hashOpaque(input.refreshToken)] });
  const row = rowResult.rows[0] as Record<string, unknown> | undefined;
  if (!row || String(row.client_id) !== input.clientId || String(row.resource) !== input.resource || String(row.audience) !== input.resource || String(row.expires_at) <= nowIso() || row.revoked_at || row.used_at) {
    if (row?.used_at) await db.execute({ sql: "UPDATE mcp_oauth_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE token_family_id = ?", args: [nowIso(), String(row.token_family_id)] });
    throw new Error("invalid_grant");
  }
  const now = nowIso();
  const result = await db.execute({ sql: "UPDATE mcp_oauth_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND revoked_at IS NULL RETURNING token_family_id, user_id, scope", args: [now, hashOpaque(input.refreshToken)] });
  const consumed = result.rows[0] as Record<string, unknown> | undefined;
  if (!consumed) {
    // A concurrent request may have won the atomic consume between the
    // initial SELECT and this UPDATE. Treat that race as refresh-token reuse
    // and revoke the whole family, not just the losing request.
    await db.execute({ sql: "UPDATE mcp_oauth_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE token_family_id = ?", args: [nowIso(), String(row.token_family_id)] });
    throw new Error("invalid_grant");
  }
  return issueTokenPair({ clientId: input.clientId, userId: String(consumed.user_id), scope: String(consumed.scope), resource: input.resource, familyId: String(consumed.token_family_id) });
}

export async function revokeToken(token: string) {
  const db = await getTursoClient();
  await db.execute({ sql: "UPDATE mcp_oauth_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE token_hash = ?", args: [nowIso(), hashOpaque(token)] });
}

export async function authenticateAccessToken(token: string): Promise<AssistantPrincipal> {
  const config = mcpConfig();
  const db = await getTursoClient();
  const result = await db.execute({ sql: `SELECT token_kind, client_id, user_id, scope, resource, audience, expires_at, revoked_at FROM mcp_oauth_tokens WHERE token_hash = ? AND token_kind = 'access'`, args: [hashOpaque(token)] });
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row || (config.allowedUserId && String(row.user_id) !== config.allowedUserId) || row.revoked_at || String(row.expires_at) <= nowIso() || String(row.resource) !== config.resource || String(row.audience) !== config.resource) throw new Error("invalid_token");
  const scopes = parseScope(String(row.scope));
  const client = await resolveClient(String(row.client_id));
  if (!client) throw new Error("invalid_token");
  return { userId: String(row.user_id), clientId: String(row.client_id), scopes: assistantScopes(scopes), resource: String(row.resource), audience: String(row.audience) };
}

export async function authenticateBrowserUser(request: Request) {
  return currentAuthorizedUser(request);
}

export function bearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1] ?? null;
}

export function protectedResourceMetadata() {
  const config = mcpConfig();
  return { resource: config.resource, authorization_servers: [config.issuer], scopes_supported: MCP_OAUTH_SCOPES.filter((scope) => scope !== "offline_access" && (mcpWriteEnabled() || !scope.startsWith("assistant:write:"))), bearer_methods_supported: ["header"], resource_signing_alg_values_supported: [] };
}

export function authorizationServerMetadata() {
  const config = mcpConfig();
  return { issuer: config.issuer, authorization_endpoint: `${config.issuer}/api/mcp/oauth/authorize`, token_endpoint: `${config.issuer}/api/mcp/oauth/token`, registration_endpoint: `${config.issuer}/api/mcp/oauth/register`, revocation_endpoint: `${config.issuer}/api/mcp/oauth/revoke`, response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], code_challenge_methods_supported: ["S256"], scopes_supported: MCP_OAUTH_SCOPES.filter((scope) => mcpWriteEnabled() || !scope.startsWith("assistant:write:")), token_endpoint_auth_methods_supported: ["none"] };
}

export function loginReturnTo(request: Request) {
  const url = new URL(request.url);
  return `${url.pathname}${url.search}`.slice(0, 2000);
}

export function safeExternalRedirect(url: string, params: Record<string, string>) {
  const target = new URL(url);
  for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);
  return target.toString();
}
