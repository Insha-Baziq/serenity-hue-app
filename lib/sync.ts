import { markWebhookEventsProcessed, pruneExpiredActivityLog, recordActivityEvent, recordSyncRun, releaseSyncLease, takeSyncLease } from "@/lib/repository";
import { reconcileInventoryOperations } from "@/lib/inventory-rules";
import { hasParcel2GoCredentials } from "@/lib/parcel2go";
import { importRecentParcel2GoShipments } from "@/lib/parcel2go-import";
import { importShopifySnapshot } from "@/lib/shopify-import";
import { hasShopifyCredentials } from "@/lib/shopify";
import { importTikTokOrders, TikTokNotConnectedError, type TikTokRedactedSample } from "@/lib/tiktok-import";
import { importTikTokAffiliateReporting } from "@/lib/tiktok-affiliate-import";
import { storeTikTokInventory } from "@/lib/tiktok-inventory";
import type { ActivityActor } from "@/lib/types";

export type SyncTrigger = "manual" | "scheduled" | "webhook";

export type SyncResult = {
  ok: boolean;
  status: "succeeded" | "failed" | "skipped";
  message: string;
  recordsSeen: number;
  recordsChanged: number;
  completedAt: string;
  tiktokSample?: TikTokRedactedSample;
};

/**
 * The single ingestion boundary for the two direct sales channels. The UI and
 * repository do not need to know which channel supplied a record, which keeps
 * the Shopify and TikTok Shop adapters independently replaceable.
 */
const SYSTEM_SYNC_ACTOR: ActivityActor = { type: "system", id: "sync-scheduler", label: "Sync scheduler" };

async function recordSyncActivity(input: {
  id: string;
  trigger: SyncTrigger;
  actor: ActivityActor;
  provider: string;
  eventName: string;
  entityType?: string;
  outcome: "succeeded" | "failed" | "skipped";
  summary: string;
  recordsInspected?: number;
  recordsChanged?: number;
  details?: Record<string, string | number | boolean | null | string[] | number[]>;
}) {
  try {
    await recordActivityEvent({
      actor: input.actor,
      source: input.trigger,
      provider: input.provider,
      eventName: input.eventName,
      entityType: input.entityType ?? "sync",
      entityId: input.id,
      summary: input.summary,
      details: {
        trigger: input.trigger,
        recordsInspected: input.recordsInspected ?? 0,
        recordsChanged: input.recordsChanged ?? 0,
        ...input.details,
      },
      outcome: input.outcome,
      dedupeKey: `${input.id}:${input.eventName}`,
    });
  } catch {
    // Activity visibility must never turn a completed provider import into a
    // second failed import. The domain import and sync_runs remain authoritative.
  }
}

export async function syncDirectChannels(trigger: SyncTrigger, actor: ActivityActor = SYSTEM_SYNC_ACTOR): Promise<SyncResult> {
  const id = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const completedAt = new Date().toISOString();
  const canRun = await takeSyncLease(id);
  if (!canRun) {
    await recordSyncActivity({ id, trigger, actor, provider: "direct", eventName: "sync.reconciliation", outcome: "skipped", summary: "Skipped reconciliation because another sync is already running" });
    return { ok: true, status: "skipped", message: "A reconciliation is already in progress", recordsSeen: 0, recordsChanged: 0, completedAt };
  }

  try {
    await recordSyncRun({ id, trigger, provider: "direct", status: "running", message: "Importing Shopify, TikTok Shop, and TikTok affiliate reporting" });

    if (!hasShopifyCredentials()) {
      const message = "Live sync needs Shopify credentials in .env.local";
      await recordSyncActivity({ id, trigger, actor, provider: "shopify", eventName: "sync.shopify", outcome: "skipped", summary: "Skipped Shopify order and product sync because the provider is not connected", details: { reason: "not_connected" } });
      await recordSyncRun({ id, trigger, provider: "direct", status: "failed", message, finished: true });
      return { ok: false, status: "failed", message, recordsSeen: 0, recordsChanged: 0, completedAt };
    }

    const imported = await importShopifySnapshot();
    await recordSyncActivity({
      id, trigger, actor, provider: "shopify", eventName: "sync.shopify", outcome: "succeeded",
      summary: `Shopify order and product sync completed: ${imported.orders} orders and ${imported.variants} variants inspected`,
      recordsInspected: imported.orders + imported.variants,
      recordsChanged: imported.variants + imported.newOrders + imported.materiallyChangedOrders,
      details: { orders: imported.orders, variants: imported.variants, newOrders: imported.newOrders, materiallyChangedOrders: imported.materiallyChangedOrders },
    });
    if (imported.newOrders > 0) await recordSyncActivity({ id, trigger, actor, provider: "shopify", eventName: "order.created", entityType: "order", outcome: "succeeded", summary: `Imported ${imported.newOrders} new Shopify order${imported.newOrders === 1 ? "" : "s"}`, details: { count: imported.newOrders } });
    if (imported.materiallyChangedOrders > 0) await recordSyncActivity({ id, trigger, actor, provider: "shopify", eventName: "order.updated", entityType: "order", outcome: "succeeded", summary: `Updated ${imported.materiallyChangedOrders} Shopify order${imported.materiallyChangedOrders === 1 ? "" : "s"}`, details: { count: imported.materiallyChangedOrders } });
    let tiktokOrders = 0;
    let tiktokInventorySkus = 0;
    let tiktokAffiliateOrders = 0;
    let tiktokSample: TikTokRedactedSample | undefined;
    let tiktokNote = " TikTok Shop is awaiting seller authorization.";
    const failures: string[] = [];
    try {
      const tiktok = await importTikTokOrders();
      tiktokOrders = tiktok.orders;
      tiktokSample = tiktok.redactedSample;
      tiktokNote = ` TikTok Shop refreshed ${tiktok.orders} orders from ${tiktok.shops} ${tiktok.shops === 1 ? "shop" : "shops"}.`;
      if (tiktok.baselineOrders > 0) tiktokNote += ` ${tiktok.baselineOrders} initial TikTok orders were kept as the inventory baseline.`;
      if (tiktok.afterSales > 0) tiktokNote += ` ${tiktok.afterSales} cancellation/return line updates were recorded.`;
      if (tiktok.afterSalesWarning) {
        failures.push("TikTok cancellation/return sync needs attention");
        tiktokNote += ` ${tiktok.afterSalesWarning}.`;
      }
      await recordSyncActivity({
        id, trigger, actor, provider: "tiktok", eventName: "sync.tiktok-shop", outcome: tiktok.afterSalesWarning ? "failed" : "succeeded",
        summary: tiktok.afterSalesWarning ? "TikTok Shop order sync completed with after-sales warnings" : `TikTok Shop order sync completed: ${tiktok.orders} orders inspected`,
        recordsInspected: tiktok.orders,
        recordsChanged: tiktok.orders,
        details: { orders: tiktok.orders, shops: tiktok.shops, afterSales: tiktok.afterSales, baselineOrders: tiktok.baselineOrders, newOrders: tiktok.newOrders, materiallyChangedOrders: tiktok.materiallyChangedOrders },
      });
      if (tiktok.newOrders > 0) await recordSyncActivity({ id, trigger, actor, provider: "tiktok", eventName: "order.created", entityType: "order", outcome: "succeeded", summary: `Imported ${tiktok.newOrders} new TikTok Shop order${tiktok.newOrders === 1 ? "" : "s"}`, details: { count: tiktok.newOrders } });
      if (tiktok.materiallyChangedOrders > 0) await recordSyncActivity({ id, trigger, actor, provider: "tiktok", eventName: "order.updated", entityType: "order", outcome: "succeeded", summary: `Updated ${tiktok.materiallyChangedOrders} TikTok Shop order${tiktok.materiallyChangedOrders === 1 ? "" : "s"}`, details: { count: tiktok.materiallyChangedOrders } });
    } catch (error) {
      const notConnected = error instanceof TikTokNotConnectedError;
      await recordSyncActivity({ id, trigger, actor, provider: "tiktok", eventName: "sync.tiktok-shop", outcome: notConnected ? "skipped" : "failed", summary: notConnected ? "Skipped TikTok Shop order sync because the provider is not connected" : "TikTok Shop order sync failed", details: { reason: notConnected ? "not_connected" : "provider_error" } });
      if (!notConnected) {
        failures.push("TikTok Shop order sync needs attention");
        tiktokNote = " TikTok Shop order sync needs attention.";
      }
    }

    let tiktokAffiliateNote = "";
    try {
      const affiliate = await importTikTokAffiliateReporting();
      tiktokAffiliateOrders = affiliate.orders;
      tiktokAffiliateNote = ` TikTok affiliate reporting refreshed ${affiliate.orders} attributed order lines and ${affiliate.videos} affiliate videos from ${affiliate.shops} ${affiliate.shops === 1 ? "shop" : "shops"}.`;
      if (affiliate.baselineOrders > 0) tiktokAffiliateNote += ` ${affiliate.baselineOrders} initial affiliate records were retained as the all-time baseline.`;
      await recordSyncActivity({
        id, trigger, actor, provider: "tiktok", eventName: "sync.tiktok-affiliate", outcome: "succeeded",
        summary: `TikTok affiliate reporting sync completed: ${affiliate.orders} order lines and ${affiliate.videos} videos inspected`,
        recordsInspected: affiliate.orders + affiliate.videos,
        recordsChanged: affiliate.orders + affiliate.videos,
        details: { orders: affiliate.orders, videos: affiliate.videos, shops: affiliate.shops, baselineOrders: affiliate.baselineOrders },
      });
    } catch (error) {
      const notConnected = error instanceof TikTokNotConnectedError;
      await recordSyncActivity({ id, trigger, actor, provider: "tiktok", eventName: "sync.tiktok-affiliate", outcome: notConnected ? "skipped" : "failed", summary: notConnected ? "Skipped TikTok affiliate reporting because the provider is not connected" : "TikTok affiliate reporting sync failed", details: { reason: notConnected ? "not_connected" : "provider_error" } });
      if (!notConnected) {
        failures.push("TikTok affiliate reporting sync needs attention");
        tiktokAffiliateNote = " TikTok affiliate reporting sync needs attention; the last successful affiliate snapshot is retained.";
      }
    }

    let tiktokInventoryNote = "";
    try {
      const inventory = await storeTikTokInventory();
      tiktokInventorySkus = inventory.skus;
      tiktokInventoryNote = ` TikTok inventory refreshed ${inventory.skus} live SKUs and removed ${inventory.removed} stale records.`;
      await recordSyncActivity({
        id, trigger, actor, provider: "tiktok", eventName: "sync.tiktok-inventory", outcome: "succeeded",
        summary: `TikTok inventory sync completed: ${inventory.skus} live SKUs inspected`,
        recordsInspected: inventory.skus,
        recordsChanged: inventory.skus + inventory.removed,
        details: { skus: inventory.skus, products: inventory.products, matched: inventory.matched, removed: inventory.removed },
      });
    } catch (error) {
      const notConnected = error instanceof TikTokNotConnectedError;
      await recordSyncActivity({ id, trigger, actor, provider: "tiktok", eventName: "sync.tiktok-inventory", outcome: notConnected ? "skipped" : "failed", summary: notConnected ? "Skipped TikTok inventory sync because the provider is not connected" : "TikTok inventory sync failed", details: { reason: notConnected ? "not_connected" : "provider_error" } });
      if (!notConnected) {
        failures.push("TikTok inventory sync needs attention");
        tiktokInventoryNote = " TikTok inventory sync needs attention.";
      }
    }

    let parcel2GoNote = "";
    let parcel2GoRecords = 0;
    if (hasParcel2GoCredentials()) {
      try {
        const parcel2Go = await importRecentParcel2GoShipments();
        parcel2GoRecords = parcel2Go.shipments;
        parcel2GoNote = ` Parcel2Go refreshed ${parcel2Go.shipments} recent deliveries and automatically linked ${parcel2Go.autoLinked}.`;
        await recordSyncActivity({
          id, trigger, actor, provider: "parcel2go", eventName: "sync.parcel2go", outcome: "succeeded",
          summary: `Parcel2Go shipment sync completed: ${parcel2Go.shipments} shipments inspected`,
          recordsInspected: parcel2Go.shipments,
          recordsChanged: parcel2Go.newShipments + parcel2Go.materiallyChangedShipments + parcel2Go.events + parcel2Go.autoLinked,
          details: { shipments: parcel2Go.shipments, newShipments: parcel2Go.newShipments, materiallyChangedShipments: parcel2Go.materiallyChangedShipments, events: parcel2Go.events, autoLinked: parcel2Go.autoLinked },
        });
        if (parcel2Go.newShipments > 0) await recordSyncActivity({ id, trigger, actor, provider: "parcel2go", eventName: "shipment.created", entityType: "shipment", outcome: "succeeded", summary: `Imported ${parcel2Go.newShipments} new Parcel2Go shipment${parcel2Go.newShipments === 1 ? "" : "s"}`, details: { count: parcel2Go.newShipments } });
        if (parcel2Go.materiallyChangedShipments > 0) await recordSyncActivity({ id, trigger, actor, provider: "parcel2go", eventName: "shipment.updated", entityType: "shipment", outcome: "succeeded", summary: `Updated ${parcel2Go.materiallyChangedShipments} Parcel2Go shipment${parcel2Go.materiallyChangedShipments === 1 ? "" : "s"}`, details: { count: parcel2Go.materiallyChangedShipments } });
      } catch {
        await recordSyncActivity({ id, trigger, actor, provider: "parcel2go", eventName: "sync.parcel2go", outcome: "failed", summary: "Parcel2Go shipment sync failed", details: { reason: "provider_error" } });
        failures.push("Parcel2Go delivery sync needs attention");
        parcel2GoNote = " Parcel2Go delivery sync needs attention.";
      }
    } else {
      await recordSyncActivity({ id, trigger, actor, provider: "parcel2go", eventName: "sync.parcel2go", outcome: "skipped", summary: "Skipped Parcel2Go shipment sync because the provider is not connected", details: { reason: "not_connected" } });
    }
    const operational = await reconcileInventoryOperations();
    const baselineNote = operational.baselineOrders > 0
      ? ` Existing orders were set as the operational baseline; new orders will now be logged for stock and packaging.`
      : operational.packagingMovements > 0 || operational.stockMovements > 0
        ? ` Recorded ${operational.stockMovements} order movements and ${operational.packagingMovements} packaging movements.`
        : "";
    const message = `Shopify synced ${imported.orders} orders and ${imported.variants} variants.${tiktokNote}${tiktokAffiliateNote}${tiktokInventoryNote}${parcel2GoNote} ${operational.alerts} active inventory alerts${baselineNote}`;
    const recordsSeen = imported.orders + imported.variants + tiktokOrders + tiktokAffiliateOrders + tiktokInventorySkus + parcel2GoRecords;
    const status = failures.length > 0 ? "failed" : "succeeded";
    await recordSyncRun({ id, trigger, provider: "direct", status, message, recordsSeen, recordsChanged: recordsSeen, finished: true });
    if (status === "succeeded") await markWebhookEventsProcessed({ before: startedAt });
    return { ok: status === "succeeded", status, message, recordsSeen, recordsChanged: recordsSeen, completedAt, tiktokSample };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected reconciliation error";
    await recordSyncRun({ id, trigger, provider: "direct", status: "failed", message, finished: true });
    return { ok: false, status: "failed", message, recordsSeen: 0, recordsChanged: 0, completedAt };
  } finally {
    await pruneExpiredActivityLog().catch(() => undefined);
    await releaseSyncLease(id);
  }
}
