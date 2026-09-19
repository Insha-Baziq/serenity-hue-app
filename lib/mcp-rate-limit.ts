import "server-only";

import { createHash } from "node:crypto";
import { getTursoClient } from "@/lib/turso";

const activeByToken = new Map<string, number>();

function bucketStart(now = Date.now()) {
  return new Date(Math.floor(now / 60_000) * 60_000).toISOString();
}

function key(value: string) {
  return createHash("sha256").update(`${process.env.MCP_OAUTH_SECRET ?? "local"}:${value}`).digest("hex");
}

async function consume(bucketKey: string, limit: number) {
  const db = await getTursoClient();
  const result = await db.execute({
    sql: `INSERT INTO mcp_rate_limit_buckets (bucket_key, window_start, request_count, updated_at)
          VALUES (?, ?, 1, ?)
          ON CONFLICT(bucket_key, window_start) DO UPDATE SET request_count = request_count + 1, updated_at = excluded.updated_at
          RETURNING request_count`,
    args: [key(bucketKey), bucketStart(), new Date().toISOString()],
  });
  return Number(result.rows[0]?.request_count ?? limit + 1) <= limit;
}

export async function enforceMcpRateLimits(input: { token?: string | null; clientId?: string | null; ip?: string | null; endpoint?: "mcp" | "oauth" }) {
  const checks = [
    input.token ? consume(`token:${input.token}`, 60) : null,
    input.clientId ? consume(`client:${input.clientId}`, 120) : null,
    input.ip ? consume(`ip:${input.ip}`, input.endpoint === "oauth" ? 120 : 300) : null,
  ].filter((check): check is Promise<boolean> => Boolean(check));
  if (!(await Promise.all(checks)).every(Boolean)) return false;
  return true;
}

export function tryAcquireTokenConcurrency(token: string, limit = 4) {
  const id = key(`active:${token}`);
  const current = activeByToken.get(id) ?? 0;
  if (current >= limit) return false;
  activeByToken.set(id, current + 1);
  return true;
}

export function releaseTokenConcurrency(token: string) {
  const id = key(`active:${token}`);
  const current = activeByToken.get(id) ?? 0;
  if (current <= 1) activeByToken.delete(id);
  else activeByToken.set(id, current - 1);
}
