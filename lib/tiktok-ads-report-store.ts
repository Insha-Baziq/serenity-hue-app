import "server-only";

import { getActiveTikTokAdsConnection, getTikTokAdsConnectionState } from "@/lib/repository";
import { hasTikTokAdsAppCredentials } from "@/lib/tiktok-ads";
import { encryptTikTokToken } from "@/lib/tiktok-token-crypto";
import type { TikTokAdsReportRecord } from "@/lib/tiktok-ads-reporting";
import { getTursoClient } from "@/lib/turso";

type SqlValue = string | number | null;

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown) {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function optionalString(value: unknown) {
  const text = stringValue(value);
  return text || undefined;
}

export async function updateTikTokAdsConnectionTokens(input: {
  id: string;
  accessToken: string;
  refreshToken?: string;
  accessTokenExpiresAt?: string;
  refreshTokenExpiresAt?: string;
  advertiserIds: string[];
  grantedScopes: string[];
}) {
  const db = await getTursoClient();
  await db.execute({
    sql: `UPDATE tiktok_ads_connections
          SET access_token = ?, refresh_token = ?, access_token_expires_at = ?, refresh_token_expires_at = ?,
              authorized_advertiser_ids = ?, granted_scopes = ?, status = 'active', updated_at = ?
          WHERE id = ?`,
    args: [
      encryptTikTokToken(input.accessToken),
      input.refreshToken ? encryptTikTokToken(input.refreshToken) : null,
      input.accessTokenExpiresAt ?? null,
      input.refreshTokenExpiresAt ?? null,
      JSON.stringify(input.advertiserIds),
      JSON.stringify(input.grantedScopes),
      new Date().toISOString(),
      input.id,
    ] as SqlValue[],
  });
}

export type TikTokAdsSyncStatus = {
  advertiserId: string;
  lastSuccessfulAt?: string;
  lastAttemptedAt?: string;
  lastErrorAt?: string;
  lastErrorMessage?: string;
  lastStatus: "first_run" | "fresh" | "partial" | "failed";
  initialBaselineStartedAt?: string;
  initialBaselineCompletedAt?: string;
  lastReportStartDate?: string;
  lastReportEndDate?: string;
  lastRowsWritten: number;
  lastRowsSkipped: number;
};

export async function getTikTokAdsSyncStatus(advertiserId: string): Promise<TikTokAdsSyncStatus | null> {
  const db = await getTursoClient();
  const result = await db.execute({
    sql: `SELECT advertiser_id, last_successful_at, last_attempted_at, last_error_at, last_error_message,
                 last_status, initial_baseline_started_at, initial_baseline_completed_at,
                 last_report_start_date, last_report_end_date, last_rows_written, last_rows_skipped
          FROM tiktok_ads_sync_status WHERE advertiser_id = ? LIMIT 1`,
    args: [advertiserId],
  });
  const row = result.rows[0];
  if (!row) return null;
  const status = stringValue(row.last_status);
  return {
    advertiserId: stringValue(row.advertiser_id),
    lastSuccessfulAt: optionalString(row.last_successful_at),
    lastAttemptedAt: optionalString(row.last_attempted_at),
    lastErrorAt: optionalString(row.last_error_at),
    lastErrorMessage: optionalString(row.last_error_message),
    lastStatus: status === "fresh" || status === "partial" || status === "failed" ? status : "first_run",
    initialBaselineStartedAt: optionalString(row.initial_baseline_started_at),
    initialBaselineCompletedAt: optionalString(row.initial_baseline_completed_at),
    lastReportStartDate: optionalString(row.last_report_start_date),
    lastReportEndDate: optionalString(row.last_report_end_date),
    lastRowsWritten: numberValue(row.last_rows_written),
    lastRowsSkipped: numberValue(row.last_rows_skipped),
  };
}

export type TikTokAdsReportState = {
  status: "not_configured" | "not_connected" | "reconnect_required" | "first_run" | "fresh" | "partial" | "stale";
  advertiserId?: string;
  lastSuccessfulAt?: string;
  lastAttemptedAt?: string;
  lastErrorMessage?: string;
  lastReportStartDate?: string;
  lastReportEndDate?: string;
  lastRowsWritten?: number;
  lastRowsSkipped?: number;
};

export async function getTikTokAdsReportState(): Promise<TikTokAdsReportState> {
  const connection = await getTikTokAdsConnectionState();
  if (connection.status === "not_configured" || connection.status === "not_connected" || connection.status === "reconnect_required") {
    return { status: connection.status, advertiserId: connection.advertiserId };
  }
  const advertiserId = connection.advertiserId ?? process.env.TIKTOK_ADS_ADVERTISER_ID?.trim() ?? "";
  const sync = await getTikTokAdsSyncStatus(advertiserId);
  if (!sync?.lastSuccessfulAt) {
    return { status: "first_run", advertiserId, lastAttemptedAt: sync?.lastAttemptedAt, lastErrorMessage: sync?.lastErrorMessage };
  }
  const lastSuccess = Date.parse(sync.lastSuccessfulAt);
  const lastError = sync.lastErrorAt ? Date.parse(sync.lastErrorAt) : NaN;
  const stale = !Number.isFinite(lastSuccess)
    || lastSuccess < Date.now() - 3 * 60 * 60 * 1000
    || (Number.isFinite(lastError) && lastError > lastSuccess)
    || sync.lastStatus === "failed";
  return {
    status: stale ? "stale" : sync.lastStatus === "partial" ? "partial" : "fresh",
    advertiserId,
    lastSuccessfulAt: sync.lastSuccessfulAt,
    lastAttemptedAt: sync.lastAttemptedAt,
    lastErrorMessage: sync.lastErrorMessage,
    lastReportStartDate: sync.lastReportStartDate,
    lastReportEndDate: sync.lastReportEndDate,
    lastRowsWritten: sync.lastRowsWritten,
    lastRowsSkipped: sync.lastRowsSkipped,
  };
}

export async function recordTikTokAdsSyncAttempt(input: { advertiserId: string; initialBaseline: boolean; startDate: string; endDate: string }) {
  const db = await getTursoClient();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO tiktok_ads_sync_status
      (advertiser_id, last_attempted_at, last_status, initial_baseline_started_at,
       last_report_start_date, last_report_end_date, updated_at)
      VALUES (?, ?, 'first_run', ?, ?, ?, ?)
      ON CONFLICT(advertiser_id) DO UPDATE SET
        last_attempted_at = excluded.last_attempted_at,
        last_status = CASE WHEN tiktok_ads_sync_status.last_successful_at IS NULL THEN 'first_run' ELSE tiktok_ads_sync_status.last_status END,
        initial_baseline_started_at = COALESCE(tiktok_ads_sync_status.initial_baseline_started_at, excluded.initial_baseline_started_at),
        last_report_start_date = excluded.last_report_start_date,
        last_report_end_date = excluded.last_report_end_date,
        updated_at = excluded.updated_at`,
    args: [input.advertiserId, now, input.initialBaseline ? now : null, input.startDate, input.endDate, now],
  });
}

export async function recordTikTokAdsSyncSuccess(input: {
  advertiserId: string;
  initialBaseline: boolean;
  startDate: string;
  endDate: string;
  rowsWritten: number;
  rowsSkipped: number;
}) {
  const db = await getTursoClient();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO tiktok_ads_sync_status
      (advertiser_id, last_successful_at, last_attempted_at, last_status, initial_baseline_started_at,
       initial_baseline_completed_at, last_report_start_date, last_report_end_date,
       last_rows_written, last_rows_skipped, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(advertiser_id) DO UPDATE SET
        last_successful_at = excluded.last_successful_at,
        last_attempted_at = excluded.last_attempted_at,
        last_error_at = NULL,
        last_error_message = NULL,
        last_status = excluded.last_status,
        initial_baseline_started_at = COALESCE(tiktok_ads_sync_status.initial_baseline_started_at, excluded.initial_baseline_started_at),
        initial_baseline_completed_at = COALESCE(tiktok_ads_sync_status.initial_baseline_completed_at, excluded.initial_baseline_completed_at),
        last_report_start_date = excluded.last_report_start_date,
        last_report_end_date = excluded.last_report_end_date,
        last_rows_written = excluded.last_rows_written,
        last_rows_skipped = excluded.last_rows_skipped,
        updated_at = excluded.updated_at`,
    args: [
      input.advertiserId,
      now,
      now,
      input.rowsSkipped > 0 ? "partial" : "fresh",
      input.initialBaseline ? now : null,
      input.initialBaseline ? now : null,
      input.startDate,
      input.endDate,
      input.rowsWritten,
      input.rowsSkipped,
      now,
    ] as SqlValue[],
  });
}

export async function recordTikTokAdsSyncFailure(input: { advertiserId: string; message: string }) {
  const db = await getTursoClient();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO tiktok_ads_sync_status
      (advertiser_id, last_attempted_at, last_error_at, last_error_message, last_status, updated_at)
      VALUES (?, ?, ?, ?, 'failed', ?)
      ON CONFLICT(advertiser_id) DO UPDATE SET
        last_attempted_at = excluded.last_attempted_at,
        last_error_at = excluded.last_error_at,
        last_error_message = excluded.last_error_message,
        last_status = 'failed',
        updated_at = excluded.updated_at`,
    args: [input.advertiserId, now, now, input.message.slice(0, 500), now],
  });
}

export async function saveTikTokAdsReportRows(records: TikTokAdsReportRecord[]) {
  if (records.length === 0) return 0;
  const db = await getTursoClient();
  const now = new Date().toISOString();
  await db.batch(records.map((record) => ({
    sql: `INSERT INTO tiktok_ads_report_rows
      (id, advertiser_id, report_date, report_type, service_type, data_level, dimension_key,
       provider_currency, spend_minor, attributed_revenue_minor, attributed_purchases, impressions, clicks,
       source_dimensions_json, source_metrics_json, attribution_window, fetched_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(advertiser_id, report_type, service_type, data_level, dimension_key) DO UPDATE SET
        id = excluded.id,
        report_date = excluded.report_date,
        provider_currency = excluded.provider_currency,
        spend_minor = excluded.spend_minor,
        attributed_revenue_minor = excluded.attributed_revenue_minor,
        attributed_purchases = excluded.attributed_purchases,
        impressions = excluded.impressions,
        clicks = excluded.clicks,
        source_dimensions_json = excluded.source_dimensions_json,
        source_metrics_json = excluded.source_metrics_json,
        attribution_window = excluded.attribution_window,
        fetched_at = excluded.fetched_at,
        updated_at = excluded.updated_at`,
    args: [
      record.id,
      record.advertiserId,
      record.reportDate,
      record.reportType,
      record.serviceType,
      record.dataLevel,
      record.dimensionKey,
      record.providerCurrency,
      record.spendMinor,
      record.attributedRevenueMinor,
      record.attributedPurchases,
      record.impressions,
      record.clicks,
      JSON.stringify(record.sourceDimensions),
      JSON.stringify(record.sourceMetrics),
      record.attributionWindow,
      record.fetchedAt,
      now,
      now,
    ] as SqlValue[],
  })), "write");
  return records.length;
}

export async function deleteTikTokAdsReportRowsBefore(input: { advertiserId: string; beforeDate: string }) {
  const db = await getTursoClient();
  const result = await db.execute({
    sql: "DELETE FROM tiktok_ads_report_rows WHERE advertiser_id = ? AND report_date < ?",
    args: [input.advertiserId, input.beforeDate],
  });
  return result.rowsAffected;
}

export async function takeTikTokAdsReportLease(ownerId: string, durationSeconds = 240) {
  const db = await getTursoClient();
  const lockedUntil = new Date(Date.now() + durationSeconds * 1000).toISOString();
  const now = new Date().toISOString();
  const result = await db.execute({
    sql: `INSERT INTO sync_leases (name, locked_until, owner_id) VALUES ('tiktok-ads-report-sync', ?, ?)
          ON CONFLICT(name) DO UPDATE SET locked_until = excluded.locked_until, owner_id = excluded.owner_id
          WHERE sync_leases.locked_until < ?
          RETURNING owner_id`,
    args: [lockedUntil, ownerId, now],
  });
  return result.rows.length > 0;
}

export async function releaseTikTokAdsReportLease(ownerId: string) {
  const db = await getTursoClient();
  await db.execute({ sql: "DELETE FROM sync_leases WHERE name = 'tiktok-ads-report-sync' AND owner_id = ?", args: [ownerId] });
}

export async function activeTikTokAdsConnection(advertiserId: string) {
  const connection = await getActiveTikTokAdsConnection();
  return connection?.advertiserId === advertiserId ? connection : null;
}

export function adsReportingConfigured() {
  return hasTikTokAdsAppCredentials() && Boolean(process.env.TIKTOK_ADS_ADVERTISER_ID?.trim());
}
