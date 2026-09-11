import { createClient } from "@libsql/client";
import { LibsqlDialect } from "@libsql/kysely-libsql";
import { betterAuth } from "better-auth";
import { hashPassword } from "better-auth/crypto";
import { dash } from "@better-auth/infra";
import { createHash, randomUUID } from "node:crypto";
import { assertTursoConfiguration, getTursoClient, hasTursoConfiguration } from "@/lib/turso";

const sessionLifetime = 60 * 60 * 24 * 30;

function isProductionRuntime() {
  return process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build";
}

function normalizeOrigin(value: string | undefined) {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function getCanonicalAppUrl() {
  const configured = process.env.BETTER_AUTH_URL?.trim()
    || process.env.APP_URL?.trim()
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined)
    || "http://localhost:3000";
  const origin = normalizeOrigin(configured);
  if (!origin) throw new Error("BETTER_AUTH_URL or APP_URL must be an absolute URL.");
  if (isProductionRuntime() && !origin.startsWith("https://")) {
    throw new Error("BETTER_AUTH_URL or APP_URL must use HTTPS in production.");
  }
  return origin;
}

function resolveAuthSecret() {
  const secret = process.env.BETTER_AUTH_SECRET?.trim();
  if (secret && secret.length >= 32) return secret;
  if (isProductionRuntime()) {
    throw new Error("BETTER_AUTH_SECRET must be set to a random value of at least 32 characters in production.");
  }
  // A per-workspace development fallback avoids accidentally sharing one
  // public secret between local projects while keeping local setup frictionless.
  return createHash("sha256").update(`serenity-hue:${process.cwd()}:development`).digest("hex");
}

const appUrl = getCanonicalAppUrl();
const trustedOrigins = [...new Set([
  appUrl,
  "https://serenity-hue-operations.vercel.app",
  "http://localhost:3000",
  "http://localhost:3001",
  ...(process.env.BETTER_AUTH_TRUSTED_ORIGINS?.split(",") ?? [])
    .map((origin) => normalizeOrigin(origin.trim()))
    .filter((origin): origin is string => Boolean(origin)),
])].filter((origin): origin is string => Boolean(origin));

const authPlugins = process.env.BETTER_AUTH_API_KEY
  ? [dash({ apiKey: process.env.BETTER_AUTH_API_KEY })]
  : [];

let authDatabaseReady: Promise<void> | undefined;

function authDatabaseClient() {
  assertTursoConfiguration();
  if (hasTursoConfiguration()) {
    return createClient({
      url: process.env.TURSO_DATABASE_URL!.trim(),
      authToken: process.env.TURSO_AUTH_TOKEN!.trim(),
    });
  }

  return createClient({ url: "file:./data/serenity-hue.db" });
}

export function isBetterAuthConfigured() {
  try {
    resolveAuthSecret();
    return true;
  } catch {
    return false;
  }
}

export function assertBetterAuthConfiguration() {
  resolveAuthSecret();
  getCanonicalAppUrl();
}

export function getTrustedOrigins() {
  return trustedOrigins;
}

export function ensureAuthDatabase(): Promise<void> {
  const email = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  if (!email || !password) return Promise.resolve();
  if (authDatabaseReady) return authDatabaseReady;

  authDatabaseReady = (async () => {
    const db = await getTursoClient();
    const now = new Date().toISOString();
    const userId = `user_${randomUUID()}`;
    const accountId = `account_${randomUUID()}`;
    const passwordHash = await hashPassword(password);
    const transaction = await db.transaction("write");
    try {
      const existing = await transaction.execute({ sql: `SELECT id FROM "user" WHERE lower(email) = ? LIMIT 1`, args: [email] });
      if (!existing.rows.length) {
        await transaction.execute({
          sql: `INSERT INTO "user" (id, name, email, emailVerified, image, createdAt, updatedAt)
                VALUES (?, 'Serenity Hue Admin', ?, 1, NULL, ?, ?)`,
          args: [userId, email, now, now],
        });
        await transaction.execute({
          sql: `INSERT INTO "account"
                (id, accountId, providerId, userId, accessToken, refreshToken, idToken,
                 accessTokenExpiresAt, refreshTokenExpiresAt, scope, password, createdAt, updatedAt)
              VALUES (?, ?, 'credential', ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?)`,
          args: [accountId, userId, userId, passwordHash, now, now],
        });
      }
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    } finally {
      transaction.close();
    }
  })().catch((error) => {
    authDatabaseReady = undefined;
    throw error;
  });

  return authDatabaseReady;
}

export const auth = betterAuth({
  secret: resolveAuthSecret(),
  baseURL: appUrl,
  trustedOrigins,
  session: {
    // A checked "Remember me" creates a persistent session for 30 days.
    // Better Auth's default is 7 days when this is omitted.
    expiresIn: sessionLifetime,
    // Page guards can validate this signed, short-lived cache without a
    // Turso round trip. API mutations explicitly bypass it below.
    cookieCache: {
      enabled: true,
      strategy: "jwe",
      maxAge: 300,
      refreshCache: false,
    },
  },
  database: {
    // The dialect bundles a slightly older @libsql/core type, while the app
    // uses the current client. Their runtime Client interfaces are compatible.
    dialect: new LibsqlDialect({ client: authDatabaseClient() as never }),
    type: "sqlite",
  },
  emailAndPassword: {
    enabled: true,
    disableSignUp: process.env.AUTH_ALLOW_SIGN_UP !== "true",
  },
  plugins: authPlugins,
  advanced: {
    cookiePrefix: "serenity-hue",
  },
});
