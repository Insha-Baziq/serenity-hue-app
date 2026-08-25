import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const tokenPrefix = "sh-token:v1";

function isProductionRuntime() {
  return process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build";
}

function tokenEncryptionKey() {
  const encoded = process.env.TIKTOK_TOKEN_ENCRYPTION_KEY?.trim();
  if (encoded) {
    const key = Buffer.from(encoded, "base64");
    if (key.length !== 32) {
      throw new Error("TIKTOK_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
    }
    return key;
  }
  if (isProductionRuntime()) {
    throw new Error("TIKTOK_TOKEN_ENCRYPTION_KEY must be configured before TikTok Shop tokens can be used in production.");
  }
  return createHash("sha256").update(`serenity-hue:${process.cwd()}:tiktok-development`).digest();
}

export function encryptTikTokToken(value: string) {
  if (!value) throw new Error("Refusing to encrypt an empty TikTok token.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${tokenPrefix}:${Buffer.concat([iv, tag, encrypted]).toString("base64url")}`;
}

export function decryptTikTokToken(value: string) {
  if (!value) throw new Error("TikTok token is missing.");
  if (!value.startsWith(`${tokenPrefix}:`)) return { value, needsEncryption: true };

  const payload = Buffer.from(value.slice(tokenPrefix.length + 1), "base64url");
  if (payload.length < 29) throw new Error("Stored TikTok token is malformed.");
  const decipher = createDecipheriv("aes-256-gcm", tokenEncryptionKey(), payload.subarray(0, 12));
  decipher.setAuthTag(payload.subarray(12, 28));
  const decrypted = Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString("utf8");
  return { value: decrypted, needsEncryption: false };
}
