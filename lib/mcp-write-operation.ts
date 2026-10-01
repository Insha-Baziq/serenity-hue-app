import { createHash } from "node:crypto";
import type { Client } from "@libsql/client";

export type McpWriteOperation = {
  userId: string;
  clientId: string;
  toolName: string;
  idempotencyKey: string;
  arguments: Record<string, unknown>;
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

function argumentsHash(toolName: string, value: Record<string, unknown>) {
  return createHash("sha256").update(JSON.stringify({ toolName, arguments: canonicalize(value) })).digest("hex");
}

export async function executeMcpWriteOnce<T>(
  db: Pick<Client, "execute">,
  operation: McpWriteOperation,
  perform: () => Promise<T>,
  persistResult?: (result: T) => T,
): Promise<{ result: T; replayed: boolean }> {
  const hash = argumentsHash(operation.toolName, operation.arguments);
  const now = new Date().toISOString();
  const key = [operation.userId, operation.clientId, operation.idempotencyKey];
  const claim = await db.execute({
    sql: `INSERT INTO mcp_write_operations
      (user_id, client_id, idempotency_key, tool_name, arguments_hash, status, result_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'pending', NULL, ?, ?) ON CONFLICT DO NOTHING`,
    args: [...key, operation.toolName, hash, now, now],
  });
  if (Number(claim.rowsAffected ?? 0) === 0) {
    const existing = await db.execute({
      sql: `SELECT tool_name, arguments_hash, status, result_json FROM mcp_write_operations
            WHERE user_id = ? AND client_id = ? AND idempotency_key = ?`,
      args: key,
    });
    const row = existing.rows[0];
    if (!row || row.tool_name !== operation.toolName || row.arguments_hash !== hash) throw new Error("MCP_IDEMPOTENCY_CONFLICT");
    if (row.status !== "succeeded" || typeof row.result_json !== "string") throw new Error("MCP_OPERATION_UNCERTAIN");
    return { result: JSON.parse(row.result_json) as T, replayed: true };
  }

  try {
    const result = await perform();
    const resultJson = JSON.stringify(persistResult ? persistResult(result) : result);
    if (!resultJson || resultJson.length > 32_000) throw new Error("MCP_RESULT_TOO_LARGE");
    await db.execute({
      sql: `UPDATE mcp_write_operations SET status = 'succeeded', result_json = ?, updated_at = ?
            WHERE user_id = ? AND client_id = ? AND idempotency_key = ? AND status = 'pending'`,
      args: [resultJson, new Date().toISOString(), ...key],
    });
    return { result, replayed: false };
  } catch (error) {
    try {
      await db.execute({
        sql: `UPDATE mcp_write_operations SET status = 'uncertain', updated_at = ?
              WHERE user_id = ? AND client_id = ? AND idempotency_key = ? AND status = 'pending'`,
        args: [new Date().toISOString(), ...key],
      });
    } catch { /* A pending reservation still prevents an automatic replay. */ }
    throw error;
  }
}
