import "server-only";

import { createHmac, scryptSync, timingSafeEqual } from "node:crypto";

// A second password for the VAT workspace on top of the staff login. Only a
// scrypt hash is configured (VAT_ACCESS_PASSWORD_HASH = "scrypt:<salt>:<hash>").
// Unlocking sets an HttpOnly cookie bound to the staff member, valid 8 hours.

export const VAT_ACCESS_COOKIE = "vat_access";
const VALID_MS = 8 * 60 * 60 * 1000;

function signingSecret() {
  const secret = process.env.BETTER_AUTH_SECRET?.trim();
  if (!secret) throw new Error("BETTER_AUTH_SECRET is required for the VAT password.");
  return secret;
}

export function isVatPasswordConfigured() {
  return Boolean(process.env.VAT_ACCESS_PASSWORD_HASH?.trim());
}

export function checkVatPassword(password: string) {
  const [scheme, salt, expected] = (process.env.VAT_ACCESS_PASSWORD_HASH ?? "").trim().split(":");
  if (scheme !== "scrypt" || !salt || !expected) return false;
  const actual = scryptSync(password, salt, 32);
  const wanted = Buffer.from(expected, "base64url");
  return wanted.length === actual.length && timingSafeEqual(actual, wanted);
}

function sign(payload: string) {
  return createHmac("sha256", signingSecret()).update(`vat-access:${payload}`).digest("base64url");
}

export function createVatAccessToken(userId: string) {
  const payload = `${userId}.${Date.now() + VALID_MS}`;
  return { value: `${payload}.${sign(payload)}`, maxAgeSeconds: VALID_MS / 1000 };
}

/** True when the cookie was issued to this staff member and hasn't expired. */
export function hasVatAccess(cookieValue: string | null | undefined, userId: string) {
  if (!isVatPasswordConfigured()) return true;
  if (!cookieValue) return false;
  const parts = cookieValue.split(".");
  if (parts.length !== 3) return false;
  const [owner, expires, signature] = parts;
  const expected = sign(`${owner}.${expires}`);
  const valid = signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  return valid && owner === userId && Number(expires) > Date.now();
}

export function readCookie(header: string | null, name: string) {
  const match = header?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}
