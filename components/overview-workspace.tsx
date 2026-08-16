import Link from "next/link";
import { ArrowUpRight, Boxes, ClipboardList, Package, ShoppingBag } from "lucide-react";
import type { ReactNode } from "react";
import { SyncButton } from "@/components/sync-button";
import { compactTime, formatMoney, relativeTime } from "@/lib/format";
import type { InventorySnapshot, Order } from "@/lib/types";

type OverviewWorkspaceProps = {
  orders: Order[];
  inventory: InventorySnapshot;
};

export function OverviewWorkspace({ orders, inventory }: OverviewWorkspaceProps) {
  const now = new Date();
  const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const todayOrders = orders.filter((order) => new Date(order.createdAt) >= startOfToday);
  const weekOrders = orders.filter((order) => new Date(order.createdAt) >= sevenDaysAgo);
  const todaySales = todayOrders.reduce((total, order) => total + order.total, 0);
  const weekSales = weekOrders.reduce((total, order) => total + order.total, 0);
  const shopifyOrders = orders.filter((order) => order.channel === "shopify");
  const tiktokOrders = orders.filter((order) => order.channel === "tiktok");
  const unitsOnHand = inventory.products.reduce((total, product) => total + product.quantity, 0);
  const activeVariants = inventory.products.length;
  const packagingTypes = inventory.packaging.length;
  const recentOrders = orders.slice(0, 5);
  const syncCaption = inventory.sync.lastSyncedAt
    ? `Last reconciled ${relativeTime(inventory.sync.lastSyncedAt)}`
    : inventory.sync.message;

  return (
    <section className="workspace workspace--overview">
      <header className="workspace-header overview-header">
        <div>
          <p className="workspace-kicker">Serenity Hue operations</p>
          <h1>Overview</h1>
          <p className="overview-intro">Orders, sales, and the live Shopify stock picture in one place.</p>
        </div>
        <SyncButton variant="primary" />
      </header>

      <section className="overview-metrics" aria-label="Sales snapshot">
        <MetricCard label="Sales today" value={formatMoney(todaySales)} detail={`${todayOrders.length} ${pluralize(todayOrders.length, "order")}`} icon={<ShoppingBag size={18} strokeWidth={1.8} />} tone="plum" />
        <MetricCard label="Sales in 7 days" value={formatMoney(weekSales)} detail={`${weekOrders.length} ${pluralize(weekOrders.length, "order")}`} icon={<ArrowUpRight size={18} strokeWidth={1.8} />} tone="rose" />
        <MetricCard label="Live variants" value={String(activeVariants)} detail={`${unitsOnHand.toLocaleString("en-GB")} units on hand`} icon={<Package size={18} strokeWidth={1.8} />} tone="neutral" />
        <MetricCard label="Packaging types" value={String(packagingTypes)} detail={syncCaption} icon={<Boxes size={18} strokeWidth={1.8} />} tone="neutral" />
      </section>

      <div className="overview-grid">
        <section className="overview-panel overview-panel--channels" aria-labelledby="channel-summary-title">
          <header className="overview-panel__header">
            <div><p className="workspace-kicker">Order sources</p><h2 id="channel-summary-title">Channel summary</h2></div>
            <Link href="/orders" className="overview-text-link">View orders <ArrowUpRight size={15} strokeWidth={1.8} /></Link>
          </header>
          <div className="channel-summary">
            <ChannelSummary name="Shopify" detail={`${shopifyOrders.length} imported ${pluralize(shopifyOrders.length, "order")}`} status="Connected" />
            <ChannelSummary name="TikTok Shop" detail={tiktokOrders.length ? `${tiktokOrders.length} imported ${pluralize(tiktokOrders.length, "order")}` : "Orders appear when the TikTok connection is ready"} status={tiktokOrders.length ? "Connected" : "Pending"} pending={!tiktokOrders.length} />
          </div>
        </section>

        <section className="overview-panel overview-panel--inventory" aria-labelledby="inventory-summary-title">
          <header className="overview-panel__header">
            <div><p className="workspace-kicker">Stock snapshot</p><h2 id="inventory-summary-title">Inventory at a glance</h2></div>
            <Link href="/inventory" className="overview-text-link">Open inventory <ArrowUpRight size={15} strokeWidth={1.8} /></Link>
          </header>
          <div className="stock-summary">
            <div><span>Shopify stock</span><strong>{unitsOnHand.toLocaleString("en-GB")}</strong><small>units across {activeVariants} variants</small></div>
            <div><span>Operational packaging</span><strong>{packagingTypes}</strong><small>{packagingTypes === 1 ? "tracked material" : "tracked materials"}</small></div>
          </div>
        </section>
      </div>

      <section className="overview-panel overview-panel--recent" aria-labelledby="recent-orders-title">
        <header className="overview-panel__header">
          <div><p className="workspace-kicker">Latest activity</p><h2 id="recent-orders-title">Recent orders</h2></div>
          <Link href="/orders" className="overview-text-link">All orders <ArrowUpRight size={15} strokeWidth={1.8} /></Link>
        </header>
        {recentOrders.length === 0 ? <EmptyRecentOrders /> : <div className="overview-orders"><table><thead><tr><th>Order</th><th>Channel</th><th>Customer</th><th>Placed</th><th>Total</th></tr></thead><tbody>{recentOrders.map((order) => <tr key={order.id}><td><Link href="/orders" className="overview-order-link">{order.number}</Link></td><td><span className={`overview-channel overview-channel--${order.channel}`}>{order.channel === "shopify" ? "Shopify" : "TikTok"}</span></td><td>{order.customer}</td><td>{compactTime(order.createdAt)}</td><td>{formatMoney(order.total)}</td></tr>)}</tbody></table></div>}
      </section>
    </section>
  );
}

function MetricCard({ label, value, detail, icon, tone }: { label: string; value: string; detail: string; icon: ReactNode; tone: "plum" | "rose" | "neutral" }) {
  return <article className={`overview-metric overview-metric--${tone}`}><span className="overview-metric__icon">{icon}</span><p>{label}</p><strong>{value}</strong><small>{detail}</small></article>;
}

function ChannelSummary({ name, detail, status, pending = false }: { name: string; detail: string; status: "Connected" | "Pending"; pending?: boolean }) {
  return <div className="channel-summary__item"><div><span className="channel-summary__dot" aria-hidden="true" /><strong>{name}</strong><p>{detail}</p></div><span className={pending ? "channel-summary__status is-pending" : "channel-summary__status"}>{status}</span></div>;
}

function EmptyRecentOrders() {
  return <div className="overview-empty"><span><ClipboardList size={20} strokeWidth={1.7} /></span><div><strong>No orders have been imported yet</strong><p>Use Sync now after Shopify is connected to populate the operations workspace.</p></div></div>;
}

function pluralize(count: number, singular: string) {
  return count === 1 ? singular : `${singular}s`;
}
