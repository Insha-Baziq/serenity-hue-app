import { createClient } from "@libsql/client";
import { createCipheriv, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import nextEnv from "@next/env";

const { loadEnvConfig, updateInitialEnv } = nextEnv;

// Use the same local environment resolution as `next dev` (.env.local). A real
// deployed environment still wins because Next does not replace non-empty values.
loadEnvConfig(process.cwd(), true);
const blankEnvironmentKeys = ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN"].filter(
  (key) => process.env[key] !== undefined && !process.env[key]?.trim(),
);
if (blankEnvironmentKeys.length) {
  updateInitialEnv(Object.fromEntries(blankEnvironmentKeys.map((key) => [key, undefined])));
  for (const key of blankEnvironmentKeys) delete process.env[key];
}
loadEnvConfig(process.cwd(), true, console, true);

const url = process.env.TURSO_DATABASE_URL?.trim();
const authToken = process.env.TURSO_AUTH_TOKEN?.trim();
if (!url || !authToken) throw new Error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required.");

const [schema, migrationManifest, physicalSeed] = await Promise.all([
  readFile(new URL("../database/schema.sql", import.meta.url), "utf8"),
  readFile(new URL("../database/migrations.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../database/physical-inventory-seed.json", import.meta.url), "utf8").then(JSON.parse),
]);

const client = createClient({ url, authToken });

function encryptTikTokToken(value, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `sh-token:v1:${Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url")}`;
}

try {
  for (const [table, column, definition] of migrationManifest.columns) {
    const columns = await client.execute(`PRAGMA table_info(${table})`);
    if (columns.rows.length === 0) continue;
    if (!columns.rows.some((row) => row.name === column)) {
      await client.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  await client.executeMultiple(schema);

  for (const [table, column, definition] of migrationManifest.columns) {
    const columns = await client.execute(`PRAGMA table_info(${table})`);
    if (columns.rows.length === 0) continue;
    if (!columns.rows.some((row) => row.name === column)) {
      await client.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  await client.execute("DELETE FROM order_search");
  await client.execute(`
    INSERT INTO order_search (rowid, order_id, order_number, customer_name, customer_email, line_items)
    SELECT o.rowid, o.id, o.order_number, COALESCE(o.customer_name, ''), COALESCE(o.customer_email, ''),
      COALESCE((SELECT group_concat(COALESCE(oi.title, '') || ' ' || COALESCE(oi.sku, ''), ' ')
                FROM order_items oi WHERE oi.order_id = o.id), '')
    FROM orders o
  `);

  const physicalCount = await client.execute("SELECT COUNT(*) AS count FROM physical_inventory_items");
  if (Number(physicalCount.rows[0]?.count ?? 0) === 0) {
    const now = new Date().toISOString();
    const statements = physicalSeed.items.flatMap((item) => [
      {
        sql: `INSERT INTO physical_inventory_items (
          id, title, description, shopify_product_id, quantity, quantity_known,
          packaging_type, reorder_point, source_label, active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 0, 0, ?, 0, ?, 1, ?, ?)`,
        args: [item.id, item.title, item.description, item.shopifyProductId, item.packaging, physicalSeed.sourceLabel, now, now],
      },
      ...item.variants.map((title, index) => ({
        sql: `INSERT INTO physical_inventory_variants (
          id, physical_item_id, title, quantity, quantity_known, active, sort_order, created_at, updated_at
        ) VALUES (?, ?, ?, 0, 0, 1, ?, ?, ?)`,
        args: [`${item.id}--${index + 1}`, item.id, title, index, now, now],
      })),
    ]);
    await client.batch(statements, "write");
  }

  await client.execute({
    sql: `INSERT INTO inventory_settings (key, value, updated_at)
      VALUES ('physical_inventory_seed_version', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    args: [physicalSeed.version, new Date().toISOString()],
  });

  const tokenRows = await client.execute("SELECT id, access_token, refresh_token FROM tiktok_connections");
  const plainTokenRows = tokenRows.rows.filter((row) =>
    !String(row.access_token ?? "").startsWith("sh-token:v1:")
    || !String(row.refresh_token ?? "").startsWith("sh-token:v1:"),
  );
  if (plainTokenRows.length) {
    const key = Buffer.from(process.env.TIKTOK_TOKEN_ENCRYPTION_KEY?.trim() ?? "", "base64");
    if (key.length !== 32) {
      throw new Error("TIKTOK_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key before migrating stored TikTok tokens.");
    }
    await client.batch(plainTokenRows.map((row) => ({
      sql: "UPDATE tiktok_connections SET access_token = ?, refresh_token = ?, updated_at = ? WHERE id = ?",
      args: [
        encryptTikTokToken(String(row.access_token), key),
        encryptTikTokToken(String(row.refresh_token), key),
        new Date().toISOString(),
        String(row.id),
      ],
    })), "write");
  }
  await client.execute({
    sql: "INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)",
    args: [migrationManifest.version],
  });

  const verification = await client.execute({
    sql: "SELECT version, applied_at FROM schema_migrations WHERE version = ?",
    args: [migrationManifest.version],
  });
  if (!verification.rows[0]) throw new Error("Migration version was not recorded.");
  console.log(`Schema migration ${migrationManifest.version} complete.`);
} finally {
  client.close();
}
