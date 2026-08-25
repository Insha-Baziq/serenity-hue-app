"use client";

import { CalendarDays, ChevronLeft, ChevronRight, Download, ExternalLink, Link2, Search } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ORDERS_PAGE_SIZES, ordersQueryToParams, type OrdersQuery } from "@/lib/orders-query";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { TableColumnPicker } from "@/components/table-column-picker";
import { ChannelPill, FulfillmentPill, PaymentPill } from "@/components/status-pill";
import { ProductArt } from "@/components/product-art";
import { SyncButton } from "@/components/sync-button";
import { compactTime, formatMoney, relativeTime } from "@/lib/format";
import type { Channel, Order, Parcel2GoMatchMethod, Parcel2GoShipmentOption, SyncSnapshot } from "@/lib/types";

type Props = {
  initialOrders: Order[];
  initialSync: SyncSnapshot;
  query: OrdersQuery;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  unlinkedParcel2GoShipments: Parcel2GoShipmentOption[];
};
type ColumnId = "date" | "customer" | "channel" | "total" | "payment" | "fulfillment" | "items";

const channelTabs: { label: string; value: "all" | Channel }[] = [
  { label: "All orders", value: "all" },
  { label: "Shopify", value: "shopify" },
  { label: "TikTok Shop", value: "tiktok" },
];

const columns: { id: ColumnId; label: string }[] = [
  { id: "date", label: "Date" },
  { id: "customer", label: "Customer" },
  { id: "channel", label: "Channel" },
  { id: "total", label: "Total" },
  { id: "payment", label: "Payment status" },
  { id: "fulfillment", label: "Fulfilment status" },
  { id: "items", label: "Items" },
];

const defaultVisibleColumns = columns.map((column) => column.id);

export function OrdersWorkspace({ initialOrders, initialSync, query, total, page, pageSize, totalPages, unlinkedParcel2GoShipments }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const [queryInput, setQueryInput] = useState(query.q);
  const [syncedQuery, setSyncedQuery] = useState(query.q);
  const [selectedId, setSelectedId] = useState("");
  const [visibleColumns, setVisibleColumns] = useState<ColumnId[]>(defaultVisibleColumns);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Keep the search box in step with the URL (e.g. back/forward) without an
  // effect: React's recommended "adjust state during render" pattern.
  if (query.q !== syncedQuery) {
    setSyncedQuery(query.q);
    setQueryInput(query.q);
  }

  const orders = initialOrders;
  const selectedOrder = initialOrders.find((order) => order.id === selectedId);
  const pageItems = getPageItems(page, totalPages);
  const pageStart = total === 0 ? 0 : (page - 1) * pageSize;
  const pageEnd = pageStart + orders.length;
  const syncCaption = initialSync.lastSyncedAt ? `reconciled ${relativeTime(initialSync.lastSyncedAt)}` : initialSync.message;
  const channelCaption = initialSync.liveChannels > 1 ? "Shopify + TikTok Shop" : "Shopify";

  // All filtering, search and pagination now run server-side, driven through the
  // URL. Each control merges its change into the current query and navigates;
  // any change other than paging resets to page 1.
  function navigate(next: Partial<OrdersQuery>, replace = false) {
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    const merged: OrdersQuery = { ...query, q: queryInput, ...next };
    if (!("page" in next)) merged.page = 1;
    const params = ordersQueryToParams(merged);
    const href = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    startTransition(() => {
      if (replace) router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
    });
  }

  function onSearchChange(value: string) {
    setQueryInput(value);
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => navigate({ q: value }, true), 300);
  }

  function setColumnVisibility(column: ColumnId) {
    setVisibleColumns((current) => current.includes(column) ? current.filter((item) => item !== column) : [...current, column]);
  }

  async function exportOrders() {
    const params = ordersQueryToParams({ ...query, q: queryInput, page: 1 });
    const response = await fetch(`/api/orders/export?${params.toString()}`);
    if (!response.ok) return;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "serenity-hue-orders.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="workspace workspace--orders">
      <header className="workspace-header">
        <div>
          <p className="workspace-kicker">Operations ledger</p>
          <h1>Orders</h1>
          <div className="live-caption">
            <span>{channelCaption}</span>
            <span aria-hidden="true">·</span>
            <span>{syncCaption}</span>
            <span className={`live-dot live-dot--${initialSync.status}`} aria-hidden="true" />
            <span>{initialSync.status === "healthy" ? "All channels live" : "Sync needs attention"}</span>
          </div>
        </div>
        <div className="header-actions">
          <SyncButton />
          <Button variant="primary" onClick={exportOrders}>
            <Download size={17} aria-hidden="true" />
            Export orders
          </Button>
        </div>
      </header>

      <div className="orders-layout">
        <div className="orders-content">
          <div className="order-toolbar">
            <label className="search-field">
              <Search size={18} strokeWidth={1.8} aria-hidden="true" />
              <span className="sr-only">Search orders</span>
              <Input value={queryInput} onChange={(event) => onSearchChange(event.target.value)} placeholder="Search order, customer or SKU" />
            </label>
            <div className="order-date-control">
              <CalendarDays size={17} strokeWidth={1.8} aria-hidden="true" />
              <Select value={query.dateRange} onValueChange={(value) => navigate({ dateRange: value as OrdersQuery["dateRange"] })}>
                <SelectTrigger aria-label="Order date range">
                  <SelectValue placeholder="Date range" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">Last 30 days</SelectItem>
                  <SelectItem value="90">Last 90 days</SelectItem>
                  <SelectItem value="all">All time</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="orders-table-frame" aria-busy={isPending} style={{ opacity: isPending ? 0.6 : 1, transition: "opacity 120ms ease" }}>
            <div className="orders-tabs">
              <div role="tablist" aria-label="Order channel">
                {channelTabs.map((tab) => (
                  <button
                    key={tab.value}
                    role="tab"
                    aria-selected={query.channel === tab.value}
                    className={query.channel === tab.value ? "is-selected" : ""}
                    onClick={() => navigate({ channel: tab.value })}
                    type="button"
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <div className="orders-table-actions">
                <Select value={query.fulfillment} onValueChange={(value) => navigate({ fulfillment: value as OrdersQuery["fulfillment"] })}>
                  <SelectTrigger className="table-filter" aria-label="Fulfilment status">
                    <SelectValue placeholder="Fulfilment status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Fulfilment status</SelectItem>
                    <SelectItem value="unfulfilled">Unfulfilled</SelectItem>
                    <SelectItem value="partial">Partially fulfilled</SelectItem>
                    <SelectItem value="fulfilled">Fulfilled</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
                <TableColumnPicker columns={columns} visibleColumns={visibleColumns} onToggle={setColumnVisibility} onReset={() => setVisibleColumns(defaultVisibleColumns)} />
              </div>
            </div>

            <div className="orders-table-scroll">
              <table className="orders-table">
                <thead>
                  <tr>
                    <th>Order</th>
                    {visibleColumns.includes("date") && <th>Date</th>}
                    {visibleColumns.includes("customer") && <th>Customer</th>}
                    {visibleColumns.includes("channel") && <th>Channel</th>}
                    {visibleColumns.includes("total") && <th>Total</th>}
                    {visibleColumns.includes("payment") && <th>Payment status</th>}
                    {visibleColumns.includes("fulfillment") && <th>Fulfilment status</th>}
                    {visibleColumns.includes("items") && <th>Items</th>}
                    <th><span className="sr-only">View order</span></th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <tr
                      key={order.id}
                      className={selectedOrder?.id === order.id ? "is-selected" : ""}
                      onClick={() => setSelectedId(order.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedId(order.id);
                        }
                      }}
                      tabIndex={0}
                    >
                      <td className="order-number">{order.number}</td>
                      {visibleColumns.includes("date") && <td className="date-cell date-cell--single">{compactTime(order.createdAt)}</td>}
                      {visibleColumns.includes("customer") && <td>{order.customer}</td>}
                      {visibleColumns.includes("channel") && <td><ChannelPill channel={order.channel} /></td>}
                      {visibleColumns.includes("total") && <td className="total-cell">{formatMoney(order.total)}</td>}
                      {visibleColumns.includes("payment") && <td><PaymentPill status={order.payment} cancelled={Boolean(order.cancelledAt)} /></td>}
                      {visibleColumns.includes("fulfillment") && <td><FulfillmentPill status={order.fulfillment} /></td>}
                      {visibleColumns.includes("items") && <td>{order.items.reduce((total, item) => total + item.quantity, 0)} {order.items.reduce((total, item) => total + item.quantity, 0) === 1 ? "item" : "items"}</td>}
                      <td className="row-action"><ChevronRight size={18} aria-hidden="true" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mobile-record-list mobile-order-list" aria-label="Orders">
              {orders.map((order) => {
                const itemCount = order.items.reduce((total, item) => total + item.quantity, 0);
                return (
                  <button
                    className={selectedOrder?.id === order.id ? "mobile-record mobile-order-card is-selected" : "mobile-record mobile-order-card"}
                    key={order.id}
                    onClick={() => setSelectedId(order.id)}
                    type="button"
                  >
                    <span className="mobile-record__header"><span><strong>{order.number}</strong><small>{compactTime(order.createdAt)}</small></span><ChevronRight aria-hidden="true" size={18} /></span>
                    <span className="mobile-order-card__customer">{order.customer}</span>
                    <span className="mobile-record__pills"><ChannelPill channel={order.channel} /><PaymentPill status={order.payment} cancelled={Boolean(order.cancelledAt)} /></span>
                    <span className="mobile-record__footer"><span>{itemCount} {itemCount === 1 ? "item" : "items"}</span><FulfillmentPill status={order.fulfillment} /><strong>{formatMoney(order.total)}</strong></span>
                  </button>
                );
              })}
            </div>
            {total === 0 && <div className="table-empty">No orders match those filters.</div>}
            <footer className="table-footer">
              <div className="page-size-control">
                <Select value={String(query.pageSize)} onValueChange={(value) => navigate({ pageSize: Number(value) })}>
                  <SelectTrigger aria-label="Orders per page">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ORDERS_PAGE_SIZES.map((size) => <SelectItem value={String(size)} key={size}>{size} per page</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="pagination" aria-label="Pagination">
                <span className="pagination-summary">{pageStart + (total ? 1 : 0)}–{pageEnd} of {total}</span>
                <button type="button" onClick={() => navigate({ page: page - 1 })} disabled={page === 1} aria-label="Previous page"><ChevronLeft size={16} /></button>
                {pageItems.map((item, index) => item === "ellipsis" ? <span className="pagination-ellipsis" key={`ellipsis-${index}`}>…</span> : <button type="button" key={item} className={item === page ? "is-current" : ""} aria-current={item === page ? "page" : undefined} onClick={() => navigate({ page: item })}>{item}</button>)}
                <button type="button" onClick={() => navigate({ page: page + 1 })} disabled={page === totalPages} aria-label="Next page"><ChevronRight size={16} /></button>
              </div>
            </footer>
          </div>
        </div>
      </div>

      <Sheet open={Boolean(selectedOrder)} onOpenChange={(open) => !open && setSelectedId("")}>
        <SheetContent className="order-sheet" aria-describedby="order-sheet-description">
          {selectedOrder && <OrderDetails order={selectedOrder} unlinkedParcel2GoShipments={unlinkedParcel2GoShipments} />}
        </SheetContent>
      </Sheet>
    </section>
  );
}

function OrderDetails({ order, unlinkedParcel2GoShipments }: { order: Order; unlinkedParcel2GoShipments: Parcel2GoShipmentOption[] }) {
  const sourceLabel = order.channel === "shopify" ? "Shopify" : "TikTok Shop";

  return (
    <div className="order-details" aria-label={`Details for ${order.number}`}>
      <div className="order-detail-header">
        <div>
          <p className="workspace-kicker">Order detail</p>
          <div className="order-detail-heading-line">
            <SheetTitle asChild><h2>{order.number}</h2></SheetTitle>
            <ChannelPill channel={order.channel} />
          </div>
          <div className="order-detail-statuses">
            <PaymentPill status={order.payment} cancelled={Boolean(order.cancelledAt)} />
            <FulfillmentPill status={order.fulfillment} />
          </div>
        </div>
        {order.adminUrl && <a className={`${buttonVariants({ variant: "outline", size: "compact" })} source-link`} href={order.adminUrl} target="_blank" rel="noreferrer">Open in {sourceLabel}<ExternalLink size={14} aria-hidden="true" /></a>}
      </div>
      <SheetDescription id="order-sheet-description" className="sr-only">
        Full order information for {order.number}.
      </SheetDescription>
      {!order.adminUrl && <p className="source-link source-link--unavailable">A direct {sourceLabel} link will appear once that channel is connected.</p>}
      <div className="customer-block">
        <p className="detail-label">Customer</p>
        <h3>{order.customer}</h3>
        {order.address.length > 0 && order.address.map((line) => <p key={line}>{line}</p>)}
        <p className="customer-contact">{order.email || "No email recorded"}</p>
        {order.phone && <p className="customer-contact">{order.phone}</p>}
      </div>
      <div className="detail-section">
        <div className="detail-section__heading"><h3>Items</h3><span>Qty</span><span>Total</span></div>
        {order.items.length === 0 ? <p className="muted-copy">No line items were supplied by the source.</p> : order.items.map((item) => (
          <div className="detail-item" key={item.id}>
            <ProductArt tone={item.imageTone} size="small" />
            <div><strong>{item.title}</strong><small>{item.variant || item.sku}</small></div>
            <span>{item.quantity}</span>
            <strong>{formatMoney(item.unitPrice * item.quantity)}</strong>
          </div>
        ))}
      </div>
      <div className="order-totals">
        <p><span>Subtotal</span><span>{formatMoney(order.subtotal)}</span></p>
        <p><span>Shipping</span><span>{formatMoney(order.shipping)}</span></p>
        <p><span>Tax</span><span>{formatMoney(order.tax)}</span></p>
        <p className="order-totals__total"><strong>Total</strong><strong>{formatMoney(order.total)}</strong></p>
        <p className="paid-row"><span>Payment status</span><PaymentPill status={order.payment} cancelled={Boolean(order.cancelledAt)} /></p>
      </div>
      <div className="detail-section fulfillment-timeline">
        <h3>Order timeline</h3>
        <TimelineStep label="Order placed" detail={compactTime(order.createdAt)} state="complete" />
        {order.cancelledAt ? (
          <TimelineStep label="Cancelled" detail={compactTime(order.cancelledAt)} state="current" />
        ) : <>
          <TimelineStep label={order.payment === "paid" ? "Paid" : "Payment pending"} detail={order.payment === "paid" ? "Payment received" : "Needs attention"} state={order.payment === "paid" ? "complete" : "current"} />
          <TimelineStep label={order.fulfillment === "fulfilled" ? "Fulfilled" : "Ready to fulfil"} detail={order.fulfillment === "fulfilled" ? "Completed" : "Awaiting fulfilment"} state={order.fulfillment === "fulfilled" ? "complete" : "current"} />
        </>}
      </div>
      <Parcel2GoDeliverySection order={order} availableShipments={unlinkedParcel2GoShipments} />
      <div className="source-row"><span>Order source</span><strong>{sourceLabel}</strong></div>
    </div>
  );
}

function Parcel2GoDeliverySection({ order, availableShipments }: { order: Order; availableShipments: Parcel2GoShipmentOption[] }) {
  const router = useRouter();
  const [shipmentId, setShipmentId] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function linkShipment() {
    if (!shipmentId) return;
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(order.id)}/parcel2go`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shipmentId }),
      });
      const data = await response.json() as { message?: string };
      if (!response.ok) throw new Error(data.message || "Unable to link this delivery");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to link this delivery");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="detail-section delivery-section">
      <div className="delivery-section__heading"><h3>Delivery</h3><span>Parcel2Go</span></div>
      {order.deliveries.length > 0 ? order.deliveries.map((delivery) => (
        <div className="delivery-record" key={delivery.id}>
          <div className="delivery-record__summary">
            <div>
              <strong>{delivery.courier}</strong>
              <small>{delivery.service}</small>
              {delivery.matchMethod && <small className="delivery-match-note">{deliveryMatchLabel(delivery.matchMethod)}</small>}
            </div>
            <span className={`delivery-status delivery-status--${delivery.status}`}>{deliveryStatusLabel(delivery.status)}</span>
          </div>
          <dl className="delivery-record__meta">
            <div><dt>Parcel2Go ref</dt><dd>{delivery.orderLineId}</dd></div>
            {delivery.sourceReferences.map((reference) => <div key={reference}><dt>Order reference</dt><dd>{reference}</dd></div>)}
            {delivery.collectionDate && <div><dt>Collection</dt><dd>{compactTime(delivery.collectionDate)}</dd></div>}
            {delivery.estimatedDeliveryAt && <div><dt>Estimated delivery</dt><dd>{compactTime(delivery.estimatedDeliveryAt)}</dd></div>}
          </dl>
          {delivery.events.length > 0 && <div className="delivery-timeline" aria-label="Parcel2Go delivery timeline">
            {delivery.events.map((event) => <TimelineStep key={event.id} label={event.label} detail={compactTime(event.occurredAt)} state="complete" />)}
          </div>}
          {delivery.trackingUrl && <a className={`${buttonVariants({ variant: "outline", size: "compact" })} delivery-link`} href={delivery.trackingUrl} target="_blank" rel="noreferrer">Open in Parcel2Go<ExternalLink size={14} aria-hidden="true" /></a>}
        </div>
      )) : (
        <div className="delivery-empty">
          <p>No Parcel2Go delivery has been confidently matched to this order yet.</p>
          {availableShipments.length > 0 ? <div className="delivery-linker">
            <Select value={shipmentId} onValueChange={setShipmentId}>
              <SelectTrigger aria-label="Parcel2Go delivery"><SelectValue placeholder="Choose a recent Parcel2Go delivery" /></SelectTrigger>
              <SelectContent>
                {availableShipments.map((shipment) => <SelectItem value={shipment.id} key={shipment.id}>{shipment.courier} · {shipment.service} · {shipment.sourceReferences[0] ? `order ${shipment.sourceReferences[0]}` : `Parcel2Go ref ${shipment.orderLineId}`}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" size="compact" disabled={!shipmentId || pending} onClick={linkShipment}><Link2 size={14} aria-hidden="true" />{pending ? "Linking…" : "Link delivery"}</Button>
          </div> : <small>Parcel2Go deliveries are matched automatically during each sync.</small>}
          {message && <small className="delivery-error" role="status">{message}</small>}
        </div>
      )}
    </div>
  );
}

function deliveryStatusLabel(status: string) {
  return status === "booked" ? "Booked" : status.split("_").map((word) => word[0]?.toUpperCase() + word.slice(1)).join(" ");
}

function deliveryMatchLabel(method: Parcel2GoMatchMethod) {
  if (method === "order_reference") return "Matched automatically from the order reference";
  if (method === "customer_email") return "Matched automatically from the customer email and booking date";
  if (method === "customer_phone") return "Matched automatically from the customer phone and booking date";
  return "Matched automatically from the recipient, delivery address, and booking date";
}

function TimelineStep({ label, detail, state }: { label: string; detail: string; state: "complete" | "current" }) {
  return <div className={`timeline-step timeline-step--${state}`}><span className="timeline-marker" /><div><strong>{label}</strong><small>{detail}</small></div></div>;
}

function getPageItems(currentPage: number, totalPages: number): (number | "ellipsis")[] {
  if (totalPages <= 6) return Array.from({ length: totalPages }, (_, index) => index + 1);

  const pages = new Set([1, totalPages, currentPage - 1, currentPage, currentPage + 1]);
  const ordered = [...pages].filter((page) => page >= 1 && page <= totalPages).sort((a, b) => a - b);
  const items: (number | "ellipsis")[] = [];

  ordered.forEach((page, index) => {
    if (index > 0 && page - ordered[index - 1] > 1) items.push("ellipsis");
    items.push(page);
  });

  return items;
}
