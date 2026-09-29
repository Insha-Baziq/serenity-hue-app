import "server-only";

import { randomUUID } from "node:crypto";
import {
  activeTikTokAdsConnection,
  adsReportingConfigured,
  deleteTikTokAdsReportRowsBefore,
  getTikTokAdsSyncStatus,
  recordTikTokAdsSyncAttempt,
  recordTikTokAdsSyncFailure,
  recordTikTokAdsSyncSuccess,
  releaseTikTokAdsReportLease,
  saveTikTokAdsReportRows,
  takeTikTokAdsReportLease,
  updateTikTokAdsConnectionTokens,
} from "@/lib/tiktok-ads-report-store";
import {
  fetchTikTokAdsReport,
  normalizeTikTokAdsReportRows,
  tiktokAdsHistoryStartDate,
  tiktokAdsReportingWindow,
  type TikTokAdsDataLevel,
} from "@/lib/tiktok-ads-reporting";
import {
  refreshTikTokAdsAccessToken,
  tiktokAdsAdvertiserId,
} from "@/lib/tiktok-ads";
import { recordActivityEvent } from "@/lib/repository";
import type { ActivityActor } from "@/lib/types";

export type TikTokAdsRefreshResult = {
  ok: boolean;
  status: "succeeded" | "failed" | "skipped";
  reportStatus?: "fresh" | "partial";
  fetchMode?: "baseline" | "rolling";
  rowsFetched?: number;
  rowsWritten?: number;
  rowsSkipped?: number;
  startDate?: string;
  endDate?: string;
  completedAt?: string;
  message: string;
};

const SAFE_FAILURE_MESSAGE = "TikTok Ads reporting refresh failed; the last successful report was retained.";
const SYSTEM_ADS_ACTOR: ActivityActor = { type: "system", id: "sync-scheduler", label: "Sync scheduler" };

async function recordAdsActivity(input: {
  id: string;
  trigger: "manual" | "scheduled";
  actor: ActivityActor;
  outcome: "succeeded" | "failed" | "skipped";
  summary: string;
  recordsInspected?: number;
  recordsChanged?: number;
  details?: Record<string, string | number | boolean | null>;
}) {
  try {
    await recordActivityEvent({
      actor: input.actor,
      source: input.trigger,
      provider: "tiktok-ads",
      eventName: "sync.tiktok-ads",
      entityType: "sync",
      entityId: input.id,
      summary: input.summary,
      details: {
        trigger: input.trigger,
        recordsInspected: input.recordsInspected ?? 0,
        recordsChanged: input.recordsChanged ?? 0,
        ...input.details,
      },
      outcome: input.outcome,
      dedupeKey: `${input.id}:sync.tiktok-ads`,
    });
  } catch {
    // Keep the provider result authoritative if activity visibility is unavailable.
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : "Unknown TikTok Ads refresh failure";
}

function expiresSoon(value: string | undefined) {
  const expiry = value ? Date.parse(value) : NaN;
  return Number.isFinite(expiry) && expiry <= Date.now() + 5 * 60 * 1000;
}

function skipped(message: string): TikTokAdsRefreshResult {
  return { ok: true, status: "skipped", message };
}

export async function refreshTikTokAdsReporting(trigger: "manual" | "scheduled", actor: ActivityActor = SYSTEM_ADS_ACTOR): Promise<TikTokAdsRefreshResult> {
  if (!adsReportingConfigured()) {
    const result = skipped("TikTok Ads reporting is not configured.");
    await recordAdsActivity({ id: `tiktok-ads:${trigger}:${randomUUID()}`, trigger, actor, outcome: "skipped", summary: "Skipped TikTok Ads refresh because the provider is not configured", details: { reason: "not_configured" } });
    return result;
  }

  const advertiserId = tiktokAdsAdvertiserId();
  const ownerId = `tiktok-ads-report:${trigger}:${randomUUID()}`;
  const canRun = await takeTikTokAdsReportLease(ownerId);
  if (!canRun) {
    const result = skipped("TikTok Ads reporting is already refreshing.");
    await recordAdsActivity({ id: ownerId, trigger, actor, outcome: "skipped", summary: "Skipped TikTok Ads refresh because another refresh is already running", details: { reason: "busy" } });
    return result;
  }

  try {
    const connection = await activeTikTokAdsConnection(advertiserId);
    if (!connection) {
      const result = skipped("TikTok Ads is not connected to the configured advertiser.");
      await recordAdsActivity({ id: ownerId, trigger, actor, outcome: "skipped", summary: "Skipped TikTok Ads refresh because the provider is not connected", details: { reason: "not_connected" } });
      return result;
    }

    const previous = await getTikTokAdsSyncStatus(advertiserId);
    const historyStartDate = tiktokAdsHistoryStartDate();
    const initialBaseline = !previous?.lastSuccessfulAt
      || !previous.lastReportStartDate
      || previous.lastReportStartDate > historyStartDate
      || (previous.lastStatus === "partial" && previous.lastRowsWritten === 0 && previous.lastReportStartDate === historyStartDate);
    const window = tiktokAdsReportingWindow(new Date(), initialBaseline ? "baseline" : "rolling");
    await recordTikTokAdsSyncAttempt({ advertiserId, initialBaseline, startDate: window.startDate, endDate: window.endDate });

    let accessToken = connection.accessToken;
    if (expiresSoon(connection.accessTokenExpiresAt) && connection.refreshToken) {
      const refreshed = await refreshTikTokAdsAccessToken(connection.refreshToken);
      accessToken = refreshed.accessToken;
      await updateTikTokAdsConnectionTokens({
        id: connection.id,
        ...refreshed,
        refreshToken: refreshed.refreshToken ?? connection.refreshToken,
        accessTokenExpiresAt: refreshed.accessTokenExpiresAt ?? connection.accessTokenExpiresAt,
        refreshTokenExpiresAt: refreshed.refreshTokenExpiresAt ?? connection.refreshTokenExpiresAt,
        advertiserIds: refreshed.advertiserIds.length ? refreshed.advertiserIds : connection.authorizedAdvertiserIds,
        grantedScopes: refreshed.grantedScopes.length ? refreshed.grantedScopes : connection.grantedScopes,
      });
    }

    const fetchedAt = new Date().toISOString();
    const reportLevels: TikTokAdsDataLevel[] = [
      "AUCTION_ADVERTISER",
      "AUCTION_CAMPAIGN",
      "AUCTION_ADGROUP",
      "AUCTION_AD",
    ];
    let rowsFetched = 0;
    let rowsWritten = 0;
    let rowsSkipped = 0;
    let failedBreakdownReports = 0;
    for (const dataLevel of reportLevels) {
      try {
        const providerRows = await fetchTikTokAdsReport({ accessToken, advertiserId, startDate: window.startDate, endDate: window.endDate, dataLevel });
        const normalized = normalizeTikTokAdsReportRows({ advertiserId, fetchedAt, rows: providerRows, dataLevel });
        rowsFetched += providerRows.length;
        rowsSkipped += normalized.skippedRows;
        rowsWritten += await saveTikTokAdsReportRows(normalized.records);
      } catch (error) {
        console.warn("[tiktok-ads-breakdown-failed]", {
          advertiserId,
          dataLevel,
          message: errorMessage(error),
        });
        if (dataLevel === "AUCTION_ADVERTISER") throw new Error(`TikTok Ads advertiser report failed: ${errorMessage(error)}`);
        failedBreakdownReports += 1;
      }
    }
    await deleteTikTokAdsReportRowsBefore({ advertiserId, beforeDate: window.retainedBeforeDate });
    await recordTikTokAdsSyncSuccess({
      advertiserId,
      initialBaseline,
      startDate: window.startDate,
      endDate: window.endDate,
      rowsWritten,
      rowsSkipped: rowsSkipped + failedBreakdownReports,
    });

    const result: TikTokAdsRefreshResult = {
      ok: true,
      status: "succeeded",
      reportStatus: rowsSkipped > 0 || failedBreakdownReports > 0 ? "partial" : "fresh",
      fetchMode: window.kind,
      rowsFetched,
      rowsWritten,
      rowsSkipped: rowsSkipped + failedBreakdownReports,
      startDate: window.startDate,
      endDate: window.endDate,
      completedAt: new Date().toISOString(),
      message: rowsSkipped > 0 || failedBreakdownReports > 0
        ? "TikTok Ads report refreshed with some provider rows or breakdowns unavailable."
        : "TikTok Ads report refreshed.",
    };
    await recordAdsActivity({
      id: ownerId,
      trigger,
      actor,
      outcome: "succeeded",
      summary: result.message,
      recordsInspected: rowsFetched,
      recordsChanged: rowsWritten,
      details: { rowsFetched, rowsWritten, rowsSkipped: rowsSkipped + failedBreakdownReports, reportStatus: result.reportStatus ?? null, fetchMode: result.fetchMode ?? null },
    });
    return result;
  } catch (error) {
    console.error("[tiktok-ads-refresh-failed]", {
      advertiserId,
      message: errorMessage(error),
    });
    try {
      await recordTikTokAdsSyncFailure({ advertiserId, message: SAFE_FAILURE_MESSAGE });
    } catch {
      // Preserve the original safe result if the status write itself fails.
    }
    await recordAdsActivity({ id: ownerId, trigger, actor, outcome: "failed", summary: SAFE_FAILURE_MESSAGE, details: { reason: "provider_error" } });
    return { ok: false, status: "failed", message: SAFE_FAILURE_MESSAGE };
  } finally {
    await releaseTikTokAdsReportLease(ownerId);
  }
}
