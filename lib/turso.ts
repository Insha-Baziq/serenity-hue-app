import { createClient } from "@libsql/client";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

type DatabaseClient = ReturnType<typeof createClient>;

let client: DatabaseClient | undefined;
let schemaReady: Promise<DatabaseClient> | undefined;

const columnMigrations = [
  ["variants", "packaging_type", "TEXT"],
  ["variants", "units_per_box", "INTEGER NOT NULL DEFAULT 1"],
  ["channel_mappings", "multiplier", "INTEGER NOT NULL DEFAULT 1"],
  ["channel_mappings", "confidence", "TEXT"],
  ["channel_mappings", "notes", "TEXT"],
  ["channel_mappings", "active", "INTEGER NOT NULL DEFAULT 1"],
  ["packaging_materials", "lead_time_days", "INTEGER"],
  ["shipments", "match_method", "TEXT CHECK (match_method IN ('order_reference', 'customer_email', 'customer_phone', 'delivery_address'))"],
] as const;

export function hasTursoConfiguration() {
  return Boolean(process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN);
}

export function databaseMode() {
  return hasTursoConfiguration() ? "turso" : "local";
}

/**
 * Uses a local libSQL database during development, then switches to Turso when
 * both Turso variables are provided. The repository layer stays identical.
 */
export async function getTursoClient(): Promise<DatabaseClient> {
  if (!client) {
    if (hasTursoConfiguration()) {
      client = createClient({
        url: process.env.TURSO_DATABASE_URL!,
        authToken: process.env.TURSO_AUTH_TOKEN!,
      });
    } else {
      mkdirSync(join(process.cwd(), "data"), { recursive: true });
      client = createClient({ url: "file:./data/serenity-hue.db" });
    }
  }

  if (!schemaReady) {
    const schema = readFileSync(join(process.cwd(), "database", "schema.sql"), "utf8");
    schemaReady = client.executeMultiple(schema).then(async () => {
      for (const [table, column, definition] of columnMigrations) {
        const existing = await client!.execute(`PRAGMA table_info(${table})`);
        const hasColumn = existing.rows.some((row) => row.name === column);
        if (!hasColumn) await client!.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      }
      return client!;
    });
  }

  return schemaReady;
}
