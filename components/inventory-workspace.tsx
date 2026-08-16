"use client";

import { ChevronLeft, ChevronRight, Download, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { ProductArt } from "@/components/product-art";
import { SyncButton } from "@/components/sync-button";
import { TableColumnPicker, type TableColumn } from "@/components/table-column-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { relativeTime } from "@/lib/format";
import type { InventorySnapshot, ProductInventory } from "@/lib/types";

type InventoryFilter = "all" | "reorder" | "low";
type InventoryColumnId = "variants" | "quantity" | "sold" | "leadTime" | "packaging" | "box" | "onHandBoxes" | "status";
type ProductVariant = Omit<ProductInventory, "mapping" | "mappingConfidence">;
type InventoryProduct = {
  id: string;
  product: string;
  variants: ProductVariant[];
  quantity: number;
  sold7d: number;
  sold30d: number;
  leadTime: string;
  packagingType: string;
  unitsPerBox: number;
  onHandBoxes: number | "Varies";
  status: "In stock" | "Low stock" | "Reorder now";
  imageTone: ProductVariant["imageTone"];
};

const filters: { label: string; value: InventoryFilter }[] = [
  { label: "All products", value: "all" },
  { label: "Reorder now", value: "reorder" },
  { label: "Low stock", value: "low" },
];

const columns: TableColumn<InventoryColumnId>[] = [
  { id: "variants", label: "Variants" },
  { id: "quantity", label: "Shopify qty" },
  { id: "sold", label: "Sold 7d" },
  { id: "leadTime", label: "Lead time" },
  { id: "packaging", label: "Packaging" },
  { id: "box", label: "Units / box" },
  { id: "onHandBoxes", label: "On-hand boxes" },
  { id: "status", label: "Status" },
];

const defaultVisibleColumns = columns.map((column) => column.id);

export function InventoryWorkspace({ initialInventory }: { initialInventory: Pick<InventorySnapshot, "sync"> & { products: ProductVariant[] } }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<InventoryFilter>("all");
  const [selectedId, setSelectedId] = useState("");
  const [visibleColumns, setVisibleColumns] = useState<InventoryColumnId[]>(defaultVisibleColumns);
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);
  const inventoryProducts = useMemo(() => groupProducts(initialInventory.products), [initialInventory.products]);
  const syncCaption = initialInventory.sync.lastSyncedAt
    ? `Synced ${relativeTime(initialInventory.sync.lastSyncedAt)}`
    : initialInventory.sync.message;
  const filteredProducts = useMemo(() => {
    const text = query.trim().toLowerCase();
    return inventoryProducts.filter((product) => {
      const matchesText = !text || [product.product, ...product.variants.flatMap((variant) => [variant.variant, variant.sku])]
        .join(" ")
        .toLowerCase()
        .includes(text);
      const matchesFilter = filter === "all"
        || (filter === "reorder" && product.status === "Reorder now")
        || (filter === "low" && (product.status === "Low stock" || product.status === "Reorder now"));
      return matchesText && matchesFilter;
    });
  }, [filter, inventoryProducts, query]);
  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = filteredProducts.length === 0 ? 0 : (currentPage - 1) * pageSize;
  const pageEnd = Math.min(pageStart + pageSize, filteredProducts.length);
  const visibleProducts = filteredProducts.slice(pageStart, pageEnd);
  const selectedProduct = inventoryProducts.find((product) => product.id === selectedId);
  const pageItems = getPageItems(currentPage, totalPages);

  function resetPage() {
    setPage(1);
  }

  function setColumnVisibility(column: InventoryColumnId) {
    setVisibleColumns((current) => current.includes(column) ? current.filter((item) => item !== column) : [...current, column]);
  }

  function exportInventory() {
    const rows = [["Product", "Variant", "SKU", "Shopify quantity", "Sold 7d", "Sold 30d", "Lead time", "Packaging", "Units per box", "On-hand boxes"], ...initialInventory.products.map((product) => [product.product, product.variant, product.sku, product.quantity, product.sold7d, product.sold30d, product.leadTime, product.packagingType, product.unitsPerBox, product.onHandBoxes])];
    const csv = rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "serenity-hue-products.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="workspace workspace--inventory">
      <header className="workspace-header">
        <div>
          <p className="workspace-kicker">Inventory</p>
          <h1>Products</h1>
          <div className="live-caption"><span>{initialInventory.sync.status === "healthy" ? "Live quantity from Shopify" : "Shopify inventory needs attention"}</span><span aria-hidden="true">·</span><span>{syncCaption}</span><span className={`live-dot live-dot--${initialInventory.sync.status}`} aria-hidden="true" /></div>
        </div>
        <div className="header-actions">
          <SyncButton />
          <Button variant="outline" onClick={exportInventory}><Download size={17} />Export products</Button>
        </div>
      </header>

      <div className="orders-table-frame inventory-table-frame">
        <div className="inventory-toolbar">
          <label className="search-field search-field--inventory"><Search size={18} strokeWidth={1.8} aria-hidden="true" /><span className="sr-only">Search products or SKUs</span><Input value={query} onChange={(event) => { setQuery(event.target.value); resetPage(); }} placeholder="Search product or SKU" /></label>
        </div>
        <div className="inventory-tabs">
          <div role="tablist" aria-label="Product inventory filter">
            {filters.map((item) => <button key={item.value} type="button" role="tab" aria-selected={filter === item.value} className={filter === item.value ? "is-selected" : ""} onClick={() => { setFilter(item.value); resetPage(); }}>{item.label}</button>)}
          </div>
          <TableColumnPicker columns={columns} visibleColumns={visibleColumns} onToggle={setColumnVisibility} onReset={() => setVisibleColumns(defaultVisibleColumns)} />
        </div>
        <div className="inventory-scroll">
          <table className="inventory-table">
            <thead><tr><th>Product</th>{visibleColumns.includes("variants") && <th>Variants</th>}{visibleColumns.includes("quantity") && <th>Shopify qty</th>}{visibleColumns.includes("sold") && <th>Sold 7d</th>}{visibleColumns.includes("leadTime") && <th>Lead time</th>}{visibleColumns.includes("packaging") && <th>Packaging</th>}{visibleColumns.includes("box") && <th>Units / box</th>}{visibleColumns.includes("onHandBoxes") && <th>On-hand boxes</th>}{visibleColumns.includes("status") && <th>Status</th>}<th><span className="sr-only">View product variants</span></th></tr></thead>
            <tbody>{visibleProducts.map((product) => <InventoryRow key={product.id} product={product} selected={selectedProduct?.id === product.id} onSelect={() => setSelectedId(product.id)} visibleColumns={visibleColumns} />)}</tbody>
          </table>
        </div>
        <div className="mobile-record-list mobile-inventory-list" aria-label="Products">
          {visibleProducts.map((product) => (
            <button className={selectedProduct?.id === product.id ? "mobile-record mobile-inventory-card is-selected" : "mobile-record mobile-inventory-card"} key={product.id} onClick={() => setSelectedId(product.id)} type="button">
              <span className="mobile-record__header"><span className="mobile-product-title"><ProductArt tone={product.imageTone} size="small" /><span><strong>{product.product}</strong><small>{product.variants.length} {product.variants.length === 1 ? "variant" : "variants"}</small></span></span><ChevronRight aria-hidden="true" size={18} /></span>
              <span className="mobile-inventory-card__metrics"><span><small>Shopify qty</small><strong className={product.status === "In stock" ? "quantity-cell" : "quantity-cell quantity-cell--low"}>{product.quantity}</strong></span><span><small>Sold 7d</small><strong>{product.sold7d || "—"}</strong></span><span><small>Lead time</small><strong>{product.leadTime}</strong></span></span>
              <span className="mobile-record__footer"><span className="mobile-inventory-card__packaging">{product.packagingType}</span><StockStatus status={product.status} /></span>
            </button>
          ))}
        </div>
        {filteredProducts.length === 0 && <div className="table-empty">No products match those filters.</div>}
        <footer className="table-footer">
          <div className="page-size-control"><Select value={String(pageSize)} onValueChange={(value) => { setPageSize(Number(value)); resetPage(); }}><SelectTrigger aria-label="Products per page"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="25">25 per page</SelectItem><SelectItem value="40">40 per page</SelectItem><SelectItem value="50">50 per page</SelectItem></SelectContent></Select></div>
          <div className="pagination" aria-label="Products pagination"><span className="pagination-summary">{pageStart + (filteredProducts.length ? 1 : 0)}–{pageEnd} of {filteredProducts.length}</span><button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={currentPage === 1} aria-label="Previous page"><ChevronLeft size={16} /></button>{pageItems.map((item, index) => item === "ellipsis" ? <span className="pagination-ellipsis" key={`ellipsis-${index}`}>…</span> : <button type="button" key={item} className={item === currentPage ? "is-current" : ""} aria-current={item === currentPage ? "page" : undefined} onClick={() => setPage(item)}>{item}</button>)}<button type="button" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={currentPage === totalPages} aria-label="Next page"><ChevronRight size={16} /></button></div>
        </footer>
      </div>

      <Sheet open={Boolean(selectedProduct)} onOpenChange={(open) => !open && setSelectedId("")}>
        <SheetContent className="inventory-sheet" aria-describedby="inventory-sheet-description">
          {selectedProduct && <InventoryDetails product={selectedProduct} />}
        </SheetContent>
      </Sheet>
    </section>
  );
}

function InventoryRow({ product, selected, onSelect, visibleColumns }: { product: InventoryProduct; selected: boolean; onSelect: () => void; visibleColumns: InventoryColumnId[] }) {
  const attention = product.status === "Low stock" || product.status === "Reorder now";
  return <tr className={selected ? "is-selected" : ""} onClick={onSelect} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(); } }} tabIndex={0}>
    <td className="inventory-product"><ProductArt tone={product.imageTone} size="small" /><span>{product.product}<small>{product.variants.length} {product.variants.length === 1 ? "variant" : "variants"} · View distribution</small></span></td>
    {visibleColumns.includes("variants") && <td>{product.variants.length}</td>}
    {visibleColumns.includes("quantity") && <td className={attention ? "quantity-cell quantity-cell--low" : "quantity-cell"}>{product.quantity}</td>}
    {visibleColumns.includes("sold") && <td>{product.sold7d || "—"}</td>}
    {visibleColumns.includes("leadTime") && <td>{product.leadTime}</td>}
    {visibleColumns.includes("packaging") && <td>{product.packagingType}</td>}
    {visibleColumns.includes("box") && <td>{product.unitsPerBox || "Varies"}</td>}
    {visibleColumns.includes("onHandBoxes") && <td>{product.onHandBoxes === "Varies" ? product.onHandBoxes : formatBoxes(product.onHandBoxes)}</td>}
    {visibleColumns.includes("status") && <td><StockStatus status={product.status} /></td>}
    <td className="row-action"><ChevronRight size={18} aria-hidden="true" /></td>
  </tr>;
}

function InventoryDetails({ product }: { product: InventoryProduct }) {
  return <div className="inventory-details" aria-label={`Inventory details for ${product.product}`}>
    <div className="inventory-detail-header"><ProductArt tone={product.imageTone} /><div><p className="workspace-kicker">Product stock</p><SheetTitle asChild><h2>{product.product}</h2></SheetTitle><p>{product.variants.length} Shopify {product.variants.length === 1 ? "variant" : "variants"}</p></div></div>
    <SheetDescription id="inventory-sheet-description" className="sr-only">Variant-by-variant stock distribution for {product.product}.</SheetDescription>
    <div className="inventory-detail-metrics"><InventoryMetric label="Total units" value={product.quantity} /><InventoryMetric label="Sold in 7 days" value={product.sold7d} /></div>
    <section className="inventory-variant-section"><div className="inventory-variant-section__header"><h3>Variant stock distribution</h3><span>Shopify quantity</span></div><div className="inventory-variant-list">{product.variants.map((variant) => <VariantStockRow key={variant.id} variant={variant} />)}</div></section>
  </div>;
}

function InventoryMetric({ label, value }: { label: string; value: number | "—" }) {
  return <div><span>{label}</span><strong>{value}</strong>{value !== "—" && <small>{label === "Days of cover" ? "days" : "units"}</small>}</div>;
}

function VariantStockRow({ variant }: { variant: ProductVariant }) {
  const status = variant.reorderNow ? "Reorder now" : variant.isLowStock ? "Low stock" : "In stock";
  const attention = status === "Reorder now" || status === "Low stock";
  return <article className={`variant-stock-row ${attention ? "is-low" : ""}`}><div><strong>{variant.variant || "Default title"}</strong><span>{variant.sku || "No SKU"}</span></div><dl><div><dt>Shopify qty</dt><dd className={attention ? "quantity-cell quantity-cell--low" : "quantity-cell"}>{variant.quantity}</dd></div><div><dt>On-hand boxes</dt><dd>{formatBoxes(variant.onHandBoxes)}</dd></div><div><dt>Sold 7d</dt><dd>{variant.sold7d || "—"}</dd></div><div><dt>Sold 30d</dt><dd>{variant.sold30d || "—"}</dd></div><div><dt>Packaging</dt><dd>{variant.packagingType}</dd></div><div><dt>Lead time</dt><dd>{variant.leadTime}</dd></div></dl><StockStatus status={status} /></article>;
}

function StockStatus({ status }: { status: InventoryProduct["status"] }) {
  const tone = status === "Reorder now" || status === "Low stock" ? "low" : "confirmed";
  return <span className={`stock-status stock-status--${tone}`}><i />{status}</span>;
}

function groupProducts(variants: ProductVariant[]): InventoryProduct[] {
  const grouped = new Map<string, ProductVariant[]>();
  variants.forEach((variant) => grouped.set(variant.productId, [...(grouped.get(variant.productId) ?? []), variant]));
  return [...grouped.entries()].map(([id, productVariants]) => {
    const quantity = productVariants.reduce((total, variant) => total + variant.quantity, 0);
    const sold7d = productVariants.reduce((total, variant) => total + variant.sold7d, 0);
    const sold30d = productVariants.reduce((total, variant) => total + variant.sold30d, 0);
    const reorder = productVariants.some((variant) => variant.reorderNow);
    const low = productVariants.some((variant) => variant.isLowStock);
    const status: InventoryProduct["status"] = reorder ? "Reorder now" : low ? "Low stock" : "In stock";
    const leadTimes = [...new Set(productVariants.map((variant) => variant.leadTime).filter((leadTime) => leadTime !== "—"))];
    const packagingTypes = [...new Set(productVariants.map((variant) => variant.packagingType).filter((packagingType) => packagingType !== "Not set"))];
    const unitsPerBox = [...new Set(productVariants.map((variant) => variant.unitsPerBox))];
    const consistentUnitsPerBox = unitsPerBox.length === 1 ? unitsPerBox[0] : 0;
    return { id, product: productVariants[0]?.product ?? "Untitled product", variants: productVariants, quantity, sold7d, sold30d, leadTime: leadTimes.length === 0 ? "—" : leadTimes.length === 1 ? leadTimes[0] : "Varies", packagingType: packagingTypes.length === 0 ? "Not set" : packagingTypes.length === 1 ? packagingTypes[0] : "Varies", unitsPerBox: consistentUnitsPerBox, onHandBoxes: consistentUnitsPerBox ? quantity / consistentUnitsPerBox : "Varies", status, imageTone: productVariants[0]?.imageTone ?? "blush" };
  });
}

function formatBoxes(value: number) {
  return Number.isInteger(value) ? value : value.toFixed(1);
}

function getPageItems(currentPage: number, totalPages: number): (number | "ellipsis")[] {
  if (totalPages <= 6) return Array.from({ length: totalPages }, (_, index) => index + 1);
  const pages = new Set([1, totalPages, currentPage - 1, currentPage, currentPage + 1]);
  const ordered = [...pages].filter((page) => page >= 1 && page <= totalPages).sort((a, b) => a - b);
  const items: (number | "ellipsis")[] = [];
  ordered.forEach((item, index) => { if (index > 0 && item - ordered[index - 1] > 1) items.push("ellipsis"); items.push(item); });
  return items;
}
