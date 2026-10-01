import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client";
import { migrateLabsPackagingSeparation } from "../database/migrations/labs-packaging-separation.mjs";

test("Labs packaging migration preserves fill settings and snapshots old inventory-linked history", async () => {
  const directory = await mkdtemp(join(tmpdir(), "serenity-labs-packaging-migration-"));
  const db = createClient({ url: pathToFileURL(join(directory, "migration.db")).href });
  try {
    await db.executeMultiple(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"));
    await db.execute({
      sql: "INSERT INTO physical_inventory_items (id, title, active) VALUES ('item-1', 'Serenity Balm', 1)",
    });
    await db.execute({
      sql: "INSERT INTO physical_inventory_variants (id, physical_item_id, title, active) VALUES ('variant-1', 'item-1', '10ml', 1)",
    });
    await db.execute({ sql: "INSERT INTO lab_formulas (id, title) VALUES ('formula-1', 'Balm formula')" });
    await db.execute({ sql: "INSERT INTO lab_batches (id, formula_id, batch_number, target_grams, actor) VALUES ('batch-1', 'formula-1', 'B-1', 100, 'Staff')" });
    await db.execute({
      sql: `CREATE TABLE lab_formula_outputs (
        id TEXT PRIMARY KEY, formula_id TEXT NOT NULL UNIQUE REFERENCES lab_formulas(id) ON DELETE CASCADE,
        physical_variant_id TEXT NOT NULL REFERENCES physical_inventory_variants(id) ON DELETE RESTRICT,
        fill_quantity REAL NOT NULL, fill_unit TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
    });
    await db.execute({ sql: "INSERT INTO lab_formula_outputs (id, formula_id, physical_variant_id, fill_quantity, fill_unit) VALUES ('output-1', 'formula-1', 'variant-1', 10, 'ml')" });
    await db.execute("DROP TABLE lab_batch_packaging_ledger");
    await db.execute(`CREATE TABLE lab_batch_packaging_ledger (
      id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES lab_batches(id) ON DELETE RESTRICT,
      physical_variant_id TEXT NOT NULL REFERENCES physical_inventory_variants(id) ON DELETE RESTRICT,
      actor TEXT NOT NULL, packaged_before REAL NOT NULL, packaged_after REAL NOT NULL,
      packaged_delta REAL NOT NULL, finished_units INTEGER NOT NULL, inventory_updated INTEGER NOT NULL DEFAULT 1,
      reference TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await db.execute(`INSERT INTO lab_batch_packaging_ledger
      (id, batch_id, physical_variant_id, actor, packaged_before, packaged_after, packaged_delta, finished_units, inventory_updated, reference)
      VALUES ('event-1', 'batch-1', 'variant-1', 'Staff', 0, 50, 50, 5, 1, 'production fill · variant-1')`);

    assert.equal(await migrateLabsPackagingSeparation(db), true);
    assert.equal(await migrateLabsPackagingSeparation(db), false);

    const packaging = await db.execute("SELECT formula_id, fill_quantity, fill_unit FROM lab_formula_packaging WHERE formula_id = 'formula-1'");
    assert.deepEqual({
      formulaId: packaging.rows[0].formula_id,
      fillQuantity: packaging.rows[0].fill_quantity,
      fillUnit: packaging.rows[0].fill_unit,
    }, { formulaId: "formula-1", fillQuantity: 10, fillUnit: "ml" });

    const oldTable = await db.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'lab_formula_outputs'");
    assert.equal(oldTable.rows.length, 0);
    const history = await db.execute("SELECT packaging_label, inventory_updated, reference FROM lab_batch_packaging_ledger WHERE id = 'event-1'");
    assert.deepEqual({
      packagingLabel: history.rows[0].packaging_label,
      inventoryUpdated: history.rows[0].inventory_updated,
      reference: history.rows[0].reference,
    }, { packagingLabel: "Serenity Balm · 10ml", inventoryUpdated: 1, reference: "Legacy production fill" });
    const columns = await db.execute("PRAGMA table_info(lab_batch_packaging_ledger)");
    assert.equal(columns.rows.some((column) => column.name === "physical_variant_id"), false);
    const foreignKeys = await db.execute("PRAGMA foreign_key_list(lab_batch_packaging_ledger)");
    assert.equal(foreignKeys.rows.some((row) => row.table === "physical_inventory_variants"), false);
  } finally {
    await db.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }).catch(() => undefined);
  }
});
