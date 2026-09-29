import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { createClient } from "@libsql/client";
import { parseActivityLogQuery } from "../lib/activity-log-query.ts";
import { sanitizeActivityDetails } from "../lib/activity-log-safety.ts";

async function withDatabase(prefix, callback) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  const databasePath = join(directory, "activity-test.db");
  const db = createClient({ url: pathToFileURL(databasePath).href });
  try {
    await db.executeMultiple(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"));
    return await callback(db);
  } finally {
    db.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }).catch(() => undefined);
  }
}

async function insertActivity(db, input) {
  return db.execute({
    sql: `INSERT INTO application_activity_log
      (id, occurred_at, expires_at, actor_type, actor_id, actor_label, source, provider,
       event_name, entity_type, entity_id, summary, details_json, outcome, dedupe_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(dedupe_key) DO NOTHING`,
    args: [input.id, input.occurredAt, input.expiresAt, input.actorType ?? "staff", input.actorId ?? "staff-1", input.actorLabel ?? "Test operator", input.source ?? "manual", input.provider ?? null, input.eventName, input.entityType ?? null, input.entityId ?? null, input.summary, JSON.stringify(input.details ?? {}), input.outcome ?? "succeeded", input.dedupeKey ?? null],
  });
}

test("activity schema creates filter indexes and deduplicates a sync retry", async () => {
  await withDatabase("serenity-hue-activity-schema-", async (db) => {
    const indexes = await db.execute("PRAGMA index_list(application_activity_log)");
    const names = new Set(indexes.rows.map((row) => String(row.name)));
    assert.ok(names.has("application_activity_log_occurred_at_idx"));
    assert.ok(names.has("application_activity_log_expires_at_idx"));
    assert.ok(names.has("application_activity_log_event_name_idx"));
    assert.ok(names.has("application_activity_log_actor_idx"));
    assert.ok(names.has("application_activity_log_entity_idx"));
    assert.ok(names.has("application_activity_log_provider_idx"));

    const event = { id: "sync-1", occurredAt: "2026-09-21T09:00:00.000Z", expiresAt: "2026-09-28T09:00:00.000Z", eventName: "sync.shopify", entityType: "sync", entityId: "run-1", provider: "shopify", summary: "Shopify sync completed", dedupeKey: "run-1:sync.shopify" };
    await insertActivity(db, event);
    await insertActivity(db, { ...event, id: "sync-1-retry" });
    const rows = await db.execute("SELECT id, dedupe_key FROM application_activity_log");
    assert.deepEqual(rows.rows, [{ id: "sync-1", dedupe_key: "run-1:sync.shopify" }]);
  });
});

test("activity details round-trip only safe metadata and expiry pruning leaves permanent ledgers intact", async () => {
  await withDatabase("serenity-hue-activity-retention-", async (db) => {
    const safeDetails = sanitizeActivityDetails({ count: 3, changed: true, customerEmail: "customer@example.com", shippingAddress: "private", accessToken: "secret", labels: ["inventory", "manual"] });
    assert.deepEqual(safeDetails, { count: 3, changed: true, labels: ["inventory", "manual"] });
    await insertActivity(db, { id: "old", occurredAt: "2026-09-01T09:00:00.000Z", expiresAt: "2026-09-08T09:00:00.000Z", eventName: "inventory.physical.updated", entityType: "physical_inventory", entityId: "variant-1", summary: "Old inventory update", details: safeDetails });
    await insertActivity(db, { id: "fresh", occurredAt: "2026-09-21T09:00:00.000Z", expiresAt: "2026-09-28T09:00:00.000Z", eventName: "inventory.physical.updated", entityType: "physical_inventory", entityId: "variant-2", summary: "Fresh inventory update", details: safeDetails });
    await db.execute({ sql: "INSERT INTO physical_inventory_items (id, title, quantity) VALUES (?, ?, ?)", args: ["item-1", "Permanent ledger item", 3] });
    await db.execute({ sql: `INSERT INTO physical_inventory_ledger (id, physical_item_id, change_type, actor, quantity_before, quantity_after, quantity_delta) VALUES (?, ?, 'manual_edit', ?, ?, ?, ?)`, args: ["ledger-1", "item-1", "Test operator", 0, 3, 3] });

    const stored = await db.execute("SELECT details_json FROM application_activity_log WHERE id = ?", ["fresh"]);
    assert.deepEqual(JSON.parse(String(stored.rows[0].details_json)), safeDetails);
    await db.execute({ sql: "DELETE FROM application_activity_log WHERE expires_at <= ?", args: ["2026-09-21T12:00:00.000Z"] });
    const activityRows = await db.execute("SELECT id FROM application_activity_log ORDER BY occurred_at");
    const ledgerRows = await db.execute("SELECT id FROM physical_inventory_ledger");
    assert.deepEqual(activityRows.rows, [{ id: "fresh" }]);
    assert.deepEqual(ledgerRows.rows, [{ id: "ledger-1" }]);
  });
});

test("activity query defaults to a seven-day feed and bounds pagination choices", () => {
  assert.deepEqual(parseActivityLogQuery({}), {
    q: "", domain: "all", source: "all", provider: "", actor: "", outcome: "all", dateRange: "7", pageSize: 50, page: 1,
  });
  assert.deepEqual(parseActivityLogQuery({ domain: "labs", source: "manual", outcome: "failed", dateRange: "all", pageSize: "100", page: "3" }), {
    q: "", domain: "labs", source: "manual", provider: "", actor: "", outcome: "failed", dateRange: "all", pageSize: 100, page: 3,
  });
  assert.equal(parseActivityLogQuery({ pageSize: "20", page: "-2" }).pageSize, 50);
  assert.equal(parseActivityLogQuery({ pageSize: "20", page: "-2" }).page, 1);
});
