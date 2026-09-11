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

test("schema keeps TikTok affiliate attribution and sync freshness separate from ordinary orders", async () => {
  const directory = await mkdtemp(join(tmpdir(), "serenity-hue-affiliate-schema-"));
  const databasePath = join(directory, "schema-test.db");
  const db = createClient({ url: pathToFileURL(databasePath).href });
  try {
    await db.executeMultiple(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"));
    await db.execute({
      sql: `INSERT INTO tiktok_connections (id, access_token, refresh_token) VALUES (?, ?, ?)`,
      args: ["connection-1", "encrypted-token", "encrypted-refresh"],
    });
    await db.execute({
      sql: `INSERT INTO tiktok_affiliate_orders
        (id, connection_id, shop_id, source_order_id, source_line_item_id, quantity, gross_amount_minor, estimated_commission_minor, currency)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(shop_id, source_order_id, source_line_item_id) DO UPDATE SET gross_amount_minor=excluded.gross_amount_minor`,
      args: ["affiliate-1", "connection-1", "shop-1", "order-1", "line-1", 1, 1995, 250, "GBP"],
    });
    await db.execute({
      sql: `INSERT INTO tiktok_affiliate_orders
        (id, connection_id, shop_id, source_order_id, source_line_item_id, quantity, gross_amount_minor, estimated_commission_minor, currency)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(shop_id, source_order_id, source_line_item_id) DO UPDATE SET gross_amount_minor=excluded.gross_amount_minor`,
      args: ["affiliate-1-retry", "connection-1", "shop-1", "order-1", "line-1", 1, 2095, 250, "GBP"],
    });
    await db.execute({
      sql: `INSERT INTO tiktok_affiliate_sync_status (connection_id, shop_id, cursor_at, last_successful_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      args: ["connection-1", "shop-1", "2026-09-05T00:00:00.000Z", "2026-09-05T00:00:00.000Z", "2026-09-05T00:00:00.000Z"],
    });
    await db.execute({
      sql: `UPDATE tiktok_affiliate_sync_status SET last_error_at=?, last_error_message=? WHERE connection_id=? AND shop_id=?`,
      args: ["2026-09-05T00:05:00.000Z", "Provider unavailable", "connection-1", "shop-1"],
    });
    const snapshot = await db.execute("SELECT gross_amount_minor, estimated_commission_minor FROM tiktok_affiliate_orders");
    const status = await db.execute("SELECT cursor_at, last_successful_at, last_error_message FROM tiktok_affiliate_sync_status");
    assert.deepEqual(snapshot.rows, [{ gross_amount_minor: 2095, estimated_commission_minor: 250 }]);
    assert.deepEqual(status.rows, [{ cursor_at: "2026-09-05T00:00:00.000Z", last_successful_at: "2026-09-05T00:00:00.000Z", last_error_message: "Provider unavailable" }]);
  } finally {
    db.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }).catch(() => undefined);
  }
});

test("TikTok affiliate product IDs resolve to cached channel listing titles", async () => {
  const directory = await mkdtemp(join(tmpdir(), "serenity-hue-affiliate-product-title-"));
  const databasePath = join(directory, "schema-test.db");
  const db = createClient({ url: pathToFileURL(databasePath).href });
  try {
    await db.executeMultiple(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"));
    await db.execute({
      sql: `INSERT INTO physical_channel_listings
        (id, channel, external_product_id, title, listing_kind, active, created_at, updated_at)
        VALUES (?, 'tiktok', ?, ?, 'individual', 1, ?, ?)`,
      args: ["listing-1", "product-1", "SnowLift Eye Serum", "2026-09-05T00:00:00.000Z", "2026-09-05T00:00:00.000Z"],
    });
    await db.execute({
      sql: `INSERT INTO tiktok_connections (id, access_token, refresh_token) VALUES (?, ?, ?)`,
      args: ["connection-1", "encrypted-token", "encrypted-refresh"],
    });
    await db.execute({
      sql: `INSERT INTO tiktok_affiliate_orders
        (id, connection_id, shop_id, source_order_id, source_line_item_id, source_product_id, quantity, gross_amount_minor, estimated_commission_minor, currency)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ["affiliate-1", "connection-1", "shop-1", "order-1", "line-1", "product-1", 1, 1995, 250, "GBP"],
    });
    const resolved = await db.execute(`
      SELECT COALESCE(
        NULLIF(TRIM(affiliate.product_title), ''),
        (
          SELECT listing.title
          FROM physical_channel_listings listing
          WHERE listing.channel = 'tiktok'
            AND listing.external_product_id = affiliate.source_product_id
            AND listing.title IS NOT NULL
            AND TRIM(listing.title) <> ''
          ORDER BY listing.active DESC, listing.updated_at DESC, listing.id ASC
          LIMIT 1
        ),
        CASE WHEN affiliate.source_product_id IS NOT NULL AND TRIM(affiliate.source_product_id) <> ''
          THEN 'TikTok product ' || affiliate.source_product_id ELSE NULL END
      ) AS product_title
      FROM tiktok_affiliate_orders affiliate`);
    assert.deepEqual(resolved.rows, [{ product_title: "SnowLift Eye Serum" }]);
  } finally {
    db.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }).catch(() => undefined);
  }
});
