"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { CalendarDays, ChartNoAxesCombined, Clock3, ImageOff, Info, Package, Pencil, Plus, Store, Tag, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PhysicalInventoryAdjustSheet } from "@/components/physical-inventory-adjust-sheet";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { channelProductDetailHref, listingVariantLabel, mappingStatusLabel } from "@/lib/physical-channel-products";
import type { PhysicalChannelListing, PhysicalInventoryRunway, PhysicalInventoryVariant, PhysicalProductDetail } from "@/lib/types";

function ProductImage({ src, title }: { src: string | null; title: string }) {
  const [failed, setFailed] = useState(false);
  if (src && !failed) return <Image className="physical-reference-image" src={src} alt={title} width={720} height={720} unoptimized onError={() => setFailed(true)} />;
  return <div className="physical-reference-image physical-reference-image--empty"><ImageOff size={25} /><span>No source image yet</span></div>;
}

function productFacts(product: PhysicalProductDetail) {
  return [
    { label: "Packaging", value: product.packagingType, Icon: Package },
    { label: "Lead time", value: product.leadTimeDays ? `${product.leadTimeDays} days` : "Not set", Icon: Clock3 },
  ];
}

function variantSku(variant: PhysicalInventoryVariant) {
  return variant.sku || "—";
}

function shadeClass(title: string) {
  return `variant-dot variant-dot--${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

type RunwayChannel = "all" | "shopify" | "tiktok";
type RunwayWindow = 30 | 60 | 90;

function formatRunwayDate(date: Date) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function formatChartDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(`${value}T00:00:00Z`));
}

function InventoryRunway({ product, runway }: { product: PhysicalProductDetail; runway: PhysicalInventoryRunway }) {
  const [channel, setChannel] = useState<RunwayChannel>("all");
  const [windowDays, setWindowDays] = useState<RunwayWindow>(30);
  const chartColor = channel === "shopify" ? "#4e8540" : channel === "tiktok" ? "#b13561" : "#6c285f";
  const channelLabel = channel === "all" ? "combined channels" : channel === "shopify" ? "Shopify" : "TikTok Shop";
  const dailySales = useMemo(() => runway.dailySales.slice(-windowDays).map((day) => ({
    ...day,
    units: channel === "all" ? day.shopify + day.tiktok : day[channel],
  })), [channel, runway.dailySales, windowDays]);
  const unitsSold = dailySales.reduce((total, day) => total + day.units, 0);
  const dailyRate = unitsSold / windowDays;
  const daysOfCover = product.quantityKnown && dailyRate > 0 ? product.quantity / dailyRate : null;
  const estimatedRunout = daysOfCover === null ? null : new Date(new Date(runway.generatedAt).getTime() + Math.ceil(daysOfCover) * 86_400_000);
  const status = !product.quantityKnown
    ? { title: "Count stock to estimate cover", detail: "This product has an uncounted variant, so the master quantity is not yet reliable." }
    : unitsSold === 0
      ? { title: "No mapped sales in this window", detail: `No net ${channelLabel} withdrawals were recorded in the last ${windowDays} days.` }
      : null;

  return <section className="physical-runway" aria-labelledby="inventory-runway-title">
    <div className="physical-runway__header">
      <div><h2 id="inventory-runway-title">Inventory runway</h2><p>Estimated time this physical stock will last at its recent mapped sales pace.</p></div>
      <div className="physical-runway__controls" aria-label="Inventory runway controls">
        <div className="physical-runway__segment" role="group" aria-label="Demand source">
          {(["all", "shopify", "tiktok"] as const).map((option) => <button key={option} type="button" className={channel === option ? "is-active" : ""} aria-pressed={channel === option} onClick={() => setChannel(option)}>{option === "all" ? "Combined" : option === "shopify" ? "Shopify" : "TikTok"}</button>)}
        </div>
        <div className="physical-runway__segment" role="group" aria-label="Sales history window">
          {([30, 60, 90] as const).map((option) => <button key={option} type="button" className={windowDays === option ? "is-active" : ""} aria-pressed={windowDays === option} onClick={() => setWindowDays(option)}>{option}d</button>)}
        </div>
      </div>
    </div>
    <div className="physical-runway__body">
      <div className="physical-runway__result">
        {status ? <div className="physical-runway__unavailable"><ChartNoAxesCombined size={22} /><strong>{status.title}</strong><p>{status.detail}</p></div> : <>
          <span className="physical-runway__label">Estimated cover</span>
          <strong className="physical-runway__days">{Math.max(1, Math.floor(daysOfCover!))}<small>days</small></strong>
          <p className="physical-runway__date"><CalendarDays size={14} />Likely to run out around {formatRunwayDate(estimatedRunout!)}</p>
        </>}
        <dl className="physical-runway__inputs">
          <div><dt>Master stock <Info size={13} aria-hidden="true" /></dt><dd>{product.quantityKnown ? `${product.quantity.toLocaleString()} units` : "Not counted"}</dd></div>
          <div><dt>Net units sold <Info size={13} aria-hidden="true" /></dt><dd>{unitsSold.toLocaleString()} units in {windowDays} days</dd></div>
          <div><dt>Daily pace <Info size={13} aria-hidden="true" /></dt><dd>{dailyRate ? `${dailyRate.toFixed(2)} units/day` : "No sales data"}</dd></div>
        </dl>
      </div>
      <div className="physical-runway__trend">
        <div className="physical-runway__trend-heading"><div><strong>{channel === "all" ? "Sales trend" : `${channelLabel} sales trend`}</strong><span>Net mapped physical units sold per day</span></div><span className="physical-runway__source"><Store size={13} />{channelLabel}</span></div>
        {unitsSold > 0 ? <div className="physical-runway__chart" role="img" aria-label={`${unitsSold} mapped units sold from ${channelLabel} in the last ${windowDays} days`}><ResponsiveContainer width="100%" height="100%"><BarChart data={dailySales} margin={{ top: 12, right: 6, left: -20, bottom: 0 }}><CartesianGrid vertical={false} stroke="#eee3e6" /><XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={34} tickMargin={9} tick={{ fill: "#8a747e", fontSize: 10 }} tickFormatter={formatChartDate} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} tick={{ fill: "#8a747e", fontSize: 10 }} /><Tooltip cursor={{ fill: "#f9f1f4" }} contentStyle={{ border: "1px solid #e1d2d7", borderRadius: 7, background: "#fffefd", boxShadow: "0 12px 30px rgba(74, 33, 57, .11)", fontSize: 11 }} labelFormatter={(value) => typeof value === "string" ? formatChartDate(value) : ""} formatter={(value) => [`${Number(value).toLocaleString()} units`, "Net sold"]} /><Bar dataKey="units" fill={chartColor} radius={[3, 3, 0, 0]} maxBarSize={18} /></BarChart></ResponsiveContainer></div> : <div className="physical-runway__chart-empty"><p>No chart is shown until a mapped sale is reconciled for this product.</p></div>}
      </div>
    </div>
  </section>;
}

export function PhysicalProductDetailWorkspace({ initial, channelListings, runway }: { initial: PhysicalProductDetail; channelListings: PhysicalChannelListing[]; runway: PhysicalInventoryRunway }) {
  const router = useRouter();
  const [product, setProduct] = useState(initial);
  const [editNameOpen, setEditNameOpen] = useState(false);
  const [addVariantOpen, setAddVariantOpen] = useState(false);
  const [editVariantOpen, setEditVariantOpen] = useState(false);
  const [variantBeingEdited, setVariantBeingEdited] = useState<PhysicalInventoryVariant | null>(null);
  const [draftTitle, setDraftTitle] = useState(initial.title);
  const [variantTitle, setVariantTitle] = useState("");
  const [variantSkuValue, setVariantSkuValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const facts = productFacts(product);
  const mappings = useMemo(() => channelListings.flatMap((listing) => listing.components.filter((component) => component.itemId === product.id).map((component) => ({ listing, component }))), [channelListings, product.id]);
  const hasMappings = mappings.length > 0;
  const updateProduct = async (method: "PATCH" | "POST" | "DELETE", payload?: Record<string, string>) => {
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/inventory/physical/products/${product.id}`, { method, headers: payload ? { "Content-Type": "application/json" } : undefined, body: payload ? JSON.stringify(payload) : undefined });
      const result = await response.json().catch(() => null) as { ok?: boolean; message?: string; product?: PhysicalProductDetail } | null;
      if (!response.ok || !result?.ok) throw new Error(result?.message || "Unable to save changes");
      if (result.product) setProduct(result.product);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save changes");
      return false;
    } finally {
      setSaving(false);
    }
  };
  const saveName = async () => { if (await updateProduct("PATCH", { title: draftTitle })) setEditNameOpen(false); };
  const saveVariant = async () => { if (await updateProduct("POST", { title: variantTitle, sku: variantSkuValue })) { setAddVariantOpen(false); setVariantTitle(""); setVariantSkuValue(""); } };
  const updateVariant = async (variantId: string, method: "PATCH" | "DELETE", payload?: Record<string, string>) => {
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/inventory/physical/variants/${variantId}`, { method, headers: payload ? { "Content-Type": "application/json" } : undefined, body: payload ? JSON.stringify(payload) : undefined });
      const result = await response.json().catch(() => null) as { ok?: boolean; message?: string; product?: PhysicalProductDetail } | null;
      if (!response.ok || !result?.ok) throw new Error(result?.message || "Unable to save variant");
      if (result.product) setProduct(result.product);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save variant");
      return false;
    } finally {
      setSaving(false);
    }
  };
  const saveVariantEdit = async () => { if (variantBeingEdited && await updateVariant(variantBeingEdited.id, "PATCH", { title: variantTitle, sku: variantSkuValue })) { setEditVariantOpen(false); setVariantBeingEdited(null); } };
  const deleteVariant = async (variant: PhysicalInventoryVariant) => {
    const mapped = mappings.some(({ component }) => component.physicalVariantId === variant.id);
    if (mapped || !window.confirm(`Delete the ${variant.title} variant?`)) return;
    await updateVariant(variant.id, "DELETE");
  };
  const deleteProduct = async () => {
    if (hasMappings || !window.confirm(`Delete ${product.title}? This removes it from master inventory.`)) return;
    if (await updateProduct("DELETE")) { router.push("/inventory/products"); router.refresh(); }
  };
  const applyChanges = (changes: { variantId: string; after: number; quantityKnown: true }[]) => {
    const changeByVariant = new Map(changes.map((change) => [change.variantId, change]));
    setProduct((current) => {
      const variants = current.variants.map((variant) => {
        const change = changeByVariant.get(variant.id);
        return change ? { ...variant, quantity: change.after, quantityKnown: true } : variant;
      });
      return { ...current, variants, quantity: variants.reduce((total, variant) => total + variant.quantity, 0), quantityKnown: variants.every((variant) => variant.quantityKnown) };
    });
  };

  return <section className="physical-reference-page"><main className="physical-reference-main">
    <div className="physical-reference-breadcrumb-row"><Breadcrumb><BreadcrumbList><BreadcrumbItem><BreadcrumbLink href="/inventory">Inventory</BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbLink href="/inventory/products">Products</BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbPage>{product.title}</BreadcrumbPage></BreadcrumbItem></BreadcrumbList></Breadcrumb></div>
    <div className="physical-reference-hero"><header className="physical-reference-summary"><div className="physical-reference-title-row"><h1>{product.title}</h1></div><p className="physical-reference-variant-label"><Tag size={15} aria-hidden="true" />{product.variantCount} {product.variantCount === 1 ? "variant" : "variants"}</p><dl className="physical-reference-facts">{facts.map(({ label, value, Icon }) => <div key={label}><dt><Icon size={15} aria-hidden="true" />{label}:</dt><dd>{value}</dd></div>)}</dl><div className="physical-reference-actions"><Button variant="outline" size="compact" onClick={() => { setDraftTitle(product.title); setError(""); setEditNameOpen(true); }}><Pencil size={14} />Edit name</Button><Button variant="ghost" size="compact" disabled={hasMappings || saving} onClick={deleteProduct}><Trash2 size={14} />Delete</Button></div>{hasMappings && <p className="physical-reference-action-note">Remove the channel mappings before deleting this product.</p>}</header><Card className="physical-reference-media"><CardContent><ProductImage src={product.imageUrl} title={product.title} /></CardContent></Card></div>
    <InventoryRunway product={product} runway={runway} />
    <Tabs defaultValue="variants" className="physical-reference-tabs"><TabsList><TabsTrigger value="variants">Variants</TabsTrigger><TabsTrigger value="mappings">Mappings</TabsTrigger></TabsList>
      <TabsContent value="variants"><Card className="physical-reference-table-card"><CardHeader><div className="physical-reference-table-heading"><CardTitle>Variants</CardTitle><span>{product.variantCount} total</span></div><div className="physical-reference-table-actions"><PhysicalInventoryAdjustSheet items={[product]} onSaved={applyChanges} /><Button variant="outline" size="compact" onClick={() => { setError(""); setAddVariantOpen(true); }}><Plus size={14} />Add variant</Button></div></CardHeader><CardContent><Table className="physical-reference-variant-table"><TableHeader><TableRow><TableHead>Variant</TableHead><TableHead>SKU</TableHead><TableHead>Stock</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader><TableBody>{product.variants.map((variant) => { const mapped = mappings.some(({ component }) => component.physicalVariantId === variant.id); return <TableRow key={variant.id}><TableCell><span className="physical-reference-shade"><i className={shadeClass(variant.title)} />{variant.title}</span></TableCell><TableCell>{variantSku(variant)}</TableCell><TableCell>{variant.quantityKnown ? variant.quantity : "Not counted"}</TableCell><TableCell><div className="physical-reference-variant-actions"><Button variant="ghost" size="compact" onClick={() => { setVariantBeingEdited(variant); setVariantTitle(variant.title); setVariantSkuValue(variant.sku || ""); setError(""); setEditVariantOpen(true); }}>Edit</Button><Button variant="ghost" size="compact" disabled={mapped || saving} title={mapped ? "Remove mappings before deleting this variant" : undefined} onClick={() => deleteVariant(variant)}><Trash2 size={14} /></Button></div></TableCell></TableRow>; })}</TableBody></Table></CardContent></Card></TabsContent>
      <TabsContent value="mappings"><Card className="physical-reference-table-card physical-reference-mappings-card"><CardHeader><div className="physical-reference-table-heading"><CardTitle>Mappings</CardTitle><span>{mappings.length} variant mapping{mappings.length === 1 ? "" : "s"}</span></div></CardHeader><CardContent>{mappings.length ? <Table><TableHeader><TableRow><TableHead>Channel</TableHead><TableHead>Listing</TableHead><TableHead>Channel variant</TableHead><TableHead>Uses this variant</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{mappings.map(({ listing, component }) => <TableRow key={component.id}><TableCell><span className={`physical-channel-name physical-channel-name--${listing.channel}`}>{listing.channel === "shopify" ? "Shopify" : "TikTok Shop"}</span></TableCell><TableCell><Link className="physical-detail-link" href={channelProductDetailHref(listing.channel, listing.externalProductId)}>{listing.title}</Link></TableCell><TableCell>{listingVariantLabel(listing)}</TableCell><TableCell>{component.variantTitle} · {component.quantityPerSale}×</TableCell><TableCell><span className={`physical-mapping-status physical-mapping-status--${listing.mappingStatus}`}>{mappingStatusLabel(listing.mappingStatus)}</span></TableCell></TableRow>)}</TableBody></Table> : <div className="physical-detail-empty"><strong>No channel mappings yet.</strong><p>Map Shopify or TikTok variants to this product from their respective inventory tables.</p></div>}</CardContent></Card></TabsContent>
    </Tabs>
    <Dialog open={editNameOpen} onOpenChange={setEditNameOpen}><DialogContent className="physical-product-edit-dialog"><DialogTitle>Edit product name</DialogTitle><DialogDescription>Use the name your team will recognise in master inventory.</DialogDescription><label htmlFor="physical-product-name">Product name</label><Input id="physical-product-name" value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} autoFocus />{error && editNameOpen && <p className="physical-product-form-error">{error}</p>}<div className="physical-product-dialog-actions"><DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose><Button variant="primary" disabled={saving || !draftTitle.trim()} onClick={saveName}>{saving ? "Saving…" : "Save name"}</Button></div></DialogContent></Dialog>
    <Dialog open={addVariantOpen} onOpenChange={setAddVariantOpen}><DialogContent className="physical-product-edit-dialog"><DialogTitle>Add variant</DialogTitle><DialogDescription>New variants start with no counted stock until you enter a quantity.</DialogDescription><label htmlFor="physical-variant-name">Variant name</label><Input id="physical-variant-name" value={variantTitle} onChange={(event) => setVariantTitle(event.target.value)} autoFocus /><label htmlFor="physical-variant-sku">SKU <span>Optional</span></label><Input id="physical-variant-sku" value={variantSkuValue} onChange={(event) => setVariantSkuValue(event.target.value)} />{error && addVariantOpen && <p className="physical-product-form-error">{error}</p>}<div className="physical-product-dialog-actions"><DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose><Button variant="primary" disabled={saving || !variantTitle.trim()} onClick={saveVariant}>{saving ? "Adding…" : "Add variant"}</Button></div></DialogContent></Dialog>
    <Dialog open={editVariantOpen} onOpenChange={setEditVariantOpen}><DialogContent className="physical-product-edit-dialog"><DialogTitle>Edit variant</DialogTitle><DialogDescription>Rename the variant or update its SKU.</DialogDescription><label htmlFor="edit-physical-variant-name">Variant name</label><Input id="edit-physical-variant-name" value={variantTitle} onChange={(event) => setVariantTitle(event.target.value)} autoFocus /><label htmlFor="edit-physical-variant-sku">SKU <span>Optional</span></label><Input id="edit-physical-variant-sku" value={variantSkuValue} onChange={(event) => setVariantSkuValue(event.target.value)} />{error && editVariantOpen && <p className="physical-product-form-error">{error}</p>}<div className="physical-product-dialog-actions"><DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose><Button variant="primary" disabled={saving || !variantTitle.trim()} onClick={saveVariantEdit}>{saving ? "Saving…" : "Save variant"}</Button></div></DialogContent></Dialog>
  </main></section>;
}
