import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client";
import { migrateLabBatchNotes } from "../database/migrations/lab-batch-notes.mjs";
import { nextLabBatchUpdatedAt, normalizeLabBatchNotes } from "../lib/lab-batch-notes.ts";
import { formatExactDateTime } from "../lib/format.ts";

test("batch notes preserve readable paragraphs, allow clearing, and reject oversized input", () => {
  assert.equal(normalizeLabBatchNotes("  First line\r\n\r\nSecond line  "), "First line\n\nSecond line");
  assert.equal(normalizeLabBatchNotes("   "), "");
  assert.throws(() => normalizeLabBatchNotes("x".repeat(4001)), /4,000/);
});

test("batch timestamps show exact UK date and time, including daylight saving", () => {
  assert.equal(formatExactDateTime("2026-10-01T12:34:56.000Z"), "1 Oct 2026, 13:34:56 BST");
  assert.equal(formatExactDateTime("2026-01-01 12:34:56"), "1 Jan 2026, 12:34:56 GMT");
});

test("each batch edit advances the update timestamp even within one millisecond", () => {
  assert.equal(nextLabBatchUpdatedAt("2026-10-01T12:34:56.000Z", Date.parse("2026-10-01T12:34:56.000Z")), "2026-10-01T12:34:56.001Z");
});

test("batch migration preserves creation time and backfills latest packaging update", async () => {
  const directory = await mkdtemp(join(tmpdir(), "serenity-batch-notes-"));
  const db = createClient({ url: pathToFileURL(join(directory, "test.db")).href });
  try {
    await db.executeMultiple(`
      CREATE TABLE schema_migrations (version TEXT PRIMARY KEY);
      CREATE TABLE lab_batches (id TEXT PRIMARY KEY, created_at TEXT NOT NULL);
      CREATE TABLE lab_batch_allocations (batch_id TEXT PRIMARY KEY, updated_at TEXT NOT NULL);
      INSERT INTO lab_batches VALUES ('old-batch', '2026-09-30T10:00:00.000Z');
      INSERT INTO lab_batch_allocations VALUES ('old-batch', '2026-09-30T11:00:00.000Z');
    `);
    assert.equal(await migrateLabBatchNotes(db), true);
    assert.equal(await migrateLabBatchNotes(db), false);
    const result = await db.execute("SELECT notes, created_at, updated_at FROM lab_batches WHERE id = 'old-batch'");
    assert.deepEqual([...Object.values(result.rows[0])], ["", "2026-09-30T10:00:00.000Z", "2026-09-30T11:00:00.000Z"]);
  } finally {
    await db.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }).catch(() => undefined);
  }
});
