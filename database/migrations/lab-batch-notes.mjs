const VERSION = "2026-10-01-lab-batch-notes";

export async function migrateLabBatchNotes(db) {
  const applied = await db.execute({ sql: "SELECT 1 FROM schema_migrations WHERE version = ?", args: [VERSION] });
  if (applied.rows.length) return false;

  const transaction = await db.transaction("write");
  try {
    const columns = await transaction.execute("PRAGMA table_info(lab_batches)");
    const names = new Set(columns.rows.map((row) => String(row.name)));
    if (!names.has("notes")) await transaction.execute("ALTER TABLE lab_batches ADD COLUMN notes TEXT NOT NULL DEFAULT ''");
    if (!names.has("updated_at")) await transaction.execute("ALTER TABLE lab_batches ADD COLUMN updated_at TEXT");
    await transaction.execute(`UPDATE lab_batches
      SET updated_at = COALESCE(
        (SELECT allocation.updated_at FROM lab_batch_allocations allocation WHERE allocation.batch_id = lab_batches.id),
        created_at
      ) WHERE updated_at IS NULL`);
    await transaction.execute({ sql: "INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)", args: [VERSION] });
    await transaction.commit();
    return true;
  } catch (error) {
    await transaction.rollback();
    throw error;
  } finally {
    transaction.close();
  }
}
