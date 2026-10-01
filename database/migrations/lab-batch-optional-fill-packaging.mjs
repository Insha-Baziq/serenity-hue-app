const VERSION = "2026-10-01-lab-batch-optional-fill-packaging";

/** Allow packaged bulk allocations to be recorded before a formula's unit fill is known. */
export async function migrateLabBatchOptionalFillPackaging(db) {
  const applied = await db.execute({
    sql: "SELECT 1 FROM schema_migrations WHERE version = ? LIMIT 1",
    args: [VERSION],
  });
  if (applied.rows.length > 0) return false;

  const transaction = await db.transaction("write");
  try {
    const columns = await transaction.execute("PRAGMA table_info(lab_batch_packaging_ledger)");
    const finishedUnits = columns.rows.find((row) => String(row.name) === "finished_units");
    if (finishedUnits && Number(finishedUnits.notnull) === 1) {
      await transaction.execute(`
        CREATE TABLE lab_batch_packaging_ledger_optional_fill (
          id TEXT PRIMARY KEY,
          batch_id TEXT NOT NULL REFERENCES lab_batches(id) ON DELETE RESTRICT,
          actor TEXT NOT NULL,
          packaged_before REAL NOT NULL,
          packaged_after REAL NOT NULL,
          packaged_delta REAL NOT NULL,
          finished_units INTEGER CHECK (finished_units IS NULL OR finished_units > 0),
          packaging_label TEXT NOT NULL DEFAULT 'Labs packaged output',
          inventory_updated INTEGER NOT NULL DEFAULT 0 CHECK (inventory_updated IN (0, 1)),
          reference TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await transaction.execute(`
        INSERT INTO lab_batch_packaging_ledger_optional_fill
          (id, batch_id, actor, packaged_before, packaged_after, packaged_delta,
           finished_units, packaging_label, inventory_updated, reference, created_at)
        SELECT id, batch_id, actor, packaged_before, packaged_after, packaged_delta,
               finished_units, packaging_label, inventory_updated, reference, created_at
        FROM lab_batch_packaging_ledger
      `);
      await transaction.execute("DROP TABLE lab_batch_packaging_ledger");
      await transaction.execute("ALTER TABLE lab_batch_packaging_ledger_optional_fill RENAME TO lab_batch_packaging_ledger");
      await transaction.execute(`
        CREATE INDEX IF NOT EXISTS lab_batch_packaging_ledger_batch_idx
        ON lab_batch_packaging_ledger(batch_id, created_at DESC)
      `);
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
