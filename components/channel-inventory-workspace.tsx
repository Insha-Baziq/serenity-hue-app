"use client";

import { ChevronDown, ChevronLeft, ChevronRight, Minus, Plus, RefreshCw, Save, Search } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { ProductArt } from "@/components/product-art";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { relativeTime } from "@/lib/format";
import type { ChannelInventoryRow, ChannelInventorySnapshot, InventoryChannel } from "@/lib/types";

const CHANNELS: { id: InventoryChannel; name: string; sub: string }[] = [
  { id: "master", name: "Master", sub: "Physical stock" },
  { id: "shopify", name: "Shopify", sub: "Shopify stock" },
  { id: "tiktok", name: "TikTok Shop", sub: "TikTok stock" },
];

function ChannelLogo({ channel, size = 42 }: { channel: InventoryChannel; size?: number }) {
  if (channel === "shopify") {
    return (
      <span className="ci-logo ci-logo--shopify" style={{ width: size, height: size }} aria-hidden="true">
        <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24"><path d="M15.3 5.2c-.1 0-.9.2-1 .3-.1-.4-.3-.9-.7-1.3-.5-.6-1.2-.7-1.6-.5-.9-.9-1.9-.6-2.8.2-1 .8-1.6 2.3-1.8 3.3-.7.2-1.3.4-1.4.4-.4.1-.4.1-.5.5-.1.3-1 7.9-1 7.9L15 18l3.6-.8S15.7 5.4 15.6 5.3c-.1-.1-.2-.1-.3-.1Z" fill="#fff" /><path d="m12.3 9.2-.4 1.4s-.5-.3-1.2-.2c-1 .1-1 .7-1 .8.1.9 2.4 1.1 2.5 3.1.1 1.6-.8 2.6-2.2 2.7-1.7.1-2.6-.9-2.6-.9l.4-1.5s.9.7 1.7.6c.5 0 .7-.4.6-.7-.1-1.1-2-1.1-2.1-2.9-.1-1.5 1-3.1 3.2-3.2.9-.1 1.4.2 1.4.2Z" fill="#5e8e3e" /></svg>
      </span>
    );
  }
  if (channel === "tiktok") {
    return (
      <span className="ci-logo ci-logo--tiktok" style={{ width: size, height: size }} aria-hidden="true">
        <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24"><path d="M16.6 3.7h-3v13.1a2.3 2.3 0 1 1-2.3-2.3c.2 0 .5 0 .7.1v-3a5.3 5.3 0 1 0 4.6 5.2V9.4a6.7 6.7 0 0 0 3.9 1.2V7.6a3.9 3.9 0 0 1-3.9-3.9Z" fill="#25f4ee" transform="translate(-1 .5)" /><path d="M17.6 2.6h-3v13.1a2.3 2.3 0 1 1-2.3-2.3c.2 0 .5 0 .7.1v-3a5.3 5.3 0 1 0 4.6 5.2V8.3a6.7 6.7 0 0 0 3.9 1.2V6.5a3.9 3.9 0 0 1-3.9-3.9Z" fill="#fe2c55" transform="translate(1 -.3)" /><path d="M17.1 3.1h-3v13.1a2.3 2.3 0 1 1-2.3-2.3c.2 0 .5 0 .7.1v-3a5.3 5.3 0 1 0 4.6 5.2V8.8a6.7 6.7 0 0 0 3.9 1.2V7a3.9 3.9 0 0 1-3.9-3.9Z" fill="#fff" /></svg>
      </span>
    );
  }
  return <span className="ci-logo ci-logo--master" style={{ width: size, height: size }} aria-hidden="true">SH</span>;
}

type Group = {
  productId: string;
  product: string;
  imageTone: ChannelInventoryRow["imageTone"];
  variants: ChannelInventoryRow[];
  leadTime: string;
  packaging: string;
};

const PAGE_SIZES = [25, 40, 50];

export function ChannelInventoryWorkspace({ initial }: { initial: ChannelInventorySnapshot }) {
  const [channel, setChannel] = useState<InventoryChannel>("master");
  const [rows, setRows] = useState(initial.rows);
  const [drafts, setDrafts] = useState<Record<string, number>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState("");

  const masterOf = (row: ChannelInventoryRow) => (row.variantId in drafts ? drafts[row.variantId] : row.master);
  const dirtyCount = useMemo(() => rows.filter((row) => row.variantId in drafts && drafts[row.variantId] !== (row.master ?? 0)).length, [drafts, rows]);

  const groups = useMemo(() => {
    const text = query.trim().toLowerCase();
    const map = new Map<string, ChannelInventoryRow[]>();
    for (const row of rows) {
      if (text && ![row.product, row.variant, row.sku].join(" ").toLowerCase().includes(text)) continue;
      map.set(row.productId, [...(map.get(row.productId) ?? []), row]);
    }
    const consistent = (values: string[]) => { const unique = [...new Set(values.filter((value) => value && value !== "—" && value !== "Not set"))]; return unique.length === 0 ? "—" : unique.length === 1 ? unique[0] : "Varies"; };
    return [...map.values()].map((variants): Group => ({
      productId: variants[0].productId,
      product: variants[0].product,
      imageTone: variants[0].imageTone,
      variants,
      leadTime: consistent(variants.map((variant) => variant.leadTime)),
      packaging: consistent(variants.map((variant) => variant.packagingType)),
    }));
  }, [query, rows]);

  const totalPages = Math.max(1, Math.ceil(groups.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = groups.length === 0 ? 0 : (currentPage - 1) * pageSize;
  const pageEnd = Math.min(pageStart + pageSize, groups.length);
  const visible = groups.slice(pageStart, pageEnd);
  const pageItems = getPageItems(currentPage, totalPages);

  function sumMaster(variants: ChannelInventoryRow[]): number | null {
    const set = variants.filter((variant) => masterOf(variant) !== null);
    return set.length === 0 ? null : set.reduce((total, variant) => total + (masterOf(variant) ?? 0), 0);
  }
  function sumTiktok(variants: ChannelInventoryRow[]): number | null {
    const set = variants.filter((variant) => variant.tiktok !== null);
    return set.length === 0 ? null : set.reduce((total, variant) => total + (variant.tiktok ?? 0), 0);
  }

  function editMaster(row: ChannelInventoryRow, next: number) {
    setDrafts((current) => ({ ...current, [row.variantId]: Math.max(0, next) }));
    setNotice("");
  }

  async function saveMaster() {
    const updates = rows
      .filter((row) => row.variantId in drafts && drafts[row.variantId] !== (row.master ?? 0))
      .map((row) => ({ variantId: row.variantId, quantity: drafts[row.variantId] }));
    if (updates.length === 0) return;
    setSaving(true);
    try {
      const response = await fetch("/api/inventory/master", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ updates }) });
      if (!response.ok) throw new Error("save failed");
      setRows((current) => current.map((row) => (row.variantId in drafts ? { ...row, master: drafts[row.variantId] } : row)));
      setDrafts({});
      setNotice(`Saved ${updates.length} master ${updates.length === 1 ? "change" : "changes"}.`);
    } catch {
      setNotice("Could not save — check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function refreshTikTok() {
    setRefreshing(true);
    setNotice("");
    try {
      const response = await fetch("/api/inventory/refresh-tiktok", { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.message || "refresh failed");
      setNotice(`Fetched ${data.skus} TikTok SKUs · ${data.matched} matched to products. Reload to see updated levels.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "TikTok refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  const activeName = CHANNELS.find((c) => c.id === channel)!.name;
  const channelMeta = {
    master: "Physical count · maintained in-app",
    shopify: initial.sync.lastSyncedAt ? `Fetched from Shopify · synced ${relativeTime(initial.sync.lastSyncedAt)}` : "Fetched from Shopify",
    tiktok: initial.tiktokSyncedAt ? `Fetched from TikTok · synced ${relativeTime(initial.tiktokSyncedAt)}` : "Not yet fetched from TikTok",
  }[channel];

  function qtyCell(value: number | null, active: boolean, isMaster: boolean) {
    return <td className={`ci-qty${active ? " ci-qty--active" : ""}`}><span className={`ci-num${isMaster ? " ci-num--master" : active ? "" : " ci-num--dim"}`}>{value ?? "—"}</span></td>;
  }

  function masterEditCell(row: ChannelInventoryRow) {
    const value = masterOf(row) ?? 0;
    return (
      <td className="ci-qty ci-qty--active">
        <span className="ci-stepper">
          <button type="button" aria-label="Decrease" onClick={() => editMaster(row, value - 1)}><Minus size={14} /></button>
          <input key={`${row.variantId}-${row.master}`} inputMode="numeric" value={value} onChange={(event) => editMaster(row, Number(event.target.value.replace(/\D/g, "")) || 0)} />
          <button type="button" aria-label="Increase" onClick={() => editMaster(row, value + 1)}><Plus size={14} /></button>
        </span>
      </td>
    );
  }

  return (
    <section className="workspace workspace--inventory ci-workspace" data-channel={channel}>
      <header className="workspace-header">
        <div>
          <p className="workspace-kicker ci-kicker">Inventory</p>
          <h1>Stock control — <span className="ci-title-swap">{activeName}</span></h1>
          <div className="live-caption"><span className="live-dot" aria-hidden="true" />{channelMeta}</div>
        </div>
        {channel === "master" && (
          <div className="header-actions">
            {dirtyCount > 0 && <Button variant="ghost" onClick={() => { setDrafts({}); setNotice(""); }}>Discard</Button>}
            <Button variant="primary" onClick={saveMaster} disabled={dirtyCount === 0 || saving}>
              <Save size={16} />{saving ? "Saving…" : dirtyCount > 0 ? `Save ${dirtyCount} change${dirtyCount === 1 ? "" : "s"}` : "Saved"}
            </Button>
          </div>
        )}
      </header>

      <div className="ci-switch" role="tablist" aria-label="Choose inventory">
        {CHANNELS.map((c) => (
          <button key={c.id} type="button" role="tab" aria-selected={channel === c.id} className="ci-chan" data-channel={c.id} onClick={() => { setChannel(c.id); setNotice(""); }}>
            <ChannelLogo channel={c.id} />
            <span className="ci-chan__label"><span className="ci-chan__top">{c.name}</span><span className="ci-chan__sub">{c.sub}</span></span>
          </button>
        ))}
      </div>

      {notice && <div className="ci-notice">{notice}</div>}

      <div className="orders-table-frame inventory-table-frame">
        <div className="inventory-toolbar">
          <label className="search-field search-field--inventory"><Search size={18} strokeWidth={1.8} aria-hidden="true" /><span className="sr-only">Search products or variants</span><Input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Search product or variant" /></label>
          {channel === "tiktok" && <Button variant="outline" size="compact" onClick={refreshTikTok} disabled={refreshing}><RefreshCw size={15} className={refreshing ? "spin" : ""} />{refreshing ? "Fetching…" : "Refresh from TikTok"}</Button>}
          <span className="ci-count">{groups.length} {groups.length === 1 ? "product" : "products"}</span>
        </div>
        <div className="inventory-scroll">
          <table className="inventory-table ci-table">
            <thead>
              <tr>
                <th>Product</th>
                <th className={`ci-qty${channel === "master" ? " ci-qty--active" : ""}`}><span className="ci-colhead ci-colhead--master"><span className="ci-mk">SH</span>Master</span></th>
                <th className={`ci-qty${channel === "shopify" ? " ci-qty--active" : ""}`}><span className="ci-colhead ci-colhead--shopify"><span className="ci-mk"><ChannelLogo channel="shopify" size={16} /></span>Shopify</span></th>
                <th className={`ci-qty${channel === "tiktok" ? " ci-qty--active" : ""}`}><span className="ci-colhead ci-colhead--tiktok"><span className="ci-mk"><ChannelLogo channel="tiktok" size={16} /></span>TikTok</span></th>
                <th>Lead time</th>
                <th>Packaging</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((group) => {
                const single = group.variants.length === 1;
                const isOpen = Boolean(expanded[group.productId]);
                const master = single ? masterOf(group.variants[0]) : sumMaster(group.variants);
                const shopify = group.variants.reduce((total, variant) => total + variant.shopify, 0);
                const tiktok = single ? group.variants[0].tiktok : sumTiktok(group.variants);
                const groupEdited = group.variants.some((variant) => variant.variantId in drafts && drafts[variant.variantId] !== (variant.master ?? 0));
                return (
                  <FragmentRow key={group.productId}>
                    <tr className={groupEdited ? "ci-row--edited" : ""}>
                      <td className="inventory-product ci-product">
                        {single
                          ? <span className="ci-expand-spacer" />
                          : <button type="button" className={`ci-expand${isOpen ? " is-open" : ""}`} aria-label={isOpen ? "Collapse variants" : "Expand variants"} onClick={() => setExpanded((current) => ({ ...current, [group.productId]: !current[group.productId] }))}><ChevronDown size={15} /></button>}
                        <ProductArt tone={group.imageTone} size="small" />
                        <span><strong>{group.product}</strong><small>{single ? (group.variants[0].variant && group.variants[0].variant !== "Default Title" ? group.variants[0].variant : "Single variant") : `${group.variants.length} variants`}</small></span>
                      </td>
                      {single && channel === "master" ? masterEditCell(group.variants[0]) : qtyCell(master, channel === "master", true)}
                      {qtyCell(shopify, channel === "shopify", false)}
                      {qtyCell(tiktok, channel === "tiktok", false)}
                      <td className="ci-muted">{group.leadTime}</td>
                      <td className="ci-muted">{group.packaging}</td>
                    </tr>
                    {!single && isOpen && group.variants.map((variant) => {
                      const vEdited = variant.variantId in drafts && drafts[variant.variantId] !== (variant.master ?? 0);
                      return (
                        <tr key={variant.variantId} className={`ci-subrow${vEdited ? " ci-row--edited" : ""}`}>
                          <td className="ci-product ci-subrow__name"><span className="ci-subrow__dash" />{variant.variant && variant.variant !== "Default Title" ? variant.variant : "Default variant"}</td>
                          {channel === "master" ? masterEditCell(variant) : qtyCell(masterOf(variant), false, true)}
                          {qtyCell(variant.shopify, channel === "shopify", false)}
                          {qtyCell(variant.tiktok, channel === "tiktok", false)}
                          <td className="ci-muted">{variant.leadTime}</td>
                          <td className="ci-muted">{variant.packagingType}</td>
                        </tr>
                      );
                    })}
                  </FragmentRow>
                );
              })}
            </tbody>
          </table>
        </div>
        {groups.length === 0 && <div className="table-empty">No products match that search.</div>}
        <footer className="table-footer">
          <div className="page-size-control">
            <Select value={String(pageSize)} onValueChange={(value) => { setPageSize(Number(value)); setPage(1); }}>
              <SelectTrigger aria-label="Rows per page"><SelectValue /></SelectTrigger>
              <SelectContent>{PAGE_SIZES.map((size) => <SelectItem key={size} value={String(size)}>{size} per page</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="pagination" aria-label="Inventory pagination">
            <span className="pagination-summary">{pageStart + (groups.length ? 1 : 0)}–{pageEnd} of {groups.length}</span>
            <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={currentPage === 1} aria-label="Previous page"><ChevronLeft size={16} /></button>
            {pageItems.map((item, index) => item === "ellipsis"
              ? <span className="pagination-ellipsis" key={`ellipsis-${index}`}>…</span>
              : <button type="button" key={item} className={item === currentPage ? "is-current" : ""} aria-current={item === currentPage ? "page" : undefined} onClick={() => setPage(item)}>{item}</button>)}
            <button type="button" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={currentPage === totalPages} aria-label="Next page"><ChevronRight size={16} /></button>
          </div>
        </footer>
      </div>
    </section>
  );
}

function FragmentRow({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

function getPageItems(currentPage: number, totalPages: number): (number | "ellipsis")[] {
  if (totalPages <= 6) return Array.from({ length: totalPages }, (_, index) => index + 1);
  const pages = new Set([1, totalPages, currentPage - 1, currentPage, currentPage + 1]);
  const ordered = [...pages].filter((page) => page >= 1 && page <= totalPages).sort((a, b) => a - b);
  const items: (number | "ellipsis")[] = [];
  ordered.forEach((item, index) => { if (index > 0 && item - ordered[index - 1] > 1) items.push("ellipsis"); items.push(item); });
  return items;
}
