import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@libsql/client";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("schema keeps TikTok Ads OAuth and connection state separate from TikTok Shop", async () => {
  const directory = await mkdtemp(join(tmpdir(), "serenity-hue-ads-schema-"));
  const databasePath = join(directory, "schema-test.db");
  const db = createClient({ url: pathToFileURL(databasePath).href });
  try {
    await db.executeMultiple(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"));
    await db.execute({
      sql: "INSERT INTO tiktok_ads_oauth_states (id, state_hash, expires_at) VALUES (?, ?, ?)",
      args: ["ads-state-1", "hash-1", "2026-09-10T12:00:00.000Z"],
    });
    await db.execute({
      sql: `INSERT INTO tiktok_ads_connections
        (id, advertiser_id, access_token, refresh_token, authorized_advertiser_ids, granted_scopes)
        VALUES (?, ?, ?, ?, ?, ?)`,
      args: ["ads-connection-1", "advertiser-1", "encrypted-access", "encrypted-refresh", '["advertiser-1"]', '["report.advertiser.basic"]'],
    });

    const tables = await db.execute(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name IN ('tiktok_connections', 'tiktok_ads_connections', 'tiktok_oauth_states', 'tiktok_ads_oauth_states', 'tiktok_ads_report_rows', 'tiktok_ads_sync_status')
      ORDER BY name`);
    assert.deepEqual(tables.rows.map((row) => row.name), [
      "tiktok_ads_connections",
      "tiktok_ads_oauth_states",
      "tiktok_ads_report_rows",
      "tiktok_ads_sync_status",
      "tiktok_connections",
      "tiktok_oauth_states",
    ]);
    const state = await db.execute("SELECT state_hash FROM tiktok_ads_oauth_states");
    const connection = await db.execute("SELECT advertiser_id, authorized_advertiser_ids FROM tiktok_ads_connections");
    assert.deepEqual(state.rows, [{ state_hash: "hash-1" }]);
    assert.deepEqual(connection.rows, [{ advertiser_id: "advertiser-1", authorized_advertiser_ids: '["advertiser-1"]' }]);

    await db.execute({
      sql: `INSERT INTO tiktok_ads_report_rows
        (id, advertiser_id, report_date, report_type, service_type, data_level, dimension_key,
         provider_currency, spend_minor, attributed_revenue_minor, source_dimensions_json,
         source_metrics_json, fetched_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(advertiser_id, report_type, service_type, data_level, dimension_key)
        DO UPDATE SET spend_minor = excluded.spend_minor, attributed_revenue_minor = excluded.attributed_revenue_minor, updated_at = excluded.updated_at`,
      args: ["row-1", "advertiser-1", "2026-09-10", "BASIC", "AUCTION", "AUCTION_ADVERTISER", "advertiser_id=advertiser-1|stat_time_day=2026-09-10", "GBP", 100, 200, "{}", "{}", "2026-09-10T12:00:00.000Z"],
    });
    await db.execute({
      sql: `INSERT INTO tiktok_ads_report_rows
        (id, advertiser_id, report_date, report_type, service_type, data_level, dimension_key,
         provider_currency, spend_minor, attributed_revenue_minor, source_dimensions_json,
         source_metrics_json, fetched_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(advertiser_id, report_type, service_type, data_level, dimension_key)
        DO UPDATE SET spend_minor = excluded.spend_minor, attributed_revenue_minor = excluded.attributed_revenue_minor, updated_at = excluded.updated_at`,
      args: ["row-1-corrected", "advertiser-1", "2026-09-10", "BASIC", "AUCTION", "AUCTION_ADVERTISER", "advertiser_id=advertiser-1|stat_time_day=2026-09-10", "GBP", 125, 250, "{}", "{}", "2026-09-10T13:00:00.000Z"],
    });
    const report = await db.execute("SELECT id, spend_minor, attributed_revenue_minor FROM tiktok_ads_report_rows");
    assert.deepEqual(report.rows, [{ id: "row-1", spend_minor: 125, attributed_revenue_minor: 250 }]);
  } finally {
    db.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }).catch(() => undefined);
  }
});
