"use client";

/* The product image is a Shopify CDN URL stored in the synced product record. */
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { ArrowLeft, ImageOff, Minus, Package, Plus, RotateCcw, Save } from "lucide-react";
import { useMemo, useState } from "react";
import { buttonVariants, Button } from "@/components/ui/button";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { compactTime, relativeTime } from "@/lib/format";
import type { ProductDetail, ProductDetailVariant } from "@/lib/types";

const numberFormat = new Intl.NumberFormat("en-GB");

function quantity(value: number | null) {
  return value === null ? "—" : numberFormat.format(value);
}

function variantTitle(value: string) {
  return value && value !== "Default Title" ? value : "Default variant";
}

function sourceTime(value: string | null) {
  return value ? `Updated ${relativeTime(value)}` : "No synced snapshot";
}

function ProductImage({ src, title }: { src: string | null; title: string }) {
  const [failed, setFailed] = useState(false);
  if (src && !failed) return <img className="product-detail__image" src={src} alt={`${title} product`} onError={() => setFailed(true)} />;
  return <span className="product-detail__image product-detail__image--empty" aria-label="No product image"><ImageOff size={24} /></span>;
}

function StockMetric({ label, value, detail, channel }: { label: string; value: string; detail: string; channel: "master" | "shopify" | "tiktok" }) {
  return <div className="product-detail-stock-metric" data-channel={channel}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

function masterValue(variant: ProductDetailVariant, drafts: Record<string, number>) {
  return variant.id in drafts ? drafts[variant.id] : variant.master;
}

export function ProductDetailWorkspace({ initial }: { initial: ProductDetail }) {
  const router = useRouter();
  const [variants, setVariants] = useState(initial.variants);
  const [drafts, setDrafts] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  const dirtyVariants = useMemo(() => variants.filter((variant) => variant.id in drafts && drafts[variant.id] !== (variant.master ?? 0)), [drafts, variants]);
  const totals = useMemo(() => {
    const masterValues = variants.map((variant) => masterValue(variant, drafts)).filter((value): value is number => value !== null);
    const tiktokValues = variants.map((variant) => variant.tiktok).filter((value): value is number => value !== null);
    const sold7d = variants.reduce((total, variant) => total + variant.sold7d, 0);
    const sold30d = variants.reduce((total, variant) => total + variant.sold30d, 0);
    const dailySalesRate = Math.max(sold7d / 7, sold30d / 30);
    const master = masterValues.length === 0 ? null : masterValues.reduce((total, value) => total + value, 0);
    return {
      master,
      shopify: variants.reduce((total, variant) => total + variant.shopify, 0),
      tiktok: tiktokValues.length === 0 && initial.tiktokProductLevel === null
        ? null
        : tiktokValues.reduce((total, value) => total + value, 0) + (initial.tiktokProductLevel ?? 0),
      sold7d,
      sold30d,
      dailySalesRate,
      daysCover: master !== null && dailySalesRate > 0 ? Math.ceil(master / dailySalesRate) : null,
    };
  }, [drafts, initial.tiktokProductLevel, variants]);

  const forecast = useMemo(() => {
    if (totals.master === null || totals.dailySalesRate <= 0) return [];
    return Array.from({ length: 31 }, (_, day) => ({
      day: day === 0 ? "Today" : `+${day}d`,
      stock: Math.max(0, Math.round(totals.master! - totals.dailySalesRate * day)),
    }));
  }, [totals.dailySalesRate, totals.master]);

  const forecastDemandPercent = totals.master && totals.master > 0 ? Math.min(100, (totals.dailySalesRate * 30 / totals.master) * 100) : 0;
  const masterRecordedCount = variants.filter((variant) => variant.master !== null).length;

  function changeMaster(variant: ProductDetailVariant, next: number) {
    setDrafts((current) => ({ ...current, [variant.id]: Math.max(0, Math.round(next)) }));
    setNotice("");
  }

  async function saveMaster() {
    if (dirtyVariants.length === 0) return;
    setSaving(true);
    setNotice("");
    try {
      const response = await fetch("/api/inventory/master", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ updates: dirtyVariants.map((variant) => ({ variantId: variant.id, quantity: drafts[variant.id] })) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.message || "Could not save master counts.");
      setVariants((current) => current.map((variant) => variant.id in drafts ? { ...variant, master: drafts[variant.id], daysCover: drafts[variant.id] > 0 && variant.dailySalesRate > 0 ? Math.ceil(drafts[variant.id] / variant.dailySalesRate) : null } : variant));
      setDrafts({});
      setNotice(`Saved ${data.saved ?? dirtyVariants.length} master ${dirtyVariants.length === 1 ? "count" : "counts"}.`);
      router.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save master counts.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="workspace workspace--product-detail product-detail-page">
      <Breadcrumb className="product-detail-breadcrumb">
        <BreadcrumbList>
          <BreadcrumbItem><BreadcrumbLink href="/inventory/products">Products</BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbPage>{initial.title}</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="product-detail-layout">
        <main className="product-detail-main">
          <header className="product-detail-heading">
            <Link className={buttonVariants({ variant: "ghost", size: "compact" })} href="/inventory/products"><ArrowLeft size={16} />Products</Link>
            <p className="workspace-kicker">Product inventory</p>
            <h1>{initial.title}</h1>
            <p>{initial.variants.length} {initial.variants.length === 1 ? "variant" : "variants"}{initial.handle && <> <span aria-hidden="true">·</span> /{initial.handle}</>}</p>
          </header>

          <div className="product-detail-stock-summary" aria-label="Channel inventory summary">
            <StockMetric label="Master" value={quantity(totals.master)} detail={masterRecordedCount === variants.length ? "Physical count" : `${masterRecordedCount} of ${variants.length} variants recorded`} channel="master" />
            <StockMetric label="Shopify" value={quantity(totals.shopify)} detail={sourceTime(initial.shopifySyncedAt)} channel="shopify" />
            <StockMetric label="TikTok Shop" value={quantity(totals.tiktok)} detail={initial.tiktokProductLevel !== null ? "Includes product-level stock" : sourceTime(initial.tiktokSyncedAt)} channel="tiktok" />
          </div>

          {notice && <p className="product-detail-notice" role="status">{notice}</p>}

          <Tabs defaultValue="inventory" className="product-detail-tabs">
            <TabsList aria-label="Product detail sections">
              <TabsTrigger value="inventory">Inventory</TabsTrigger>
              <TabsTrigger value="planning">Planning</TabsTrigger>
              <TabsTrigger value="activity">Inventory activity</TabsTrigger>
            </TabsList>

            <TabsContent value="inventory" className="product-detail-tab-content">
              <Card className="product-detail-panel">
                <CardHeader><div><CardTitle>Variant inventory</CardTitle><CardDescription>Master is editable. Shopify and TikTok show the latest saved channel inventory.</CardDescription></div>{dirtyVariants.length > 0 && <div className="product-detail-panel__actions"><Button variant="ghost" onClick={() => { setDrafts({}); setNotice(""); }}><RotateCcw size={15} />Discard</Button><Button variant="primary" onClick={saveMaster} disabled={saving}><Save size={15} />{saving ? "Saving…" : `Save ${dirtyVariants.length}`}</Button></div>}</CardHeader>
                <CardContent className="product-detail-table-content">
                  {variants.length > 0 ? <Table><TableHeader><TableRow><TableHead>Variant</TableHead><TableHead>Master</TableHead><TableHead>Shopify</TableHead><TableHead>TikTok Shop</TableHead></TableRow></TableHeader><TableBody>{variants.map((variant) => { const current = masterValue(variant, drafts); const edited = variant.id in drafts && drafts[variant.id] !== (variant.master ?? 0); return <TableRow key={variant.id} className={edited ? "is-edited" : undefined}><TableCell><strong>{variantTitle(variant.title)}</strong></TableCell><TableCell><div className="product-detail-stepper"><Button variant="ghost" size="icon" aria-label={`Decrease master stock for ${variantTitle(variant.title)}`} onClick={() => changeMaster(variant, (current ?? 0) - 1)}><Minus size={14} /></Button><Input aria-label={`Master stock for ${variantTitle(variant.title)}`} inputMode="numeric" value={current ?? ""} onChange={(event) => changeMaster(variant, Number(event.target.value.replace(/\D/g, "")) || 0)} /><Button variant="ghost" size="icon" aria-label={`Increase master stock for ${variantTitle(variant.title)}`} onClick={() => changeMaster(variant, (current ?? 0) + 1)}><Plus size={14} /></Button></div></TableCell><TableCell>{quantity(variant.shopify)}</TableCell><TableCell>{quantity(variant.tiktok)}</TableCell></TableRow>; })}</TableBody></Table> : <div className="product-detail-empty"><Package size={18} /><div><strong>No variants imported</strong><p>This Shopify product record does not contain any variants.</p></div></div>}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="planning" className="product-detail-tab-content">
              <Card className="product-detail-panel product-detail-panel--forecast">
                <CardHeader>
                  <div><CardTitle>30-day stock estimate</CardTitle><CardDescription>Projected from the higher of recorded 7-day and 30-day sales rates.</CardDescription></div>
                  {totals.daysCover !== null && <span className="product-detail-panel__value">{quantity(totals.daysCover)} days</span>}
                </CardHeader>
                <CardContent>
                  {forecast.length > 0 ? <>
                    <ChartContainer className="product-detail-chart" config={{ stock: { label: "Projected master stock", color: "#b63b8f" } }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={forecast} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
                          <defs><linearGradient id="product-stock-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#b63b8f" stopOpacity={0.22} /><stop offset="100%" stopColor="#b63b8f" stopOpacity={0.02} /></linearGradient></defs>
                          <CartesianGrid vertical={false} stroke="#eee6e9" />
                          <XAxis dataKey="day" interval={6} tickLine={false} axisLine={false} tick={{ fill: "#8a747f", fontSize: 10 }} />
                          <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: "#8a747f", fontSize: 10 }} />
                          <ChartTooltip cursor={{ stroke: "#d9b3ca" }} contentStyle={{ border: "1px solid #e7dce2", borderRadius: 8, background: "#fffefd", color: "#3f2b37", fontSize: 11 }} formatter={(value) => [quantity(Number(value)), "Master stock"]} />
                          <Area type="monotone" dataKey="stock" stroke="#b63b8f" strokeWidth={2} fill="url(#product-stock-fill)" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </ChartContainer>
                    <div className="product-detail-forecast-meter"><div><span>Projected 30-day demand</span><strong>{quantity(Math.round(totals.dailySalesRate * 30))} units</strong></div><Progress value={forecastDemandPercent} aria-label={`${Math.round(forecastDemandPercent)} percent of master stock projected to sell in 30 days`} /></div>
                  </> : <div className="product-detail-empty"><Package size={18} /><div><strong>No forecast available</strong><p>A 30-day estimate needs a master count and recorded product sales.</p></div></div>}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="activity" className="product-detail-tab-content">
              <Card className="product-detail-panel">
                <CardHeader><div><CardTitle>Inventory activity</CardTitle><CardDescription>Changes recorded for this product across master and channel inventories.</CardDescription></div></CardHeader>
                <CardContent className="product-detail-table-content">
                  {initial.ledger.length > 0 ? <Table><TableHeader><TableRow><TableHead>When</TableHead><TableHead>Variant</TableHead><TableHead>Inventory</TableHead><TableHead>Change</TableHead><TableHead>Before</TableHead><TableHead>After</TableHead><TableHead>Actor</TableHead><TableHead>Reference</TableHead></TableRow></TableHeader><TableBody>{initial.ledger.map((entry) => <TableRow key={entry.id}><TableCell>{compactTime(entry.createdAt)}</TableCell><TableCell>{entry.item}</TableCell><TableCell>{entry.inventory}</TableCell><TableCell className={entry.quantityDelta < 0 ? "product-detail-delta product-detail-delta--negative" : "product-detail-delta"}>{entry.quantityDelta > 0 ? "+" : ""}{quantity(entry.quantityDelta)}</TableCell><TableCell>{quantity(entry.quantityBefore)}</TableCell><TableCell>{quantity(entry.quantityAfter)}</TableCell><TableCell>{entry.actor || "—"}</TableCell><TableCell className="product-detail-code">{entry.reference || "—"}</TableCell></TableRow>)}</TableBody></Table> : <div className="product-detail-empty"><Package size={18} /><div><strong>No inventory activity recorded</strong><p>Manual edits and operational stock movements for this product will appear here.</p></div></div>}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </main>

        <aside className="product-detail-rail" aria-label="Product image and channel sync status">
          <Card className="product-detail-media-card">
            <CardContent className="product-detail-media-card__content"><ProductImage src={initial.imageUrl} title={initial.title} /></CardContent>
          </Card>
          <div className="product-detail-rail__identity">
            <strong>{initial.title}</strong>
            <span>{initial.variants.length} {initial.variants.length === 1 ? "variant" : "variants"}</span>
          </div>
          <div className="product-detail-sync-list">
            <div><span className="product-detail-sync-dot" data-channel="shopify" /><p><strong>Shopify</strong><small>{sourceTime(initial.shopifySyncedAt)}</small></p></div>
            <div><span className="product-detail-sync-dot" data-channel="tiktok" /><p><strong>TikTok Shop</strong><small>{sourceTime(initial.tiktokSyncedAt)}</small></p></div>
          </div>
        </aside>
      </div>
    </section>
  );
}
