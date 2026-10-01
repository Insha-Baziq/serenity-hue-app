import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client";
import { migrateLabBatchOptionalFillPackaging } from "../database/migrations/lab-batch-optional-fill-packaging.mjs";

test("optional fill migration preserves existing packaging history and allows unknown finished-unit counts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "serenity-lab-optional-fill-"));
  const db = createClient({ url: pathToFileURL(join(directory, "migration.db")).href });
  try {
    await db.executeMultiple(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"));
    await db.execute({ sql: "INSERT INTO lab_formulas (id, title) VALUES ('formula-1', 'Serum')" });
    await db.execute({ sql: "INSERT INTO lab_batches (id, formula_id, batch_number, target_grams, actor) VALUES ('batch-1', 'formula-1', 'B-1', 100, 'Staff')" });
    await db.execute("DROP TABLE lab_batch_packaging_ledger");
    await db.execute(`CREATE TABLE lab_batch_packaging_ledger (
      id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES lab_batches(id) ON DELETE RESTRICT,
      actor TEXT NOT NULL, packaged_before REAL NOT NULL, packaged_after REAL NOT NULL,
      packaged_delta REAL NOT NULL, finished_units INTEGER NOT NULL CHECK (finished_units > 0),
      packaging_label TEXT NOT NULL DEFAULT 'Labs packaged output',
      inventory_updated INTEGER NOT NULL DEFAULT 0 CHECK (inventory_updated IN (0, 1)),
      reference TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await db.execute({
      sql: `INSERT INTO lab_batch_packaging_ledger
        (id, batch_id, actor, packaged_before, packaged_after, packaged_delta, finished_units, packaging_label)
        VALUES ('old-event', 'batch-1', 'Staff', 0, 20, 20, 2, '10 g per unit')`,
    });

    assert.equal(await migrateLabBatchOptionalFillPackaging(db), true);
    assert.equal(await migrateLabBatchOptionalFillPackaging(db), false);
    const oldEvent = await db.execute("SELECT finished_units, packaging_label FROM lab_batch_packaging_ledger WHERE id = 'old-event'");
    assert.deepEqual(oldEvent.rows[0], { finished_units: 2, packaging_label: "10 g per unit" });
    await db.execute({
      sql: `INSERT INTO lab_batch_packaging_ledger
        (id, batch_id, actor, packaged_before, packaged_after, packaged_delta, finished_units, packaging_label)
        VALUES ('new-event', 'batch-1', 'Staff', 20, 35, 15, NULL, 'Unit fill size not configured')`,
    });
    const newEvent = await db.execute("SELECT finished_units, packaging_label FROM lab_batch_packaging_ledger WHERE id = 'new-event'");
    assert.deepEqual(newEvent.rows[0], { finished_units: null, packaging_label: "Unit fill size not configured" });
  } finally {
    await db.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }).catch(() => undefined);
  }
});
