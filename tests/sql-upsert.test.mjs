import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@libsql/client";
import { changedColumns } from "../lib/sql-upsert.ts";

/**
 * The scheduled sync re-fetches whole provider snapshots every run. Without a
 * change guard each `ON CONFLICT DO UPDATE` counts as a row write even when
 * nothing differs, which is what exhausted the database's monthly write quota.
 * These tests pin the guard's behaviour against a real SQLite engine.
 */
async function videoTable() {
  const db = createClient({ url: ":memory:" });
  await db.execute(`CREATE TABLE tiktok_affiliate_videos (
    id TEXT PRIMARY KEY,
    shop_id TEXT NOT NULL,
    source_video_id TEXT NOT NULL,
    video_title TEXT,
    gross_amount_minor INTEGER NOT NULL,
    source_updated_at TEXT,
    imported_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(shop_id, source_video_id))`);

  const sql = `INSERT INTO tiktok_affiliate_videos
      (id, shop_id, source_video_id, video_title, gross_amount_minor, source_updated_at, imported_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(shop_id, source_video_id) DO UPDATE SET
      video_title=excluded.video_title, gross_amount_minor=excluded.gross_amount_minor,
      source_updated_at=excluded.source_updated_at, imported_at=excluded.imported_at, updated_at=excluded.updated_at
    WHERE ${changedColumns("tiktok_affiliate_videos", ["video_title", "gross_amount_minor", "source_updated_at"])}`;

  return {
    db,
    upsert: (title, amount, stamp) =>
      db.execute({ sql, args: ["video-1", "shop-1", "source-1", title, amount, "2026-09-01", stamp, stamp] }),
  };
}

test("a re-imported provider row that has not changed is not rewritten", async () => {
  const { upsert } = await videoTable();

  assert.equal((await upsert("Brow routine", 1000, "2026-09-11T10:00:00Z")).rowsAffected, 1);

  // The importer supplies a fresh imported_at/updated_at on every run. Those
  // stamps must not on their own count as a change, or the guard never fires.
  assert.equal((await upsert("Brow routine", 1000, "2026-09-11T10:05:00Z")).rowsAffected, 0);
  assert.equal((await upsert("Brow routine", 1000, "2026-09-11T10:10:00Z")).rowsAffected, 0);
});

test("a provider row is rewritten as soon as a reported value moves", async () => {
  const { db, upsert } = await videoTable();
  await upsert("Brow routine", 1000, "2026-09-11T10:00:00Z");

  assert.equal((await upsert("Brow routine", 1500, "2026-09-11T10:05:00Z")).rowsAffected, 1);
  assert.equal((await upsert("Brow routine, redone", 1500, "2026-09-11T10:10:00Z")).rowsAffected, 1);

  // IS NOT is null-safe, so a value clearing to NULL still counts as a change.
  assert.equal((await upsert(null, 1500, "2026-09-11T10:15:00Z")).rowsAffected, 1);

  const row = await db.execute("SELECT video_title, gross_amount_minor, updated_at FROM tiktok_affiliate_videos");
  assert.deepEqual(row.rows[0].video_title, null);
  assert.equal(row.rows[0].gross_amount_minor, 1500);
  // The stamp tracks the last real change, not the last poll.
  assert.equal(row.rows[0].updated_at, "2026-09-11T10:15:00Z");
});

test("the guard names the table it protects for every column", () => {
  assert.equal(
    changedColumns("shipment_events", ["label", "occurred_at"]),
    "shipment_events.label IS NOT excluded.label OR shipment_events.occurred_at IS NOT excluded.occurred_at",
  );
});
