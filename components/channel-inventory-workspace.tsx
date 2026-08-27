"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, RefreshCw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { ProductArt } from "@/components/product-art";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { relativeTime } from "@/lib/format";
import { getPageItems } from "@/lib/pagination";
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

function consistent(values: string[]) {
  const unique = [...new Set(values.filter((value) => value && value !== "—" && value !== "Not set"))];
  return unique.length === 0 ? "—" : unique.length === 1 ? unique[0] : "Varies";
}

function productHref(productId: string) {
  const routeId = productId.split("/").filter(Boolean).pop() || productId;
  return `/inventory/products/${encodeURIComponent(routeId)}`;
}

export function ChannelInventoryWorkspace({ initial }: { initial: ChannelInventorySnapshot }) {
  const router = useRouter();
  const [channel, setChannel] = useState<InventoryChannel>("master");
  const rows = initial.rows;
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState("");
  const [tiktokProductCount, setTikTokProductCount] = useState(initial.tiktokProductCount);

  const allGroups = useMemo(() => {
    const map = new Map<string, ChannelInventoryRow[]>();
    for (const row of rows) map.set(row.productId, [...(map.get(row.productId) ?? []), row]);
    return [...map.values()].map((variants): Group => ({
      productId: variants[0].productId,
      product: variants[0].product,
      imageTone: variants[0].imageTone,
      variants,
      leadTime: consistent(variants.map((variant) => variant.leadTime)),
      packaging: consistent(variants.map((variant) => variant.packagingType)),
    }));
  }, [rows]);

  const groups = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return allGroups;
    return allGroups.filter((group) => [group.product, ...group.variants.flatMap((variant) => [variant.variant, variant.sku])].join(" ").toLowerCase().includes(text));
  }, [allGroups, query]);

  const totalPages = Math.max(1, Math.ceil(groups.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = groups.length === 0 ? 0 : (currentPage - 1) * pageSize;
  const pageEnd = Math.min(pageStart + pageSize, groups.length);
  const visible = groups.slice(pageStart, pageEnd);
  const pageItems = getPageItems(currentPage, totalPages);

  function sumMaster(variants: ChannelInventoryRow[]): number | null {
    const set = variants.filter((variant) => variant.master !== null);
    return set.length === 0 ? null : set.reduce((total, variant) => total + (variant.master ?? 0), 0);
  }
  function sumTiktok(variants: ChannelInventoryRow[]): number | null {
    const set = variants.filter((variant) => variant.tiktok !== null);
    const productLevel = variants.filter((variant) => variant.tiktokProductLevel !== null).reduce((total, variant) => total + (variant.tiktokProductLevel ?? 0), 0);
    return set.length === 0 && variants.every((variant) => variant.tiktokProductLevel === null)
      ? null
      : set.reduce((total, variant) => total + (variant.tiktok ?? 0), 0) + productLevel;
  }

  async function refreshTikTok() {
    setRefreshing(true);
    setNotice("");
    try {
      const response = await fetch("/api/inventory/refresh-tiktok", { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.message || "refresh failed");
      const removed = typeof data.removed === "number" ? ` · ${data.removed} stale rows removed` : "";
      const unmatched = Array.isArray(data.unmatchedProducts) ? data.unmatchedProducts : [];
      const unresolved = unmatched.length === 0
        ? " Every live TikTok listing maps to one Shopify product."
        : ` Listings needing a Shopify-product mapping: ${unmatched.map((product: { productTitle?: unknown }) => typeof product.productTitle === "string" ? product.productTitle : "Unnamed TikTok listing").join("; ")}.`;
      if (typeof data.products === "number") setTikTokProductCount(data.products);
      setNotice(`Fetched ${data.products ?? "all"} live TikTok products · ${data.skus} SKUs · ${data.matched} variant-level matches${removed}.${unresolved} Reload to see updated levels.`);
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

  return (
    <section className="workspace workspace--inventory ci-workspace" data-channel={channel}>
      <header className="workspace-header">
        <div>
          <p className="workspace-kicker ci-kicker">Inventory</p>
          <h1>Stock control — <span className="ci-title-swap">{activeName}</span></h1>
          <div className="live-caption"><span className="live-dot" aria-hidden="true" />{channelMeta}</div>
        </div>
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
          <span className="ci-count">{channel === "tiktok" ? `${tiktokProductCount} live TikTok listings · ${groups.length} Shopify products` : `${groups.length} ${groups.length === 1 ? "product" : "products"}`}</span>
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
                <th><span className="sr-only">Open product</span></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((group) => {
                const master = sumMaster(group.variants);
                const shopify = group.variants.reduce((total, variant) => total + variant.shopify, 0);
                const tiktok = sumTiktok(group.variants);
                return (
                  <tr
                    key={group.productId}
                    className="ci-row"
                    role="link"
                    tabIndex={0}
                    aria-label={`Open ${group.product}`}
                    onClick={(event) => {
                      if ((event.target as HTMLElement).closest("a, button, input, [role=button]")) return;
                      router.push(productHref(group.productId));
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      router.push(productHref(group.productId));
                    }}
                  >
                    <td className="inventory-product ci-product"><Link className="ci-product-link" href={productHref(group.productId)}><ProductArt tone={group.imageTone} size="small" /><span><strong>{group.product}</strong><small>{group.variants.length === 1 ? "Single variant · Open product" : `${group.variants.length} variants · Open product`}</small></span></Link></td>
                    {qtyCell(master, channel === "master", true)}
                    {qtyCell(shopify, channel === "shopify", false)}
                    {qtyCell(tiktok, channel === "tiktok", false)}
                    <td className="ci-muted">{group.leadTime}</td>
                    <td className="ci-muted">{group.packaging}</td>
                    <td className="row-action"><Link href={productHref(group.productId)} aria-label={`Open ${group.product}`}><ChevronRight size={18} aria-hidden="true" /></Link></td>
                  </tr>
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
