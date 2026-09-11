import Link from "next/link";
import { ArrowRight, Boxes, CircleAlert, ClipboardList, Package, ShoppingBag, Store } from "lucide-react";
import type { ReactNode } from "react";
import { SyncButton } from "@/components/sync-button";
import { compactTime, formatMoney, relativeTime } from "@/lib/format";
import { deliveryProgressCopy, deliveryProgressState } from "@/lib/delivery-progress";
import type { Order, PackagingMaterial, PhysicalInventoryItem, SyncSnapshot } from "@/lib/types";

type OverviewWorkspaceProps = {
  orders: Order[];
  items: PhysicalInventoryItem[];
  packaging: PackagingMaterial[];
  sync: SyncSnapshot;
};

type AttentionItem = {
  title: string;
  action: string;
  href: string;
  icon: ReactNode;
  tone: "plum" | "orange" | "red";
};

/*
THESIS: Overview is a daily operations brief, not a second KPI dashboard or a mosaic of summary cards.
OWN-WORLD: Warm paper, plum structure, soft 16px surfaces, open rules, serif masthead, and sans-serif operational data.
STORY: Staff see what requires action, inspect work in motion, then move directly into the correct workspace.
FIRST VIEWPORT: A restrained masthead leads into an asymmetric attention queue and recent-order ledger; the operations pulse anchors the page below.
FORM: Daily brief, sixth of seven grounded structures, seed 9ea530d1.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
*/
export function OverviewWorkspace({ orders, items, packaging, sync }: OverviewWorkspaceProps) {
  const shopifyOrders = orders.filter((order) => order.channel === "shopify");
  const tiktokOrders = orders.filter((order) => order.channel === "tiktok");
  const variants = items.flatMap((item) => item.variants);
  const unitsOnHand = variants.reduce((total, variant) => total + variant.quantity, 0);
  const lowStockVariants = variants.filter((variant) => variant.quantityKnown && variant.quantity > 0 && variant.quantity < 10).length;
  const outOfStockVariants = variants.filter((variant) => variant.quantityKnown && variant.quantity === 0).length;
  const uncountedVariants = variants.filter((variant) => !variant.quantityKnown).length;
  const packagingBelowReorder = packaging.filter((material) => material.quantity <= material.reorderPoint).length;
  const recentOrders = orders.slice(0, 4);
  const shopifyConnected = sync.liveChannels > 0;
  const tiktokConnected = sync.liveChannels > 1;
  const syncCaption = sync.lastSyncedAt ? `Synced ${relativeTime(sync.lastSyncedAt)}` : "Awaiting first sync";

  const attentionItems: AttentionItem[] = [
    ...(outOfStockVariants ? [{ title: `${outOfStockVariants.toLocaleString("en-GB")} physical ${pluralize(outOfStockVariants, "variant")} out of stock`, action: "Review stock", href: "/inventory/products", icon: <CircleAlert size={20} strokeWidth={1.8} />, tone: "red" as const }] : []),
    ...(packagingBelowReorder ? [{ title: `${packagingBelowReorder.toLocaleString("en-GB")} packaging ${pluralize(packagingBelowReorder, "item")} below reorder point`, action: "Open packaging", href: "/inventory/packaging", icon: <Boxes size={20} strokeWidth={1.8} />, tone: "orange" as const }] : []),
    ...(lowStockVariants ? [{ title: `${lowStockVariants.toLocaleString("en-GB")} physical ${pluralize(lowStockVariants, "variant")} low on stock`, action: "Review stock", href: "/inventory/products", icon: <Package size={20} strokeWidth={1.8} />, tone: "orange" as const }] : []),
    ...(uncountedVariants ? [{ title: `${uncountedVariants.toLocaleString("en-GB")} physical ${pluralize(uncountedVariants, "variant")} need a stock count`, action: "Count stock", href: "/inventory/products", icon: <Package size={20} strokeWidth={1.8} />, tone: "plum" as const }] : []),
  ].slice(0, 4);

  return (
    <section className="workspace workspace--overview overview-brief">
      <header className="overview-brief__masthead">
        <div>
          <h1>Overview</h1>
        </div>
        <div className="overview-brief__sync">
          <div className="overview-brief__sync-copy">
            <span>{syncCaption}</span>
            {sync.status !== "healthy" && <strong>{sync.message}</strong>}
          </div>
          <SyncButton variant="primary" />
        </div>
      </header>

      <div className={`overview-brief__primary${attentionItems.length ? "" : " overview-brief__primary--solo"}`}>
        {attentionItems.length > 0 && <section className="overview-brief__surface overview-attention" aria-labelledby="overview-attention-title">
          <header className="overview-brief__surface-header">
            <h2 id="overview-attention-title">Needs attention</h2>
          </header>
          <div className="overview-attention__list">{attentionItems.map((item) => <AttentionRow item={item} key={`${item.href}-${item.title}`} />)}</div>
        </section>}

        <section className="overview-brief__surface overview-motion" aria-labelledby="overview-motion-title">
          <header className="overview-brief__surface-header">
            <h2 id="overview-motion-title">Work in motion</h2>
            <Link href="/orders" className="overview-text-link">View all orders <ArrowRight size={15} strokeWidth={1.8} /></Link>
          </header>
          {recentOrders.length ? <RecentOrders orders={recentOrders} /> : <EmptyRecentOrders />}
        </section>
      </div>

      <section className="overview-brief__surface overview-pulse" aria-labelledby="overview-pulse-title">
        <header className="overview-brief__surface-header"><h2 id="overview-pulse-title">Operations pulse</h2></header>
        <div className="overview-pulse__grid">
          <PulseCell icon={<Package size={20} strokeWidth={1.8} />} label="Physical inventory" value={variants.length.toLocaleString("en-GB")} detail={`${unitsOnHand.toLocaleString("en-GB")} units on hand`} href="/inventory/products" action="Open inventory" />
          <PulseCell icon={<Boxes size={20} strokeWidth={1.8} />} label="Packaging" value={packaging.length.toLocaleString("en-GB")} detail={packagingBelowReorder ? `${packagingBelowReorder.toLocaleString("en-GB")} below reorder point` : undefined} href="/inventory/packaging" action="Open packaging" />
          <PulseCell icon={<Store size={20} strokeWidth={1.8} />} label="Shopify orders" value={shopifyOrders.length.toLocaleString("en-GB")} detail={shopifyConnected ? "Connected" : "Awaiting setup"} href="/orders" action="View orders" status={!shopifyConnected ? "attention" : "connected"} />
          <PulseCell icon={<ShoppingBag size={20} strokeWidth={1.8} />} label="TikTok Shop orders" value={tiktokOrders.length.toLocaleString("en-GB")} detail={tiktokConnected ? "Connected" : "Awaiting authorization"} href="/orders" action="View orders" status={!tiktokConnected ? "attention" : "connected"} />
        </div>
      </section>
    </section>
  );
}

function AttentionRow({ item }: { item: AttentionItem }) {
  return <Link className="overview-attention__row" href={item.href}><span className={`overview-attention__icon overview-attention__icon--${item.tone}`} aria-hidden="true">{item.icon}</span><strong>{item.title}</strong><span className="overview-attention__action">{item.action}<ArrowRight size={15} strokeWidth={1.8} /></span></Link>;
}

function RecentOrders({ orders }: { orders: Order[] }) {
  return <div className="overview-motion__orders">{orders.map((order) => {
    const progress = deliveryProgressState(order);
    const progressCopy = deliveryProgressCopy(progress);
    return <Link href="/orders" className="overview-motion__order" key={order.id}><span className="overview-motion__identity"><strong>{order.number}</strong><small>{compactTime(order.createdAt)}</small></span><span className="overview-motion__customer">{order.customer}</span><span className={`overview-channel overview-channel--${order.channel}`}>{order.channel === "shopify" ? "Shopify" : "TikTok Shop"}</span><strong className="overview-motion__total">{formatMoney(order.total)}</strong><span className={`overview-motion__progress overview-motion__progress--${progress}`}>{progressCopy.label}</span><ArrowRight className="overview-motion__arrow" size={15} strokeWidth={1.8} aria-hidden="true" /></Link>;
  })}</div>;
}

function PulseCell({ icon, label, value, detail, href, action, status }: { icon: ReactNode; label: string; value: string; detail?: string; href: string; action: string; status?: "connected" | "attention" }) {
  return <article className="overview-pulse__cell"><span className="overview-pulse__icon" aria-hidden="true">{icon}</span><div className="overview-pulse__body"><span>{label}</span><strong>{value}</strong>{detail && <small className={status ? `is-${status}` : undefined}>{detail}</small>}<Link href={href}>{action}<ArrowRight size={14} strokeWidth={1.8} /></Link></div></article>;
}

function EmptyRecentOrders() {
  return <div className="overview-brief__empty overview-brief__empty--orders"><span aria-hidden="true"><ClipboardList size={21} strokeWidth={1.7} /></span><strong>No imported orders</strong></div>;
}

function pluralize(count: number, singular: string) {
  return count === 1 ? singular : `${singular}s`;
}
