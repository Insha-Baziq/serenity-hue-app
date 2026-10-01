const VERSION = "2026-09-30-labs-packaging-separation";

async function tableColumns(db, table) {
  const result = await db.execute(`PRAGMA table_info(${table})`);
  return result.rows.map((row) => String(row.name));
}

async function tableExists(db, table) {
  const result = await db.execute({
    sql: "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
    args: [table],
  });
  return result.rows.length > 0;
}

/** Migrate Labs packaging away from physical catalogue/on-hand relationships. */
export async function migrateLabsPackagingSeparation(db) {
  const applied = await db.execute({
    sql: "SELECT 1 FROM schema_migrations WHERE version = ? LIMIT 1",
    args: [VERSION],
  });
  if (applied.rows.length > 0) return false;

  const transaction = await db.transaction("write");
  try {
    if (await tableExists(transaction, "lab_formula_outputs")) {
      await transaction.execute(`
        INSERT OR IGNORE INTO lab_formula_packaging
          (id, formula_id, fill_quantity, fill_unit, created_at, updated_at)
        SELECT id, formula_id, fill_quantity, fill_unit, created_at, updated_at
        FROM lab_formula_outputs
        WHERE active = 1
      `);
    }

    const packagingLedgerColumns = await tableColumns(transaction, "lab_batch_packaging_ledger");
    if (packagingLedgerColumns.includes("physical_variant_id")) {
      await transaction.execute(`
        CREATE TABLE lab_batch_packaging_ledger_separated (
          id TEXT PRIMARY KEY,
          batch_id TEXT NOT NULL REFERENCES lab_batches(id) ON DELETE RESTRICT,
          actor TEXT NOT NULL,
          packaged_before REAL NOT NULL,
          packaged_after REAL NOT NULL,
          packaged_delta REAL NOT NULL,
          finished_units INTEGER NOT NULL CHECK (finished_units > 0),
          packaging_label TEXT NOT NULL DEFAULT 'Labs packaged output',
          inventory_updated INTEGER NOT NULL DEFAULT 1 CHECK (inventory_updated IN (0, 1)),
          reference TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await transaction.execute(`
        INSERT INTO lab_batch_packaging_ledger_separated
          (id, batch_id, actor, packaged_before, packaged_after, packaged_delta,
           finished_units, packaging_label, inventory_updated, reference, created_at)
        SELECT ledger.id, ledger.batch_id, ledger.actor, ledger.packaged_before,
               ledger.packaged_after, ledger.packaged_delta, ledger.finished_units,
               COALESCE(NULLIF(trim(pi.title || ' · ' || piv.title), ' · '), 'Legacy Labs packaging'),
               ledger.inventory_updated,
               CASE WHEN ledger.reference LIKE 'production fill · %'
                    THEN 'Legacy production fill' ELSE ledger.reference END,
               ledger.created_at
        FROM lab_batch_packaging_ledger AS ledger
        LEFT JOIN physical_inventory_variants AS piv ON piv.id = ledger.physical_variant_id
        LEFT JOIN physical_inventory_items AS pi ON pi.id = piv.physical_item_id
      `);
      await transaction.execute("DROP TABLE lab_batch_packaging_ledger");
      await transaction.execute("ALTER TABLE lab_batch_packaging_ledger_separated RENAME TO lab_batch_packaging_ledger");
      await transaction.execute(`
        CREATE INDEX IF NOT EXISTS lab_batch_packaging_ledger_batch_idx
        ON lab_batch_packaging_ledger(batch_id, created_at DESC)
      `);
    }

    if (await tableExists(transaction, "lab_formula_outputs")) {
      await transaction.execute("DROP TABLE lab_formula_outputs");
    }
    await transaction.execute({
      sql: "INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)",
      args: [VERSION],
    });
    await transaction.commit();
    return true;
  } catch (error) {
    await transaction.rollback();
    throw error;
  } finally {
    transaction.close();
  }
}
