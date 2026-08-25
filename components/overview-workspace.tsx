import Link from "next/link";
import { ArrowRight, Boxes, CheckCircle2, ClipboardList, Package, ShoppingBag, Store } from "lucide-react";
import type { ReactNode } from "react";
import { SyncButton } from "@/components/sync-button";
import { PaymentPill } from "@/components/status-pill";
import { compactTime, formatMoney, relativeTime } from "@/lib/format";
import type { Order, PackagingMaterial, PhysicalInventoryItem, SyncSnapshot } from "@/lib/types";

type OverviewWorkspaceProps = {
  orders: Order[];
  items: PhysicalInventoryItem[];
  packaging: PackagingMaterial[];
  sync: SyncSnapshot;
};

export function OverviewWorkspace({ orders, items, packaging, sync }: OverviewWorkspaceProps) {
  const shopifyOrders = orders.filter((order) => order.channel === "shopify");
  const tiktokOrders = orders.filter((order) => order.channel === "tiktok");
  const variants = items.flatMap((item) => item.variants);
  const unitsOnHand = variants.reduce((total, variant) => total + variant.quantity, 0);
  const liveVariants = variants.length;
  const lowStockVariants = variants.filter((variant) => variant.quantityKnown && variant.quantity < 10).length;
  const outOfStockVariants = variants.filter((variant) => variant.quantityKnown && variant.quantity === 0).length;
  const packagingTypes = packaging.length;
  const recentOrders = orders.slice(0, 5);
  const shopifyConnected = sync.liveChannels > 0;
  const tiktokConnected = sync.liveChannels > 1;
  const syncCaption = sync.lastSyncedAt
    ? `Last synced ${relativeTime(sync.lastSyncedAt)}`
    : "Awaiting first sync";

  return (
    <section className="workspace workspace--overview">
      <header className="workspace-header overview-header">
        <div>
          <p className="workspace-kicker">Serenity Hue operations</p>
          <h1>Overview</h1>
          <p className="overview-intro">A clear view of orders, channels, and the stock picture behind today&apos;s work.</p>
          <div className="overview-meta">
            <span className={`live-dot live-dot--${sync.status}`} aria-hidden="true" />
            <span>{syncCaption}</span>
            <span aria-hidden="true">·</span>
            <span>{sync.status === "healthy" ? "All connected sources are current" : sync.message}</span>
          </div>
        </div>
        <SyncButton variant="primary" />
      </header>

      <div className="overview-grid overview-grid--primary">
        <section className="overview-panel overview-panel--recent" aria-labelledby="recent-orders-title">
          <header className="overview-panel__header">
            <div><p className="workspace-kicker">Latest activity</p><h2 id="recent-orders-title">Recent orders</h2></div>
            <Link href="/orders" className="overview-text-link">View all orders <ArrowRight size={15} strokeWidth={1.8} /></Link>
          </header>
          {recentOrders.length === 0 ? <EmptyRecentOrders /> : <div className="overview-orders"><table><thead><tr><th>Order</th><th>Date</th><th>Channel</th><th>Customer</th><th>Status</th><th>Total</th><th><span className="sr-only">Open order</span></th></tr></thead><tbody>{recentOrders.map((order) => <tr key={order.id}><td><Link href="/orders" className="overview-order-link">{order.number}</Link></td><td>{compactTime(order.createdAt)}</td><td><span className={`overview-channel overview-channel--${order.channel}`}>{order.channel === "shopify" ? "Shopify" : "TikTok Shop"}</span></td><td>{order.customer}</td><td><PaymentPill status={order.payment} /></td><td>{formatMoney(order.total)}</td><td className="overview-row-action"><ArrowRight size={15} strokeWidth={1.8} /></td></tr>)}</tbody></table></div>}
        </section>

        <section className="overview-panel overview-panel--channels" aria-labelledby="channel-summary-title">
          <header className="overview-panel__header">
            <div><p className="workspace-kicker">Connected sources</p><h2 id="channel-summary-title">Channel status</h2></div>
            <Link href="/orders" className="overview-text-link">View orders <ArrowRight size={15} strokeWidth={1.8} /></Link>
          </header>
          <div className="channel-summary">
            <ChannelSummary icon={<Store size={19} strokeWidth={1.8} />} name="Shopify" detail={`${shopifyOrders.length} imported ${pluralize(shopifyOrders.length, "order")}`} status={shopifyConnected ? "Connected" : "Awaiting setup"} pending={!shopifyConnected} />
            <ChannelSummary icon={<ShoppingBag size={19} strokeWidth={1.8} />} name="TikTok Shop" detail={tiktokOrders.length ? `${tiktokOrders.length} imported ${pluralize(tiktokOrders.length, "order")}` : "Orders appear after seller authorization"} status={tiktokConnected ? "Connected" : "Awaiting authorization"} pending={!tiktokConnected} />
          </div>
        </section>
      </div>

      <section className="overview-panel overview-panel--snapshot" aria-labelledby="stock-snapshot-title">
        <header className="overview-panel__header">
          <div><p className="workspace-kicker">Inventory at a glance</p><h2 id="stock-snapshot-title">Stock snapshot</h2></div>
          <Link href="/inventory/products" className="overview-text-link">Open inventory <ArrowRight size={15} strokeWidth={1.8} /></Link>
        </header>
        <div className="stock-summary">
          <SnapshotCell icon={<Package size={18} strokeWidth={1.8} />} label="Live variants" value={liveVariants.toLocaleString("en-GB")} detail={`${unitsOnHand.toLocaleString("en-GB")} units on hand`} />
          <SnapshotCell icon={<Boxes size={18} strokeWidth={1.8} />} label="Low stock" value={lowStockVariants.toLocaleString("en-GB")} detail={lowStockVariants ? "Review in Products" : "No low-stock variants"} tone={lowStockVariants ? "attention" : "healthy"} />
          <SnapshotCell icon={<CheckCircle2 size={18} strokeWidth={1.8} />} label="Out of stock" value={outOfStockVariants.toLocaleString("en-GB")} detail={outOfStockVariants ? "Needs attention" : "All variants available"} tone={outOfStockVariants ? "attention" : "healthy"} />
          <SnapshotCell icon={<Boxes size={18} strokeWidth={1.8} />} label="Packaging items" value={packagingTypes.toLocaleString("en-GB")} detail={packagingTypes === 1 ? "Tracked material" : "Tracked materials"} />
        </div>
      </section>
    </section>
  );
}

function ChannelSummary({ icon, name, detail, status, pending = false }: { icon: ReactNode; name: string; detail: string; status: string; pending?: boolean }) {
  return <div className="channel-summary__item"><span className="channel-summary__icon" aria-hidden="true">{icon}</span><div><strong>{name}</strong><p>{detail}</p></div><span className={pending ? "channel-summary__status is-pending" : "channel-summary__status"}>{status}</span></div>;
}

function SnapshotCell({ icon, label, value, detail, tone = "neutral" }: { icon: ReactNode; label: string; value: string; detail: string; tone?: "neutral" | "attention" | "healthy" }) {
  return <div className={`overview-snapshot-cell overview-snapshot-cell--${tone}`}><span className="overview-snapshot-cell__icon" aria-hidden="true">{icon}</span><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></div>;
}

function EmptyRecentOrders() {
  return <div className="overview-empty"><span><ClipboardList size={20} strokeWidth={1.7} /></span><div><strong>No orders have been imported yet</strong><p>Use Sync now after Shopify is connected to populate the operations workspace.</p></div></div>;
}

function pluralize(count: number, singular: string) {
  return count === 1 ? singular : `${singular}s`;
}
