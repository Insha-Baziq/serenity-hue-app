"use client";

import { MinusIcon, PlusIcon } from "@radix-ui/react-icons";
import { ChevronDown, ChevronLeft, ChevronRight, ExternalLink, PackageOpen, Search, X } from "lucide-react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { channelProductDetailHref, groupChannelListings, listingVariantLabel, mappingStatusLabel, type ChannelProductGroup } from "@/lib/physical-channel-products";
import type { PhysicalChannel, PhysicalChannelListing, PhysicalInventoryItem, PhysicalInventoryVariant } from "@/lib/types";

type DraftComponent = { physicalVariantId: string; quantityPerSale: number };
type DraftsByListing = Record<string, DraftComponent[]>;
type PhysicalVariantChoice = PhysicalInventoryVariant & { itemId: string; itemTitle: string };

const PAGE_SIZES = [10, 25, 50];
const UNMAPPED_VALUE = "unmapped";
type ComboboxPosition = { top: number; left: number; width: number; optionsMaxHeight: number };

function ChannelMark({ channel, size = 22 }: { channel: PhysicalChannel; size?: number }) {
  if (channel === "shopify") return <span className="physical-channel-mark physical-channel-mark--shopify" style={{ width: size, height: size }} aria-hidden="true"><svg width={size * .58} height={size * .58} viewBox="0 0 24 24"><path d="M15.3 5.2c-.1 0-.9.2-1 .3-.1-.4-.3-.9-.7-1.3-.5-.6-1.2-.7-1.6-.5-.9-.9-1.9-.6-2.8.2-1 .8-1.6 2.3-1.8 3.3-.7.2-1.3.4-1.4.4-.4.1-.4.1-.5.5-.1.3-1 7.9-1 7.9L15 18l3.6-.8S15.7 5.4 15.6 5.3c-.1-.1-.2-.1-.3-.1Z" fill="#fff" /><path d="m12.3 9.2-.4 1.4s-.5-.3-1.2-.2c-1 .1-1 .7-1 .8.1.9 2.4 1.1 2.5 3.1.1 1.6-.8 2.6-2.2 2.7-1.7.1-2.6-.9-2.6-.9l.4-1.5s.9.7 1.7.6c.5 0 .7-.4.6-.7-.1-1.1-2-1.1-2.1-2.9-.1-1.5 1-3.1 3.2-3.2.9-.1 1.4.2 1.4.2Z" fill="#5e8e3e" /></svg></span>;
  return <span className="physical-channel-mark physical-channel-mark--tiktok" style={{ width: size, height: size }} aria-hidden="true"><svg width={size * .54} height={size * .54} viewBox="0 0 24 24"><path d="M16.6 3.7h-3v13.1a2.3 2.3 0 1 1-2.3-2.3c.2 0 .5 0 .7.1v-3a5.3 5.3 0 1 0 4.6 5.2V9.4a6.7 6.7 0 0 0 3.9 1.2V7.6a3.9 3.9 0 0 1-3.9-3.9Z" fill="#25f4ee" transform="translate(-1 .5)" /><path d="M17.6 2.6h-3v13.1a2.3 2.3 0 1 1-2.3-2.3c.2 0 .5 0 .7.1v-3a5.3 5.3 0 1 0 4.6 5.2V8.3a6.7 6.7 0 0 0 3.9 1.2V6.5a3.9 3.9 0 0 1-3.9-3.9Z" fill="#fe2c55" transform="translate(1 -.3)" /><path d="M17.1 3.1h-3v13.1a2.3 2.3 0 1 1-2.3-2.3c.2 0 .5 0 .7.1v-3a5.3 5.3 0 1 0 4.6 5.2V8.8a6.7 6.7 0 0 0 3.9 1.2V7a3.9 3.9 0 0 1-3.9-3.9Z" fill="#fff" /></svg></span>;
}

function MappingStatus({ status }: { status: PhysicalChannelListing["mappingStatus"] }) {
  return <span className={`physical-mapping-status physical-mapping-status--${status}`}>{mappingStatusLabel(status)}</span>;
}

function listingKindLabel(kind: ChannelProductGroup["kind"]) {
  return kind === "bundle" ? "Bundle" : kind === "individual" ? "Individual" : "Not available";
}

function flattenVariants(items: PhysicalInventoryItem[]): PhysicalVariantChoice[] {
  return items.flatMap((item) => item.variants.map((variant) => ({ ...variant, itemId: item.id, itemTitle: item.title })));
}

function productChoices(items: PhysicalInventoryItem[]): PhysicalVariantChoice[] {
  return items.flatMap((item) => {
    const firstVariant = item.variants[0];
    if (!firstVariant) return [];
    return [{ ...firstVariant, id: item.id, itemId: item.id, itemTitle: item.title, title: item.variants.length === 1 ? firstVariant.title : `${item.variants.length} variants` }];
  });
}

function initialDrafts(listings: PhysicalChannelListing[]): DraftsByListing {
  return Object.fromEntries(listings.map((listing) => [listing.id, listing.components.map(({ physicalVariantId, quantityPerSale }) => ({ physicalVariantId, quantityPerSale }))]));
}

function MappingQuantity({ value, label, onChange }: { value: number; label: string; onChange: (value: number) => void }) {
  return <div className="physical-mapping-quantity"><button type="button" aria-label={`Decrease ${label}`} onClick={() => onChange(Math.max(1, value - 1))}><MinusIcon /></button><Input aria-label={`${label} per sale`} inputMode="numeric" value={String(value)} onChange={(event) => onChange(Math.max(1, Number(event.target.value) || 1))} /><button type="button" aria-label={`Increase ${label}`} onClick={() => onChange(value + 1)}><PlusIcon /></button></div>;
}

function MappingVariantCombobox({ variants, value, onChange, placeholder, ariaLabel, emptyOption, disabled = false, className = "", replaceTriggerWhenOpen = false, searchPlaceholder = "Search products or variants", portalContainer }: { variants: PhysicalVariantChoice[]; value: string; onChange: (value: string) => void; placeholder: string; ariaLabel: string; emptyOption?: { value: string; label: string }; disabled?: boolean; className?: string; replaceTriggerWhenOpen?: boolean; searchPlaceholder?: string; portalContainer: HTMLDivElement | null }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [panelPosition, setPanelPosition] = useState<ComboboxPosition | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();
  const selectedVariant = variants.find((variant) => variant.id === value);
  const selectedLabel = selectedVariant ? `${selectedVariant.itemTitle} · ${selectedVariant.title}` : emptyOption?.value === value ? emptyOption.label : placeholder;
  const filteredVariants = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return variants;
    return variants.filter((variant) => `${variant.itemTitle} ${variant.title}`.toLowerCase().includes(text));
  }, [query, variants]);
  const showEmptyOption = Boolean(emptyOption && !query.trim());

  function close(restoreFocus = false) {
    setOpen(false);
    setQuery("");
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }

  useEffect(() => {
    if (!open || !portalContainer) return;
    const layer = portalContainer;

    function updatePanelPosition() {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const containerRect = layer.getBoundingClientRect();
      const viewportMargin = 8;
      const panelChromeHeight = 59;
      const preferredOptionsHeight = 214;
      const preferredPanelHeight = panelChromeHeight + preferredOptionsHeight;
      const availableViewportHeight = Math.max(120, window.innerHeight - viewportMargin * 2);
      const panelHeight = Math.min(preferredPanelHeight, availableViewportHeight);
      const optionsMaxHeight = Math.max(54, panelHeight - panelChromeHeight);
      const viewportBottom = window.innerHeight - viewportMargin;
      const width = Math.max(0, Math.min(rect.width, window.innerWidth - viewportMargin * 2));
      const maxTop = Math.max(viewportMargin, viewportBottom - panelHeight);
      const belowTop = rect.bottom + 7;
      const aboveTop = rect.top - panelHeight - 7;
      const preferredTop = replaceTriggerWhenOpen ? rect.top : belowTop + panelHeight <= viewportBottom || aboveTop < viewportMargin ? belowTop : aboveTop;
      const top = Math.min(Math.max(viewportMargin, preferredTop), maxTop);
      const left = Math.min(Math.max(viewportMargin, rect.left), Math.max(viewportMargin, window.innerWidth - width - viewportMargin));
      setPanelPosition({ top: top - containerRect.top, left: left - containerRect.left, width, optionsMaxHeight });
    }

    const frame = requestAnimationFrame(() => {
      updatePanelPosition();
      searchRef.current?.focus();
    });
    window.addEventListener("resize", updatePanelPosition);
    window.addEventListener("scroll", updatePanelPosition, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", updatePanelPosition);
      window.removeEventListener("scroll", updatePanelPosition, true);
    };
  }, [open, portalContainer, replaceTriggerWhenOpen]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      close();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  function choose(nextValue: string) {
    onChange(nextValue);
    close(true);
  }

  const panel = open && portalContainer ? <div ref={panelRef} className="physical-mapping-combobox__panel physical-mapping-combobox__panel--floating" style={panelPosition ? { top: panelPosition.top, left: panelPosition.left, width: panelPosition.width } : { top: 0, left: 0, width: 0, visibility: "hidden" }}>
    <label className="physical-mapping-combobox__search">
      <Search size={14} aria-hidden="true" />
      <span className="sr-only">Search {ariaLabel}</span>
      <Input ref={searchRef} role="combobox" aria-controls={listboxId} aria-expanded={open} aria-autocomplete="list" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); close(true); } }} placeholder={searchPlaceholder} autoComplete="off" />
    </label>
    <div className="physical-mapping-combobox__options" id={listboxId} role="listbox" aria-label={`${ariaLabel} options`} style={{ maxHeight: panelPosition?.optionsMaxHeight ?? 214 }}>
      {showEmptyOption && emptyOption && <button type="button" role="option" aria-selected={value === emptyOption.value} className="physical-mapping-combobox__option" onClick={() => choose(emptyOption.value)}>{emptyOption.label}</button>}
      {filteredVariants.map((variant) => <button type="button" role="option" aria-selected={value === variant.id} className="physical-mapping-combobox__option" key={variant.id} onClick={() => choose(variant.id)}><span><strong>{variant.itemTitle}</strong><small>{variant.title}</small></span>{value === variant.id && <span className="physical-mapping-combobox__selected">Selected</span>}</button>)}
      {!filteredVariants.length && <p>{emptyOption ? "No variants match that search." : "No products match that search."}</p>}
    </div>
  </div> : null;

  return <div className={`physical-mapping-combobox ${className}`.trim()} ref={rootRef}>
    <button ref={triggerRef} type="button" className={`physical-mapping-combobox__trigger${open ? " is-open" : ""}${open && replaceTriggerWhenOpen ? " is-replaced" : ""}`} aria-expanded={open} aria-controls={listboxId} aria-haspopup="listbox" aria-label={ariaLabel} aria-hidden={open && replaceTriggerWhenOpen} tabIndex={open && replaceTriggerWhenOpen ? -1 : undefined} disabled={disabled} onClick={() => {
      if (open) {
        close();
      } else {
        setOpen(true);
      }
    }}>
      <span className={!selectedVariant && emptyOption?.value !== value ? "is-placeholder" : ""}>{selectedLabel}</span>
      <ChevronDown size={15} aria-hidden="true" />
    </button>
    {panel && portalContainer ? createPortal(panel, portalContainer) : null}
  </div>;
}

function IndividualMappingBody({ listings, drafts, variants, onChange, portalContainer }: { listings: PhysicalChannelListing[]; drafts: DraftsByListing; variants: PhysicalVariantChoice[]; onChange: (listingId: string, physicalVariantId: string) => void; portalContainer: HTMLDivElement | null }) {
  return <div className="physical-mapping-workflow"><div className="physical-mapping-workflow-heading"><strong>Map each listing variant</strong><span>{listings.length} {listings.length === 1 ? "variant" : "variants"}</span></div><div className="physical-mapping-individual-list">{listings.map((listing) => {
    const selectedId = drafts[listing.id]?.[0]?.physicalVariantId ?? UNMAPPED_VALUE;
    return <div className="physical-mapping-individual-row" key={listing.id}><div className="physical-mapping-variant-copy"><strong>{listingVariantLabel(listing)}</strong><small>{listing.channelQuantity === null ? "Stock not fetched" : `${listing.channelQuantity.toLocaleString()} units`}</small></div><MappingVariantCombobox variants={variants} value={selectedId} onChange={(value) => onChange(listing.id, value)} placeholder="Choose a physical variant" ariaLabel={`Master variant for ${listingVariantLabel(listing)}`} emptyOption={{ value: UNMAPPED_VALUE, label: "Not mapped" }} portalContainer={portalContainer} /></div>;
  })}</div></div>;
}

function BundleMappingBody({ listings, drafts, items, variants, onSetComponentVariant, onChangeComponentQuantity, onChangeComponentQuantityForAll, onRemoveProduct, portalContainer }: { listings: PhysicalChannelListing[]; drafts: DraftsByListing; items: PhysicalInventoryItem[]; variants: PhysicalVariantChoice[]; onSetComponentVariant: (listingId: string, itemId: string, physicalVariantId: string) => void; onChangeComponentQuantity: (listingId: string, itemId: string, quantity: number) => void; onChangeComponentQuantityForAll: (itemId: string, quantity: number) => void; onRemoveProduct: (itemId: string) => void; portalContainer: HTMLDivElement | null }) {
  const [introducedItemIds, setIntroducedItemIds] = useState<string[]>([]);
  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const variantById = useMemo(() => new Map(variants.map((variant) => [variant.id, variant])), [variants]);
  const mappedItemIds = useMemo(() => new Set(listings.flatMap((listing) => (drafts[listing.id] ?? []).map((component) => variantById.get(component.physicalVariantId)?.itemId).filter((itemId): itemId is string => Boolean(itemId)))), [drafts, listings, variantById]);
  const componentItemIds = useMemo(() => new Set([...mappedItemIds, ...introducedItemIds]), [introducedItemIds, mappedItemIds]);
  const componentItems = useMemo(() => items.filter((item) => componentItemIds.has(item.id)), [componentItemIds, items]);
  const availableProducts = useMemo(() => productChoices(items.filter((item) => !componentItemIds.has(item.id))), [componentItemIds, items]);

  function addProduct(itemId: string) {
    const item = itemById.get(itemId);
    if (!item) return;
    setIntroducedItemIds((current) => current.includes(itemId) ? current : [...current, itemId]);
    if (item.variants.length === 1) {
      for (const listing of listings) onSetComponentVariant(listing.id, itemId, item.variants[0].id);
    }
  }

  function removeProduct(itemId: string) {
    setIntroducedItemIds((current) => current.filter((currentItemId) => currentItemId !== itemId));
    onRemoveProduct(itemId);
  }

  return <div className="physical-mapping-workflow"><div className="physical-mapping-workflow-heading"><div><strong>Build the bundle recipe</strong><span>{listings.length} {listings.length === 1 ? "listing variant" : "listing variants"}</span></div></div><p className="physical-mapping-bundle-guidance">Add each physical product once. For a product with colours, choose one colour for each listing variant. Each sale deducts only that row.</p><MappingVariantCombobox variants={availableProducts} value="" onChange={addProduct} placeholder={availableProducts.length ? "Add component product" : "All physical products are added"} ariaLabel="Add a physical product to this bundle" disabled={!availableProducts.length} className="physical-mapping-combobox--add" replaceTriggerWhenOpen searchPlaceholder="Search physical products" portalContainer={portalContainer} /><div className="physical-mapping-bundle-products">{componentItems.map((item) => {
    const itemVariants = variants.filter((variant) => variant.itemId === item.id);
    const matchingComponentsByListing = listings.map((listing) => (drafts[listing.id] ?? []).filter((component) => variantById.get(component.physicalVariantId)?.itemId === item.id));
    const sharedSingleVariant = itemVariants.length === 1 && matchingComponentsByListing.every((components) => components.length === 1) && new Set(matchingComponentsByListing.map(([component]) => component.quantityPerSale)).size === 1;
    const sharedQuantity = sharedSingleVariant ? matchingComponentsByListing[0][0].quantityPerSale : 1;
    return <section className="physical-mapping-bundle-product" key={item.id}><header><div><strong>{item.title}</strong><small>{item.variants.length} {item.variants.length === 1 ? "physical variant" : "physical variants"}</small></div><button type="button" className="physical-mapping-remove" aria-label={`Remove ${item.title} from this bundle`} onClick={() => removeProduct(item.id)}><X size={14} /></button></header>{sharedSingleVariant ? <div className="physical-mapping-bundle-product__shared"><div><strong>{itemVariants[0].title}</strong><small>Used by all {listings.length} {listings.length === 1 ? "listing variant" : "listing variants"}</small></div><MappingQuantity value={sharedQuantity} label={item.title} onChange={(quantity) => onChangeComponentQuantityForAll(item.id, quantity)} /></div> : <div>{listings.map((listing) => {
      const matchingComponents = (drafts[listing.id] ?? []).filter((component) => variantById.get(component.physicalVariantId)?.itemId === item.id);
      const component = matchingComponents[0];
      const hasMultipleVariants = matchingComponents.length > 1;
      return <div className="physical-mapping-bundle-product__row" key={listing.id}><div className="physical-mapping-bundle-product__variant"><strong>{listingVariantLabel(listing)}</strong><small>{listing.channelQuantity === null ? "Stock not fetched" : `${listing.channelQuantity.toLocaleString()} units`}{hasMultipleVariants ? " · Choose one physical variant" : ""}</small></div><MappingVariantCombobox variants={itemVariants} value={component?.physicalVariantId ?? UNMAPPED_VALUE} onChange={(physicalVariantId) => onSetComponentVariant(listing.id, item.id, physicalVariantId)} placeholder={`Choose ${item.title} variant`} ariaLabel={`${item.title} for ${listingVariantLabel(listing)}`} emptyOption={{ value: UNMAPPED_VALUE, label: "Not included" }} portalContainer={portalContainer} />{component ? <MappingQuantity value={component.quantityPerSale} label={item.title} onChange={(quantity) => onChangeComponentQuantity(listing.id, item.id, quantity)} /> : <span className="physical-mapping-bundle-product__quantity-placeholder" aria-hidden="true" />}</div>;
    })}</div>}</section>;
  })}</div>{!componentItems.length && <p className="physical-mapping-empty">Add the physical products included in this bundle to start mapping its variants.</p>}</div>;
}

export function MappingManager({ group, items, onSaved }: { group: ChannelProductGroup; items: PhysicalInventoryItem[]; onSaved: (listings: PhysicalChannelListing[]) => void }) {
  const [open, setOpen] = useState(false);
  const [mappingSession, setMappingSession] = useState(0);
  const [pickerLayer, setPickerLayer] = useState<HTMLDivElement | null>(null);
  const [drafts, setDrafts] = useState<DraftsByListing>({});
  const [draftKind, setDraftKind] = useState<ChannelProductGroup["kind"]>(group.kind);
  const [editingType, setEditingType] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const variants = useMemo(() => flattenVariants(items), [items]);
  const variantById = useMemo(() => new Map(variants.map((variant) => [variant.id, variant])), [variants]);
  const hasDuplicateBundleProductVariants = useMemo(() => draftKind === "bundle" && group.listings.some((listing) => {
    const itemIds = (drafts[listing.id] ?? []).map((component) => variantById.get(component.physicalVariantId)?.itemId).filter((itemId): itemId is string => Boolean(itemId));
    return new Set(itemIds).size !== itemIds.length;
  }), [draftKind, drafts, group.listings, variantById]);
  const kindLabel = listingKindLabel(draftKind);
  const channelName = group.channel === "shopify" ? "Shopify" : "TikTok Shop";

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (nextOpen) {
      setMappingSession((current) => current + 1);
      setDrafts(initialDrafts(group.listings));
      setDraftKind(group.kind);
      setEditingType(false);
      setError("");
    } else {
      setEditingType(false);
    }
  }

  function updateListingKind(nextKind: "individual" | "bundle") {
    setDraftKind(nextKind);
    setEditingType(false);
    if (nextKind === "individual") {
      const hasMultiComponentListing = Object.values(drafts).some((components) => components.length > 1);
      setDrafts((current) => Object.fromEntries(Object.entries(current).map(([listingId, components]) => [listingId, components.slice(0, 1)])));
      if (hasMultiComponentListing) {
        setError("Individual listings can use one physical variant per channel variant. Extra bundle components will not be saved.");
      } else {
        setError("");
      }
    } else {
      setError("");
    }
  }

  function updateListing(listingId: string, update: (current: DraftComponent[]) => DraftComponent[]) {
    setDrafts((current) => ({ ...current, [listingId]: update(current[listingId] ?? []) }));
  }

  function updateIndividual(listingId: string, physicalVariantId: string) {
    updateListing(listingId, () => physicalVariantId === UNMAPPED_VALUE ? [] : [{ physicalVariantId, quantityPerSale: 1 }]);
  }

  function setBundleComponentVariant(listingId: string, itemId: string, physicalVariantId: string) {
    updateListing(listingId, (current) => {
      const existing = current.find((component) => variantById.get(component.physicalVariantId)?.itemId === itemId);
      const withoutItem = current.filter((component) => variantById.get(component.physicalVariantId)?.itemId !== itemId);
      if (physicalVariantId === UNMAPPED_VALUE || !physicalVariantId) return withoutItem;
      return [...withoutItem, { physicalVariantId, quantityPerSale: existing?.quantityPerSale ?? 1 }];
    });
  }

  function updateBundleComponentQuantity(listingId: string, itemId: string, quantity: number) {
    updateListing(listingId, (current) => {
      let updated = false;
      return current.map((component) => {
        if (updated || variantById.get(component.physicalVariantId)?.itemId !== itemId) return component;
        updated = true;
        return { ...component, quantityPerSale: quantity };
      });
    });
  }

  function updateBundleComponentQuantityForAll(itemId: string, quantity: number) {
    setDrafts((current) => Object.fromEntries(group.listings.map((listing) => [listing.id, (current[listing.id] ?? []).map((component) => variantById.get(component.physicalVariantId)?.itemId === itemId ? { ...component, quantityPerSale: quantity } : component)])));
  }

  function removeBundleProduct(itemId: string) {
    setDrafts((current) => Object.fromEntries(group.listings.map((listing) => [listing.id, (current[listing.id] ?? []).filter((component) => variantById.get(component.physicalVariantId)?.itemId !== itemId)])));
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/inventory/physical-mappings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ listingKind: draftKind, mappings: group.listings.map((listing) => ({ listingId: listing.id, components: drafts[listing.id] ?? [] })) }) });
      const payload = await response.json().catch(() => null) as { ok?: boolean; message?: string; listings?: PhysicalChannelListing[] } | null;
      if (!response.ok || !payload?.ok || !payload.listings) throw new Error(payload?.message || "Unable to save the mapping");
      onSaved(payload.listings);
      setOpen(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save the mapping");
    } finally {
      setSaving(false);
    }
  }

  const canSave = draftKind !== "unknown" && !saving && !hasDuplicateBundleProductVariants;
  return <Dialog open={open} onOpenChange={handleOpenChange}>
    <DialogTrigger asChild><Button variant="outline" size="compact" className="physical-mapping-button">Map product(s)</Button></DialogTrigger>
    <DialogContent className="physical-mapping-dialog">
      <div className="physical-mapping-dialog__header"><p className="workspace-kicker"><ChannelMark channel={group.channel} size={14} />{channelName} listing</p><DialogTitle>{group.title}</DialogTitle><DialogDescription>{group.listings.length > 1 ? "Map each listing variant to the physical inventory it represents." : "Map this listing to the physical inventory it represents."}</DialogDescription></div>
      <div className="physical-mapping-dialog__body">
        <div className="physical-mapping-fetched-type"><div className="physical-mapping-fetched-type__copy"><span>Listing type</span>{editingType ? <div className="physical-mapping-type-options" role="group" aria-label="Listing type"><button type="button" className={`physical-mapping-type-option${draftKind === "individual" ? " is-selected" : ""}`} aria-pressed={draftKind === "individual"} onClick={() => updateListingKind("individual")}>Individual</button><button type="button" className={`physical-mapping-type-option${draftKind === "bundle" ? " is-selected" : ""}`} aria-pressed={draftKind === "bundle"} onClick={() => updateListingKind("bundle")}>Bundle</button></div> : <><strong>{kindLabel}</strong>{draftKind === "unknown" && <small>Choose a type before mapping</small>}</>}</div><Button variant="outline" size="compact" onClick={() => setEditingType((current) => !current)}>{editingType ? "Done" : "Edit type"}</Button></div>
        {group.listings.some((listing) => listing.sourceNote) && <p className="physical-mapping-source">{[...new Set(group.listings.map((listing) => listing.sourceNote).filter(Boolean))].join(" ")}</p>}
        {draftKind === "individual" && <IndividualMappingBody listings={group.listings} drafts={drafts} variants={variants} onChange={updateIndividual} portalContainer={pickerLayer} />}
        {draftKind === "bundle" && <BundleMappingBody key={mappingSession} listings={group.listings} drafts={drafts} items={items} variants={variants} onSetComponentVariant={setBundleComponentVariant} onChangeComponentQuantity={updateBundleComponentQuantity} onChangeComponentQuantityForAll={updateBundleComponentQuantityForAll} onRemoveProduct={removeBundleProduct} portalContainer={pickerLayer} />}
        {draftKind === "unknown" && <p className="physical-mapping-empty">Choose Individual or Bundle to start mapping this listing.</p>}
        {hasDuplicateBundleProductVariants && <p className="physical-adjust-error" role="alert">Choose one physical variant per product for each bundle variant. Use quantity when the bundle contains multiples of the same variant.</p>}
        {error && <p className="physical-adjust-error" role="alert">{error}</p>}
      </div>
      <footer className="physical-mapping-dialog__footer"><Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button><Button variant="primary" onClick={save} disabled={!canSave}>{saving ? "Saving…" : "Save changes"}</Button></footer>
      <div className="physical-mapping-dialog__floating-layer" ref={setPickerLayer} />
    </DialogContent>
  </Dialog>;
}

export function PhysicalChannelListings({ channel, listings, items, onSaved }: { channel: PhysicalChannel; listings: PhysicalChannelListing[]; items: PhysicalInventoryItem[]; onSaved: (listings: PhysicalChannelListing[]) => void }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const productGroups = useMemo(() => groupChannelListings(listings), [listings]);
  const visible = useMemo(() => {
    const text = query.trim().toLowerCase();
    return text ? productGroups.filter((group) => group.listings.some((listing) => `${listing.title} ${listing.variantTitle} ${listing.components.map((component) => `${component.itemTitle} ${component.variantTitle}`).join(" ")}`.toLowerCase().includes(text))) : productGroups;
  }, [productGroups, query]);
  const totalPages = Math.max(1, Math.ceil(visible.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = visible.length === 0 ? 0 : (currentPage - 1) * pageSize;
  const pageEnd = Math.min(pageStart + pageSize, visible.length);
  const pagedGroups = visible.slice(pageStart, pageEnd);
  const pageItems = getPageItems(currentPage, totalPages);
  const channelName = channel === "shopify" ? "Shopify" : "TikTok Shop";

  async function refreshTikTokQuantities() {
    setRefreshing(true);
    setRefreshError("");
    try {
      const response = await fetch("/api/inventory/refresh-tiktok", { method: "POST" });
      const payload = await response.json().catch(() => null) as { ok?: boolean; message?: string; listings?: PhysicalChannelListing[] } | null;
      if (!response.ok || !payload?.ok || !payload.listings) throw new Error(payload?.message || "TikTok quantities could not be refreshed");
      onSaved(payload.listings);
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : "TikTok quantities could not be refreshed");
    } finally {
      setRefreshing(false);
    }
  }

  return <section className="physical-channel-view">
    <div className="physical-channel-view__intro"><div><p className="workspace-kicker"><ChannelMark channel={channel} size={14} />{channelName} inventory</p><h2>{channelName} products</h2><p>Channel listings map to physical products and variants when sold.</p></div><span className="ci-count">{productGroups.length} product{productGroups.length === 1 ? "" : "s"}</span></div>
    <div className="physical-channel-toolbar"><label className="search-field search-field--inventory"><Search size={18} strokeWidth={1.8} aria-hidden="true" /><span className="sr-only">Search {channelName} products</span><Input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder={`Search ${channelName} products`} /></label>{channel === "tiktok" && <div className="physical-channel-toolbar__actions"><Button variant="outline" size="compact" onClick={refreshTikTokQuantities} disabled={refreshing}>{refreshing ? "Refreshing…" : "Refresh TikTok quantities"}</Button></div>}</div>
    {refreshError && <p className="physical-channel-refresh-error" role="alert">{refreshError}</p>}
    <div className="physical-channel-table-wrap"><Table className="physical-channel-table"><TableHeader><TableRow><TableHead>Product</TableHead><TableHead>Variants</TableHead><TableHead>Type</TableHead><TableHead>Stock</TableHead><TableHead>Mapping</TableHead><TableHead><span className="sr-only">Map product</span></TableHead></TableRow></TableHeader><TableBody>{pagedGroups.map((group) => <TableRow key={group.id}><TableCell className="physical-channel-listing"><div className="physical-channel-listing__inner"><div className="physical-channel-listing__mark"><ChannelMark channel={channel} /></div><div><Link className="physical-channel-listing__title" href={channelProductDetailHref(channel, group.externalProductId)}>{group.title}</Link>{group.listingUrl && <a href={group.listingUrl} target="_blank" rel="noreferrer">{channel === "tiktok" ? "View on TikTok Shop" : "View source"} <ExternalLink size={11} /></a>}</div></div></TableCell><TableCell className="physical-channel-variant-count">{group.listings.length}</TableCell><TableCell><span className={`physical-listing-kind physical-listing-kind--${group.kind}`}>{listingKindLabel(group.kind)}</span></TableCell><TableCell className="physical-channel-quantity">{group.channelQuantity === null ? <span>Not fetched</span> : <strong>{group.channelQuantity.toLocaleString()} <small>units</small></strong>}</TableCell><TableCell><MappingStatus status={group.mappingStatus} /></TableCell><TableCell className="physical-channel-actions"><MappingManager group={group} items={items} onSaved={onSaved} /></TableCell></TableRow>)}</TableBody></Table>{!visible.length && <div className="table-empty"><PackageOpen size={18} />No channel products match that search.</div>}</div>
    <footer className="table-footer physical-channel-table-footer"><div className="page-size-control"><Select value={String(pageSize)} onValueChange={(value) => { setPageSize(Number(value)); setPage(1); }}><SelectTrigger aria-label="Channel products per page"><SelectValue /></SelectTrigger><SelectContent>{PAGE_SIZES.map((size) => <SelectItem key={size} value={String(size)}>{size} per page</SelectItem>)}</SelectContent></Select></div><div className="pagination" aria-label={`${channelName} inventory pagination`}><span className="pagination-summary">{pageStart + (visible.length ? 1 : 0)}–{pageEnd} of {visible.length}</span><Button variant="ghost" size="icon" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={currentPage === 1} aria-label="Previous page"><ChevronLeft size={16} /></Button>{pageItems.map((item, index) => item === "ellipsis" ? <span className="pagination-ellipsis" key={`ellipsis-${index}`}>…</span> : <Button variant="ghost" size="compact" key={item} className={item === currentPage ? "is-current" : ""} aria-current={item === currentPage ? "page" : undefined} onClick={() => setPage(item)}>{item}</Button>)}<Button variant="ghost" size="icon" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={currentPage === totalPages} aria-label="Next page"><ChevronRight size={16} /></Button></div></footer>
  </section>;
}

function getPageItems(currentPage: number, totalPages: number): (number | "ellipsis")[] {
  if (totalPages <= 6) return Array.from({ length: totalPages }, (_, index) => index + 1);
  const pages = new Set([1, totalPages, currentPage - 1, currentPage, currentPage + 1]);
  const ordered = [...pages].filter((item) => item >= 1 && item <= totalPages).sort((a, b) => a - b);
  const items: (number | "ellipsis")[] = [];
  ordered.forEach((item, index) => { if (index > 0 && item - ordered[index - 1] > 1) items.push("ellipsis"); items.push(item); });
  return items;
}

export { ChannelMark };
