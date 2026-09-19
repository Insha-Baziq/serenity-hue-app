import { createClient } from "@libsql/client";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import migrations from "@/database/migrations.json";
import physicalSeed from "@/database/physical-inventory-seed.json";

export type DatabaseClient = ReturnType<typeof createClient>;
type ColumnMigration = readonly [table: string, column: string, definition: string];

let client: DatabaseClient | undefined;
let schemaReady: Promise<DatabaseClient> | undefined;
let mcpReadClient: DatabaseClient | undefined;

const migrationVersion = migrations.version;
// Rebuilding the FTS index scans every order and its line items. Keep this
// durable maintenance marker separate from the schema manifest so normal
// runtime initialization never repeats the full scan.
const orderSearchRebuildVersion = "2026-09-15-order-search-rebuild-v1";
const columnMigrations = migrations.columns as unknown as readonly ColumnMigration[];
const physicalInventorySeed = physicalSeed as {
  version: string;
  sourceLabel: string;
  items: Array<{
    id: string;
    title: string;
    packaging: string | null;
    shopifyProductId: string | null;
    description: string;
    variants: string[];
  }>;
};

export function hasTursoConfiguration() {
  return Boolean(process.env.TURSO_DATABASE_URL?.trim() && process.env.TURSO_AUTH_TOKEN?.trim());
}

export function hasMcpReadDatabaseConfiguration() {
  const url = process.env.MCP_READ_DATABASE_URL?.trim();
  if (!url) return false;
  if (url.startsWith("file:")) return true;
  return Boolean(process.env.MCP_READ_DATABASE_AUTH_TOKEN?.trim());
}

export function assertMcpReadDatabaseConfiguration() {
  if (process.env.NODE_ENV === "production" && process.env.MCP_READ_DATABASE_ENFORCED !== "true") {
    throw new Error(
      "The remote MCP connector requires MCP_READ_DATABASE_ENFORCED=true after the provider read-only boundary has been verified.",
    );
  }
  if (hasMcpReadDatabaseConfiguration()) return;
  const localFallback = process.env.NODE_ENV !== "production"
    && process.env.MCP_ALLOW_PRIMARY_READ_FALLBACK === "true";
  if (localFallback) return;
  throw new Error(
    "The remote MCP connector requires MCP_READ_DATABASE_URL and MCP_READ_DATABASE_AUTH_TOKEN (or an explicitly enabled local-only fallback).",
  );
}

export function databaseMode() {
  return hasTursoConfiguration() ? "turso" : "local";
}

function requiresPersistentDatabase() {
  return process.env.NEXT_PHASE !== "phase-production-build"
    && (process.env.VERCEL === "1" || process.env.NODE_ENV === "production");
}

export function assertTursoConfiguration() {
  if (requiresPersistentDatabase() && !hasTursoConfiguration()) {
    throw new Error("Turso is required in production. Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN before serving the app.");
  }
}

function shouldAutoInitializeSchema() {
  // Runtime schema writes are deliberately disabled for deployed Turso
  // instances. `npm run db:migrate` owns production migration state.
  return !hasTursoConfiguration() || process.env.TURSO_AUTO_MIGRATE === "true";
}

function createDatabaseClient() {
  if (hasTursoConfiguration()) {
    return createClient({
      url: process.env.TURSO_DATABASE_URL!.trim(),
      authToken: process.env.TURSO_AUTH_TOKEN!.trim(),
    });
  }

  mkdirSync(join(process.cwd(), "data"), { recursive: true });
  return createClient({ url: "file:./data/serenity-hue.db" });
}

function schemaSql() {
  return readFileSync(join(process.cwd(), "database", "schema.sql"), "utf8");
}

async function ensureColumns(db: DatabaseClient) {
  for (const [table, column, definition] of columnMigrations) {
    const existing = await db.execute(`PRAGMA table_info(${table})`);
    if (existing.rows.length === 0) continue;
    if (!existing.rows.some((row) => row.name === column)) {
      await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }
}

async function bootstrapPhysicalInventoryIfEmpty(db: DatabaseClient) {
  const existing = await db.execute("SELECT COUNT(*) AS count FROM physical_inventory_items");
  if (Number(existing.rows[0]?.count ?? 0) > 0) return;

  const now = new Date().toISOString();
  const statements = physicalInventorySeed.items.flatMap((item) => [
    {
      sql: `INSERT INTO physical_inventory_items (
        id, title, description, shopify_product_id, quantity, quantity_known,
        packaging_type, reorder_point, source_label, active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 0, 0, ?, 0, ?, 1, ?, ?)`,
      args: [
        item.id,
        item.title,
        item.description,
        item.shopifyProductId,
        item.packaging,
        physicalInventorySeed.sourceLabel,
        now,
        now,
      ],
    },
    ...item.variants.map((title, index) => ({
      sql: `INSERT INTO physical_inventory_variants (
        id, physical_item_id, title, quantity, quantity_known, active, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, 0, 0, 1, ?, ?, ?)`,
      args: [`${item.id}--${index + 1}`, item.id, title, index, now, now],
    })),
  ]);

  await db.batch(statements, "write");
  await db.execute({
    sql: `INSERT INTO inventory_settings (key, value, updated_at)
      VALUES ('physical_inventory_seed_version', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    args: [physicalInventorySeed.version, now],
  });
}

async function rebuildOrderSearchIndex(db: DatabaseClient) {
  await db.execute("DELETE FROM order_search");
  await db.execute(`
    INSERT INTO order_search (rowid, order_id, order_number, customer_name, customer_email, line_items)
    SELECT o.rowid, o.id, o.order_number, COALESCE(o.customer_name, ''), COALESCE(o.customer_email, ''),
      COALESCE((SELECT group_concat(COALESCE(oi.title, '') || ' ' || COALESCE(oi.sku, ''), ' ')
                FROM order_items oi WHERE oi.order_id = o.id), '')
    FROM orders o
  `);
}

async function rebuildOrderSearchIndexOnce(db: DatabaseClient) {
  const marker = await db.execute({
    sql: "SELECT version FROM schema_migrations WHERE version = ?",
    args: [orderSearchRebuildVersion],
  });
  if (marker.rows[0]) return false;

  const [ordersPresence, searchPresence] = await Promise.all([
    db.execute("SELECT 1 FROM orders LIMIT 1"),
    db.execute("SELECT 1 FROM order_search LIMIT 1"),
  ]);
  if (ordersPresence.rows.length > 0 && searchPresence.rows.length === 0) {
    await rebuildOrderSearchIndex(db);
  }
  await db.execute({
    sql: "INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)",
    args: [orderSearchRebuildVersion],
  });
  return true;
}

async function applyDatabaseMigrations(db: DatabaseClient) {
  // Existing databases need additive columns before executing schema statements
  // that create indexes or triggers referring to those columns. New databases
  // have no tables yet, so ensureColumns safely skips them until after schema.
  await ensureColumns(db);
  await db.executeMultiple(schemaSql());
  await ensureColumns(db);
  await bootstrapPhysicalInventoryIfEmpty(db);
  await rebuildOrderSearchIndexOnce(db);
  await db.execute({
    sql: "INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)",
    args: [migrationVersion],
  });
  return db;
}

/**
 * Uses a local libSQL database during development, then switches to Turso when
 * both Turso variables are provided. The repository layer stays identical.
 */
export async function getTursoClient(): Promise<DatabaseClient> {
  assertTursoConfiguration();

  if (!client) client = createDatabaseClient();

  if (!schemaReady) {
    schemaReady = shouldAutoInitializeSchema()
      ? applyDatabaseMigrations(client)
      : Promise.resolve(client);
  }

  return schemaReady;
}

/**
 * Returns the business-data client used by the remote assistant. This client
 * never runs migrations, seeders, or schema bootstrap code. Production must
 * point it at a provider-enforced read-only replica/credential.
 */
export async function getMcpReadClient(): Promise<DatabaseClient> {
  assertMcpReadDatabaseConfiguration();

  if (mcpReadClient) return mcpReadClient;

  const url = process.env.MCP_READ_DATABASE_URL?.trim();
  if (!url) {
    if (process.env.NODE_ENV !== "production" && process.env.MCP_ALLOW_PRIMARY_READ_FALLBACK === "true") {
      return getTursoClient();
    }
    throw new Error("MCP_READ_DATABASE_URL is not configured.");
  }

  mcpReadClient = url.startsWith("file:")
    ? createClient({ url })
    : createClient({ url, authToken: process.env.MCP_READ_DATABASE_AUTH_TOKEN!.trim() });
  return mcpReadClient;
}

/** Applies the complete, idempotent schema migration. Intended for deployments, never request paths. */
export async function migrateTursoSchema() {
  assertTursoConfiguration();
  const db = client ?? createDatabaseClient();
  try {
    return await applyDatabaseMigrations(db);
  } finally {
    if (db !== client) db.close();
  }
}
