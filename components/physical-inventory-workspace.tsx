"use client";

import Link from "next/link";
import Image from "next/image";
import { ChevronDownIcon } from "@radix-ui/react-icons";
import { Package, Search } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { ChannelMark, PhysicalChannelListings } from "@/components/physical-channel-listings";
import { PhysicalInventoryAdjustSheet } from "@/components/physical-inventory-adjust-sheet";
import { ProductArt } from "@/components/product-art";
import { TableColumnPicker, type TableColumn } from "@/components/table-column-picker";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { PhysicalChannel, PhysicalChannelListing, PhysicalInventoryItem, PhysicalInventoryRunways } from "@/lib/types";

type ProductColumn = "product" | "variants" | "stock" | "averageEstimatedCover";

const columns: TableColumn<ProductColumn>[] = [
  { id: "product", label: "Product name" },
  { id: "variants", label: "Variants / size" },
  { id: "stock", label: "Stock" },
  { id: "averageEstimatedCover", label: "Average estimated cover" },
];
const defaultColumns = columns.map((column) => column.id);

function ProductThumbnail({ item }: { item: PhysicalInventoryItem }) {
  const [failed, setFailed] = useState(false);
  if (item.imageUrl && !failed) return <Image className="physical-product-thumb" src={item.imageUrl} alt="" width={48} height={48} unoptimized onError={() => setFailed(true)} />;
  return <ProductArt tone={item.imageTone} size="small" />;
}

function AverageEstimatedCover({ item, runways }: { item: PhysicalInventoryItem; runways: PhysicalInventoryRunways }) {
  if (!item.quantityKnown) return <span className="physical-cover-state">Count stock</span>;
  const estimates = ([30, 60, 90] as const).flatMap((windowDays) => {
    const unitsSold = (runways[item.id]?.dailySales.slice(-windowDays) ?? []).reduce((total, day) => total + day.shopify + day.tiktok, 0);
    if (unitsSold === 0) return [];
    return [{ windowDays, days: Math.max(1, Math.floor(item.quantity / (unitsSold / windowDays))) }];
  });
  if (estimates.length === 0) return <span className="physical-cover-state">No mapped sales</span>;
  const averageDays = Math.floor(estimates.reduce((total, estimate) => total + estimate.days, 0) / estimates.length);
  const breakdown = estimates.map((estimate) => `${estimate.windowDays}d: ${estimate.days.toLocaleString()} days`).join(" · ");
  return <span className="physical-cover-value" title={`Average of mapped-sales cover estimates — ${breakdown}`}><strong>{averageDays.toLocaleString()} days</strong><small>{estimates.length === 3 ? "30 / 60 / 90-day average" : "Average of available periods"}</small></span>;
}

export function PhysicalInventoryWorkspace({ initial, initialShopifyListings, initialTikTokListings, initialRunways }: { initial: PhysicalInventoryItem[]; initialShopifyListings: PhysicalChannelListing[]; initialTikTokListings: PhysicalChannelListing[]; initialRunways: PhysicalInventoryRunways }) {
  const [items, setItems] = useState(initial);
  const [activeChannel, setActiveChannel] = useState<"master" | PhysicalChannel>("master");
  const [channelListings, setChannelListings] = useState<Record<PhysicalChannel, PhysicalChannelListing[]>>({ shopify: initialShopifyListings, tiktok: initialTikTokListings });
  const [query, setQuery] = useState("");
  const [visibleColumns, setVisibleColumns] = useState<ProductColumn[]>(defaultColumns);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const visible = useMemo(() => {
    const text = query.trim().toLowerCase();
    return text ? items.filter((item) => `${item.title} ${item.variantLabel} ${item.packagingType}`.toLowerCase().includes(text)) : items;
  }, [items, query]);
  const selectedItems = items.filter((item) => selectedIds.includes(item.id));
  const allVisibleSelected = visible.length > 0 && visible.every((item) => selectedIds.includes(item.id));
  const has = (column: ProductColumn) => visibleColumns.includes(column);
  const toggle = (column: ProductColumn) => setVisibleColumns((current) => current.includes(column) ? current.filter((id) => id !== column) : [...current, column]);
  const toggleItem = (id: string) => setSelectedIds((current) => current.includes(id) ? current.filter((currentId) => currentId !== id) : [...current, id]);
  const toggleVisible = () => setSelectedIds((current) => allVisibleSelected ? current.filter((id) => !visible.some((item) => item.id === id)) : [...new Set([...current, ...visible.map((item) => item.id)])]);
  const toggleExpanded = (id: string) => setExpandedIds((current) => current.includes(id) ? current.filter((currentId) => currentId !== id) : [...current, id]);
  const applyChanges = (changes: { variantId: string; itemId: string; after: number; quantityKnown: true }[]) => {
    const changeByVariant = new Map(changes.map((change) => [change.variantId, change]));
    setItems((current) => current.map((item) => {
      const variants = item.variants.map((variant) => {
        const change = changeByVariant.get(variant.id);
        return change ? { ...variant, quantity: change.after, quantityKnown: true } : variant;
      });
      const changed = variants.some((variant, index) => variant !== item.variants[index]);
      return changed ? { ...item, variants, quantity: variants.reduce((total, variant) => total + variant.quantity, 0), quantityKnown: variants.every((variant) => variant.quantityKnown) } : item;
    }));
    setSelectedIds([]);
  };
  const applyMapping = (channel: PhysicalChannel, listings: PhysicalChannelListing[]) => setChannelListings((current) => ({ ...current, [channel]: listings }));

  return (
    <section className="workspace workspace--inventory ci-workspace physical-inventory-workspace">
      <header className="workspace-header">
        <div>
          <h1>{activeChannel === "master" ? "Master inventory" : `${activeChannel === "shopify" ? "Shopify" : "TikTok"} inventory`}</h1>
          {activeChannel !== "master" && <p className="workspace-description">Listings and their master inventory mappings.</p>}
        </div>
      </header>

      <div className="physical-inventory-tabs" role="tablist" aria-label="Choose an inventory catalogue">
        <button type="button" role="tab" aria-selected={activeChannel === "master"} className={activeChannel === "master" ? "is-active" : ""} onClick={() => setActiveChannel("master")}><span className="physical-master-mark"><Package size={16} /></span><span><strong>Master inventory</strong><small>Physical catalogue</small></span></button>
        <button type="button" role="tab" aria-selected={activeChannel === "shopify"} className={activeChannel === "shopify" ? "is-active" : ""} onClick={() => setActiveChannel("shopify")}><ChannelMark channel="shopify" size={31} /><span><strong>Shopify inventory</strong><small>Channel listings</small></span></button>
        <button type="button" role="tab" aria-selected={activeChannel === "tiktok"} className={activeChannel === "tiktok" ? "is-active" : ""} onClick={() => setActiveChannel("tiktok")}><ChannelMark channel="tiktok" size={31} /><span><strong>TikTok inventory</strong><small>Channel listings</small></span></button>
      </div>

      {activeChannel === "master" ? <Card className="physical-products-card">
        <CardHeader className="physical-products-card__header">
          <div>
            <CardTitle>Product catalogue</CardTitle>
            <CardDescription>{items.length} products</CardDescription>
          </div>
          <TableColumnPicker columns={columns} visibleColumns={visibleColumns} onToggle={toggle} onReset={() => setVisibleColumns(defaultColumns)} />
        </CardHeader>
        <CardContent className="physical-products-card__content">
          <div className="physical-products-toolbar">
            <label className="search-field search-field--inventory"><Search size={18} strokeWidth={1.8} aria-hidden="true" /><span className="sr-only">Search master inventory</span><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search master inventory" /></label>
            <div className="physical-products-toolbar__actions">{(selectedItems.length > 0 || query.trim()) && <span className="ci-count">{selectedItems.length ? `${selectedItems.length} selected` : `${visible.length} shown`}</span>}{selectedItems.length > 0 && <PhysicalInventoryAdjustSheet items={selectedItems} triggerLabel={`Update ${selectedItems.length} product${selectedItems.length === 1 ? "" : "s"}`} onSaved={applyChanges} />}</div>
          </div>
          <Table className="physical-products-table">
            <TableHeader><TableRow>
              <TableHead className="physical-products-select"><input type="checkbox" aria-label="Select all shown products" checked={allVisibleSelected} onChange={toggleVisible} /></TableHead>
              {has("product") && <TableHead>Product name</TableHead>}
              {has("variants") && <TableHead>Variants / size</TableHead>}
              {has("stock") && <TableHead>Stock</TableHead>}
              {has("averageEstimatedCover") && <TableHead>Average estimated cover</TableHead>}
              <TableHead><span className="sr-only">Open details</span></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {visible.map((item) => <Fragment key={item.id}>
                <TableRow className={`physical-products-row${expandedIds.includes(item.id) ? " is-expanded" : ""}`}>
                  <TableCell className="physical-products-select"><input type="checkbox" aria-label={`Select ${item.title}`} checked={selectedIds.includes(item.id)} onChange={() => toggleItem(item.id)} /></TableCell>
                  {has("product") && <TableCell><Link className="physical-product-link" href={`/inventory/products/${item.id}`}><ProductThumbnail item={item} /><span><strong>{item.title}</strong></span></Link></TableCell>}
                  {has("variants") && <TableCell className="ci-muted">{item.variantCount > 1 ? `${item.variantCount} variants` : item.variantLabel || "—"}</TableCell>}
                  {has("stock") && <TableCell>{item.quantityKnown ? <strong>{item.quantity}</strong> : <span className="physical-count-unknown">Not counted</span>}</TableCell>}
                  {has("averageEstimatedCover") && <TableCell><AverageEstimatedCover item={item} runways={initialRunways} /></TableCell>}
                  <TableCell className="physical-products-open"><button type="button" aria-label={`${expandedIds.includes(item.id) ? "Collapse" : "Expand"} ${item.title} variants`} aria-expanded={expandedIds.includes(item.id)} onClick={() => toggleExpanded(item.id)}><ChevronDownIcon /></button></TableCell>
                </TableRow>
                {expandedIds.includes(item.id) && <TableRow className="physical-products-variants-row"><td className="shadcn-table__cell" colSpan={visibleColumns.length + 2}><div className="physical-products-variants"><div className="physical-products-variants__heading"><div><strong>Variants</strong><span>{item.variantCount} {item.variantCount === 1 ? "variant" : "variants"}</span></div><div><PhysicalInventoryAdjustSheet items={[item]} onSaved={applyChanges} /><Link href={`/inventory/products/${item.id}`}>Open full details</Link></div></div><div className="physical-products-variants__grid">{item.variants.map((variant) => <div key={variant.id}><span>{variant.title}</span><small>{variant.sku || "No SKU"}</small><b>{variant.quantityKnown ? variant.quantity : "Not counted"}</b></div>)}</div></div></td></TableRow>}
              </Fragment>)}
            </TableBody>
          </Table>
          <div className="mobile-record-list physical-products-mobile-list" aria-label="Master inventory products">
            {visible.map((item) => (
              <article className="mobile-record mobile-physical-product-card" key={item.id}>
                <header className="mobile-physical-product-card__header">
                  <input type="checkbox" aria-label={`Select ${item.title}`} checked={selectedIds.includes(item.id)} onChange={() => toggleItem(item.id)} />
                  <Link className="mobile-product-title" href={`/inventory/products/${item.id}`}>
                    <ProductThumbnail item={item} />
                    <span><strong>{item.title}</strong><small>{item.variantCount > 1 ? `${item.variantCount} variants` : item.variantLabel || "—"}</small></span>
                  </Link>
                </header>
                <div className="mobile-inventory-card__metrics">
                  <span><small>Stock</small><strong className="quantity-cell">{item.quantityKnown ? item.quantity : "—"}</strong></span>
                  <span><small>Variants</small><strong>{item.variantCount}</strong></span>
                  <span><small>Cover</small><AverageEstimatedCover item={item} runways={initialRunways} /></span>
                </div>
                <Link className="mobile-physical-product-card__open" href={`/inventory/products/${item.id}`}>View product</Link>
              </article>
            ))}
          </div>
          {visible.length === 0 && <div className="table-empty">No master inventory products match that search.</div>}
        </CardContent>
      </Card> : <PhysicalChannelListings channel={activeChannel} listings={channelListings[activeChannel]} items={items} onSaved={(listings) => applyMapping(activeChannel, listings)} />}
    </section>
  );
}
