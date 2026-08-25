import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { createClient } from "@libsql/client";

test("schema creates and maintains the full-text order index", async () => {
  const directory = await mkdtemp(join(tmpdir(), "serenity-hue-schema-"));
  const databasePath = join(directory, "schema-test.db");
  const db = createClient({ url: pathToFileURL(databasePath).href });
  try {
    await db.executeMultiple(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"));
    await db.execute({
      sql: "INSERT INTO orders (id, source, source_order_id, order_number, source_created_at) VALUES (?, 'shopify', ?, ?, ?)",
      args: ["order-1", "source-1", "#1001", "2026-08-24T00:00:00.000Z"],
    });
    await db.execute({
      sql: "INSERT INTO order_items (id, order_id, source_line_item_id, title, sku, quantity) VALUES (?, ?, ?, ?, ?, ?)",
      args: ["line-1", "order-1", "line-source-1", "Snow Lift Serum", "SNOW-001", 1],
    });
    const indexed = await db.execute("SELECT order_id FROM order_search WHERE order_search MATCH 'snow*'");
    assert.deepEqual(indexed.rows.map((row) => row.order_id), ["order-1"]);

    await db.execute({ sql: "UPDATE orders SET customer_name = ? WHERE id = ?", args: ["Shabina Khan", "order-1"] });
    const updated = await db.execute("SELECT order_id FROM order_search WHERE order_search MATCH 'shabina*'");
    assert.deepEqual(updated.rows.map((row) => row.order_id), ["order-1"]);
  } finally {
    db.close();
    // libSQL's Windows handle may be released just after close returns. A
    // best-effort cleanup keeps that platform detail from masking assertions.
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }).catch(() => undefined);
  }
});
