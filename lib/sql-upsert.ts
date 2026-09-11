/**
 * Helpers for writing upserts that do not rewrite unchanged rows.
 *
 * Provider snapshots (TikTok affiliate videos and orders, Parcel2Go
 * deliveries) are re-fetched on every scheduled sync. An unguarded
 * `ON CONFLICT ... DO UPDATE` counts as a row write even when every value is
 * identical, so a small database can burn tens of millions of row writes a
 * month purely re-storing data that never changed.
 */

/**
 * Builds the `WHERE` clause of an upsert's `DO UPDATE` so the row is only
 * rewritten when a meaningful column actually differs.
 *
 * Pass only payload columns. Bookkeeping stamps such as `imported_at`,
 * `updated_at` and `last_synced_at` are set to "now" on every run, so
 * including them would make the guard always true and defeat the purpose.
 *
 * `IS NOT` is SQLite's null-safe inequality, so a column moving to or from
 * NULL still counts as a change.
 *
 * Do NOT guard a table whose rows are swept by a staleness check such as
 * `DELETE ... WHERE synced_at < ?`: suppressing the timestamp write would make
 * that sweep delete every unchanged row. `channel_inventory` is deliberately
 * left unguarded for exactly this reason.
 *
 * Table and column names are compile-time literals from the call sites and are
 * never derived from user input.
 */
export function changedColumns(table: string, columns: readonly string[]) {
  return columns.map((column) => `${table}.${column} IS NOT excluded.${column}`).join(" OR ");
}
