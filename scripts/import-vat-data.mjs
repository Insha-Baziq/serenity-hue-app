// Imports a VAT Automation export (see scripts/vat-postgres-export.sql) into Turso.
//
//   npm run vat:import -- --file tmp/vat-export.json --database file:./tmp/vat-import-check.db
//   npm run vat:import -- --file tmp/vat-export.json --production
//
// --database targets a local SQLite file (the schema is applied first). Without
// it, the configured TURSO_DATABASE_URL is used and --production is required,
// so production is never written by accident. Run `npm run db:migrate` (or a
// deployment) first so the vat_ tables exist there.

import { createClient } from "@libsql/client";
import { readFile } from "node:fs/promises";
import nextEnv from "@next/env";
import { importVatExport } from "./vat-import.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

const file = argument("--file");
if (!file) throw new Error("Pass --file <export.json>.");
const localDatabase = argument("--database");
if (localDatabase && !localDatabase.startsWith("file:")) throw new Error("--database only accepts a local file: URL.");

let client;
if (localDatabase) {
  client = createClient({ url: localDatabase });
  await client.executeMultiple(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"));
} else {
  if (!process.argv.includes("--production")) throw new Error("Writing to the configured Turso database requires --production.");
  nextEnv.loadEnvConfig(process.cwd(), true);
  const url = process.env.TURSO_DATABASE_URL?.trim();
  const authToken = process.env.TURSO_AUTH_TOKEN?.trim();
  if (!url || !authToken) throw new Error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required.");
  client = createClient({ url, authToken });
  const tables = await client.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'vat_invoices'");
  if (!tables.rows.length) throw new Error("The vat_ tables do not exist yet. Run npm run db:migrate first.");
}

try {
  const data = JSON.parse((await readFile(file, "utf8")).replace(/^﻿/, ""));
  const summary = await importVatExport(client, data);
  console.log(JSON.stringify(summary, null, 2));
} finally {
  client.close();
}
