import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createClient } from "@libsql/client";
import { executeMcpWriteOnce } from "../lib/mcp-write-operation.ts";

test("an assistant write runs once for a retry key and rejects a different command using that key", async () => {
  const db = createClient({ url: "file::memory:" });
  try {
    const schema = await readFile(new URL("../database/schema.sql", import.meta.url), "utf8");
    await db.executeMultiple(schema);
    await db.execute({ sql: `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
      VALUES ('owner-1', 'Owner', 'owner@example.test', 1, '2026-09-30', '2026-09-30')`, args: [] });
    await db.execute({ sql: `INSERT INTO mcp_oauth_clients (client_id, client_name, redirect_uris_json)
      VALUES ('claude-1', 'Claude', '[]')`, args: [] });
    await db.execute("CREATE TABLE test_counter (value INTEGER NOT NULL)");
    await db.execute("INSERT INTO test_counter (value) VALUES (0)");
    const input = {
      userId: "owner-1", clientId: "claude-1", toolName: "record_lab_batch_packaging",
      idempotencyKey: "batch-123-pack-1", arguments: { batchId: "batch-123", addedQuantity: 50 },
    };
    const perform = async () => {
      await db.execute("UPDATE test_counter SET value = value + 1");
      return { packagedQuantity: 50 };
    };
    assert.deepEqual(await executeMcpWriteOnce(db, input, perform), { result: { packagedQuantity: 50 }, replayed: false });
    assert.deepEqual(await executeMcpWriteOnce(db, input, perform), { result: { packagedQuantity: 50 }, replayed: true });
    assert.equal(Number((await db.execute("SELECT value FROM test_counter")).rows[0].value), 1);
    await assert.rejects(() => executeMcpWriteOnce(db, { ...input, arguments: { batchId: "batch-123", addedQuantity: 100 } }, perform), /MCP_IDEMPOTENCY_CONFLICT/);
  } finally { db.close(); }
});

test("one-use invitation URLs are returned once but never stored in retry results", async () => {
  const db = createClient({ url: "file::memory:" });
  try {
    await db.executeMultiple(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"));
    await db.execute(`INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES ('owner', 'Owner', 'owner@example.test', 1, '2026-09-30', '2026-09-30')`);
    await db.execute(`INSERT INTO mcp_oauth_clients (client_id, client_name, redirect_uris_json) VALUES ('claude', 'Claude', '[]')`);
    const operation = { userId: "owner", clientId: "claude", toolName: "invite_employee", idempotencyKey: "invite-example-1", arguments: { email: "staff@example.test" } };
    const first = await executeMcpWriteOnce(db, operation, async () => ({ setupUrl: "https://example.test/invite/one-use-token", employeeId: "staff" }),
      (value) => ({ ...value, setupUrl: undefined }));
    assert.match(first.result.setupUrl, /one-use-token/);
    const stored = await db.execute("SELECT result_json FROM mcp_write_operations");
    assert.doesNotMatch(String(stored.rows[0].result_json), /one-use-token/);
    const replay = await executeMcpWriteOnce(db, operation, async () => { throw new Error("must not run"); });
    assert.equal(replay.result.setupUrl, undefined);
  } finally { db.close(); }
});
