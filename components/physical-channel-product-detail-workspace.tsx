"use client";

import Link from "next/link";
import { ArrowLeft, ExternalLink, ImageOff } from "lucide-react";
import { useMemo, useState } from "react";
import { ChannelMark, MappingManager } from "@/components/physical-channel-listings";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { groupChannelListings, listingVariantLabel, mappingStatusLabel, type ChannelProductGroup } from "@/lib/physical-channel-products";
import type { PhysicalChannelListing, PhysicalInventoryItem } from "@/lib/types";

/* eslint-disable @next/next/no-img-element -- seller-supplied image hosts vary by channel. */
function ProductImage({ src, title }: { src: string | null; title: string }) {
  const [failed, setFailed] = useState(false);
  if (src && !failed) return <img className="physical-reference-image" src={src} alt={title} onError={() => setFailed(true)} />;
  return <div className="physical-reference-image physical-reference-image--empty"><ImageOff size={25} /><span>No source image yet</span></div>;
}
/* eslint-enable @next/next/no-img-element */

export function PhysicalChannelProductDetailWorkspace({ group, items }: { group: ChannelProductGroup; items: PhysicalInventoryItem[] }) {
  const [activeGroup, setActiveGroup] = useState(group);
  const channelName = activeGroup.channel === "shopify" ? "Shopify" : "TikTok Shop";
  const masterItem = useMemo(() => items.find((item) => item.id === activeGroup.masterProductId) ?? null, [activeGroup.masterProductId, items]);
  const sourceNotes = [...new Set(activeGroup.listings.map((listing) => listing.sourceNote).filter(Boolean))];

  function applyListings(listings: PhysicalChannelListing[]) {
    const nextGroup = groupChannelListings(listings).find((candidate) => candidate.externalProductId === activeGroup.externalProductId);
    if (nextGroup) setActiveGroup(nextGroup);
  }

  const productDetails = [["Inventory", channelName], ["Type", activeGroup.kind === "bundle" ? "Bundle" : activeGroup.kind === "individual" ? "Single item" : "Mixed or unclassified"], ["Variants", `${activeGroup.listings.length}`], ["Stock", activeGroup.channelQuantity === null ? "Not fetched" : `${activeGroup.channelQuantity.toLocaleString()} units`], ["Master product", masterItem ? masterItem.title : "Not linked"], ["Mapping status", mappingStatusLabel(activeGroup.mappingStatus)]];

  return <section className="physical-reference-page"><main className="physical-reference-main">
    <div className="physical-reference-breadcrumb-row"><Link className="physical-reference-back" href="/inventory/products" aria-label="Back to products"><ArrowLeft size={20} /></Link><Breadcrumb><BreadcrumbList><BreadcrumbItem><BreadcrumbLink href="/inventory">Inventory</BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbLink href="/inventory/products">Products</BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbPage>{channelName}</BreadcrumbPage></BreadcrumbItem></BreadcrumbList></Breadcrumb></div>
    <div className="physical-reference-hero"><header className="physical-reference-summary"><p className={`physical-detail-overline physical-detail-overline--${activeGroup.channel}`}><ChannelMark channel={activeGroup.channel} size={15} />{channelName} inventory</p><h1>{activeGroup.title}</h1><p className="physical-reference-variant-label">{activeGroup.listings.length} {activeGroup.listings.length === 1 ? "variant" : "variants"} · {activeGroup.channelQuantity === null ? "Stock not fetched" : `${activeGroup.channelQuantity.toLocaleString()} units`}</p><p className="physical-reference-description">The master product is linked from the {channelName} products table. Map each channel variant to its matching master variant here.</p><dl className="physical-reference-facts">{productDetails.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{label === "Master product" && masterItem ? <Link className="physical-detail-link" href={`/inventory/products/${masterItem.id}`}>{value}</Link> : value}</dd></div>)}</dl>{activeGroup.listingUrl && <a className="physical-detail-source-link" href={activeGroup.listingUrl} target="_blank" rel="noreferrer">{activeGroup.channel === "tiktok" ? "View on TikTok Shop" : "View source"} <ExternalLink size={13} /></a>}</header><Card className="physical-reference-media"><CardContent><ProductImage src={activeGroup.imageUrl} title={activeGroup.title} /></CardContent></Card></div>
    <Card className="physical-reference-table-card physical-reference-variants-card"><CardHeader><div className="physical-reference-table-heading"><CardTitle>Variants</CardTitle><span>{activeGroup.listings.length} total</span></div><MappingManager group={activeGroup} items={items} onSaved={applyListings} /></CardHeader><CardContent><Table className="physical-reference-variant-table physical-reference-variant-table--mapping"><TableHeader><TableRow><TableHead>Channel variant</TableHead><TableHead>Stock</TableHead><TableHead>Mapping</TableHead></TableRow></TableHeader><TableBody>{activeGroup.listings.map((listing) => <TableRow key={listing.id}><TableCell><div className="physical-variant-name"><strong>{listingVariantLabel(listing)}</strong></div></TableCell><TableCell>{listing.channelQuantity === null ? "Not fetched" : listing.channelQuantity.toLocaleString()}</TableCell><TableCell>{mappingStatusLabel(listing.mappingStatus)}</TableCell></TableRow>)}</TableBody></Table>{sourceNotes.length > 0 && <div className="physical-detail-notes"><strong>Mapping notes</strong>{sourceNotes.map((note) => <p key={note}>{note}</p>)}</div>}</CardContent></Card>
  </main></section>;
}
