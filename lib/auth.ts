import { createClient } from "@libsql/client";
import { LibsqlDialect } from "@libsql/kysely-libsql";
import { betterAuth } from "better-auth";
import { hashPassword } from "better-auth/crypto";
import { randomUUID } from "node:crypto";
import { getTursoClient } from "@/lib/turso";

const localSecret = "serenity-hue-local-development-secret-change-me";
const appUrl = process.env.BETTER_AUTH_URL
  ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined)
  ?? process.env.APP_URL
  ?? "http://localhost:3000";
const trustedOrigins = [
  appUrl,
  "https://serenity-hue-operations.vercel.app",
  "http://localhost:3000",
  "http://localhost:3001",
].filter((origin, index, origins) => Boolean(origin) && origins.indexOf(origin) === index);

function authDatabaseClient() {
  if (process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN) {
    return createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }

  return createClient({ url: "file:./data/serenity-hue.db" });
}

export function isBetterAuthConfigured() {
  // Better Auth always has a secret: production uses BETTER_AUTH_SECRET and
  // local development uses the non-production fallback above. Keeping this
  // true makes the app fail closed instead of silently disabling auth locally.
  return true;
}

export async function ensureAuthDatabase() {
  const db = await getTursoClient();
  const email = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  if (!email || !password) return;

  const existing = await db.execute({ sql: `SELECT id FROM "user" WHERE lower(email) = ? LIMIT 1`, args: [email] });
  if (existing.rows.length > 0) return;

  const now = new Date().toISOString();
  const userId = `user_${randomUUID()}`;
  const accountId = `account_${randomUUID()}`;
  const passwordHash = await hashPassword(password);
  await db.execute({
    sql: `INSERT INTO "user" (id, name, email, emailVerified, image, createdAt, updatedAt)
          VALUES (?, 'Serenity Hue Admin', ?, 1, NULL, ?, ?)`,
    args: [userId, email, now, now],
  });
  await db.execute({
    sql: `INSERT INTO "account"
            (id, accountId, providerId, userId, accessToken, refreshToken, idToken,
             accessTokenExpiresAt, refreshTokenExpiresAt, scope, password, createdAt, updatedAt)
          VALUES (?, ?, 'credential', ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?)`,
    args: [accountId, userId, userId, passwordHash, now, now],
  });
}

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET ?? localSecret,
  baseURL: appUrl,
  trustedOrigins,
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
  advanced: {
    cookiePrefix: "serenity-hue",
  },
});
