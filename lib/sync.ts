import { markWebhookEventsProcessed, recordSyncRun, releaseSyncLease, takeSyncLease } from "@/lib/repository";
import { reconcileInventoryOperations } from "@/lib/inventory-rules";
import { hasParcel2GoCredentials } from "@/lib/parcel2go";
import { importRecentParcel2GoShipments } from "@/lib/parcel2go-import";
import { importShopifySnapshot } from "@/lib/shopify-import";
import { hasShopifyCredentials } from "@/lib/shopify";
import { importTikTokOrders, TikTokNotConnectedError, type TikTokRedactedSample } from "@/lib/tiktok-import";
import { importTikTokAffiliateReporting } from "@/lib/tiktok-affiliate-import";
import { storeTikTokInventory } from "@/lib/tiktok-inventory";

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
export async function syncDirectChannels(trigger: SyncTrigger): Promise<SyncResult> {
  const id = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const completedAt = new Date().toISOString();
  const canRun = await takeSyncLease(id);
  if (!canRun) {
    return { ok: true, status: "skipped", message: "A reconciliation is already in progress", recordsSeen: 0, recordsChanged: 0, completedAt };
  }

  try {
    await recordSyncRun({ id, trigger, provider: "direct", status: "running", message: "Importing Shopify, TikTok Shop, and TikTok affiliate reporting" });

    if (!hasShopifyCredentials()) {
      const message = "Live sync needs Shopify credentials in .env.local";
      await recordSyncRun({ id, trigger, provider: "direct", status: "failed", message, finished: true });
      return { ok: false, status: "failed", message, recordsSeen: 0, recordsChanged: 0, completedAt };
    }

    const imported = await importShopifySnapshot();
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
    } catch (error) {
      if (!(error instanceof TikTokNotConnectedError)) {
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
    } catch (error) {
      if (!(error instanceof TikTokNotConnectedError)) {
        failures.push("TikTok affiliate reporting sync needs attention");
        tiktokAffiliateNote = " TikTok affiliate reporting sync needs attention; the last successful affiliate snapshot is retained.";
      }
    }

    let tiktokInventoryNote = "";
    try {
      const inventory = await storeTikTokInventory();
      tiktokInventorySkus = inventory.skus;
      tiktokInventoryNote = ` TikTok inventory refreshed ${inventory.skus} live SKUs and removed ${inventory.removed} stale records.`;
    } catch (error) {
      if (!(error instanceof TikTokNotConnectedError)) {
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
      } catch {
        failures.push("Parcel2Go delivery sync needs attention");
        parcel2GoNote = " Parcel2Go delivery sync needs attention.";
      }
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
    await releaseSyncLease(id);
  }
}
