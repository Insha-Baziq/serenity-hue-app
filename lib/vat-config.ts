import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getCanonicalAppUrl } from "@/lib/auth";

// VAT connection settings. Names are namespaced so they never collide with the
// TikTok/Shopify integrations. Values are read only in server code.
export const VAT_ENV = {
  encryptionKey: "VAT_TOKEN_ENCRYPTION_KEY",
  dropboxAppKey: "VAT_DROPBOX_APP_KEY",
  dropboxAppSecret: "VAT_DROPBOX_APP_SECRET",
  microsoftClientId: "VAT_MICROSOFT_CLIENT_ID",
  microsoftClientSecret: "VAT_MICROSOFT_CLIENT_SECRET",
  microsoftTenant: "VAT_MICROSOFT_TENANT",
} as const;

function env(name: string) {
  return process.env[name]?.trim() || "";
}

function isProductionRuntime() {
  return process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build";
}

export function vatDropboxRedirectUri() {
  return `${getCanonicalAppUrl()}/api/vat/connections/dropbox/callback`;
}

export function vatOutlookRedirectUri() {
  return `${getCanonicalAppUrl()}/api/vat/connections/outlook/callback`;
}

export function vatDropboxCredentials() {
  const appKey = env(VAT_ENV.dropboxAppKey);
  const appSecret = env(VAT_ENV.dropboxAppSecret);
  return appKey && appSecret ? { appKey, appSecret } : null;
}

export function vatMicrosoftCredentials() {
  const clientId = env(VAT_ENV.microsoftClientId);
  const clientSecret = env(VAT_ENV.microsoftClientSecret);
  return clientId && clientSecret ? { clientId, clientSecret, tenant: env(VAT_ENV.microsoftTenant) || "common" } : null;
}

function hasEncryptionKey() {
  return Boolean(env(VAT_ENV.encryptionKey)) || !isProductionRuntime();
}

/** Missing setting names (never values), for an honest setup-required state. */
export function missingVatSettings() {
  const missing: string[] = [];
  if (!env(VAT_ENV.encryptionKey)) missing.push(VAT_ENV.encryptionKey);
  if (!env(VAT_ENV.dropboxAppKey)) missing.push(VAT_ENV.dropboxAppKey);
  if (!env(VAT_ENV.dropboxAppSecret)) missing.push(VAT_ENV.dropboxAppSecret);
  if (!env(VAT_ENV.microsoftClientId)) missing.push(VAT_ENV.microsoftClientId);
  if (!env(VAT_ENV.microsoftClientSecret)) missing.push(VAT_ENV.microsoftClientSecret);
  return missing;
}

export function isVatDropboxConfigured() {
  return Boolean(vatDropboxCredentials()) && hasEncryptionKey();
}

export function isVatOutlookConfigured() {
  return Boolean(vatMicrosoftCredentials()) && hasEncryptionKey();
}

const tokenPrefix = "vat-token:v1";

function encryptionKey() {
  const encoded = env(VAT_ENV.encryptionKey);
  if (encoded) {
    const key = Buffer.from(encoded, "base64");
    if (key.length !== 32) throw new Error(`${VAT_ENV.encryptionKey} must be a base64-encoded 32-byte key.`);
    return key;
  }
  if (isProductionRuntime()) throw new Error(`${VAT_ENV.encryptionKey} must be configured before VAT connections can be used.`);
  // Local development only: a machine-derived key so local tokens are still not plain text.
  return createHash("sha256").update(`serenity-hue:${process.cwd()}:vat-development`).digest();
}

/** AES-256-GCM, authenticated: a tampered or foreign-key token fails to decrypt. */
export function encryptVatToken(value: string) {
  if (!value) throw new Error("Refusing to encrypt an empty token.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${tokenPrefix}:${Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url")}`;
}

export function decryptVatToken(value: string) {
  if (!value.startsWith(`${tokenPrefix}:`)) throw new Error("Stored VAT connection token is not encrypted.");
  const payload = Buffer.from(value.slice(tokenPrefix.length + 1), "base64url");
  if (payload.length < 29) throw new Error("Stored VAT connection token is malformed.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), payload.subarray(0, 12));
  decipher.setAuthTag(payload.subarray(12, 28));
  return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString("utf8");
}

export function hashVatOAuthState(state: string) {
  return createHash("sha256").update(`vat-oauth:${state}`).digest("hex");
}
