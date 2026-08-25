"use client";

import { ChevronDownIcon, MinusIcon, PlusIcon } from "@radix-ui/react-icons";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { PhysicalInventoryItem } from "@/lib/types";

type AdjustmentItem = Pick<PhysicalInventoryItem, "id" | "title" | "variants">;
type SavedChange = { variantId: string; itemId: string; before: number; after: number; quantityKnown: true };

function countLabel(quantity: number, known: boolean) {
  return known ? String(quantity) : "Not counted";
}

export function PhysicalInventoryAdjustSheet({ items, triggerLabel = "Update inventory", onSaved }: {
  items: AdjustmentItem[];
  triggerLabel?: string;
  onSaved?: (changes: SavedChange[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [step, setStep] = useState<"edit" | "review">("edit");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [expandedItemIds, setExpandedItemIds] = useState<string[]>([]);

  const variants = useMemo(() => items.flatMap((item) => item.variants.map((variant) => ({ ...variant, itemId: item.id, itemTitle: item.title }))), [items]);
  const proposed = variants.map((variant) => {
    const raw = drafts[variant.id] ?? (variant.quantityKnown ? String(variant.quantity) : "");
    const hasValue = raw.trim() !== "";
    const value = Number(raw);
    const valid = hasValue && Number.isSafeInteger(value) && value >= 0;
    const changed = valid && (value !== variant.quantity || !variant.quantityKnown);
    return { ...variant, raw, valid, after: valid ? value : null, changed };
  });
  const affected = proposed.filter((variant) => variant.changed);
  const hasInvalidValue = proposed.some((variant) => variant.raw.trim() !== "" && !variant.valid);
  const groups = items.map((item) => ({ item, variants: proposed.filter((variant) => variant.itemId === item.id) }));

  function reset() {
    setNote("");
    setDrafts({});
    setStep("edit");
    setSaving(false);
    setError("");
    setExpandedItemIds([]);
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (nextOpen) setExpandedItemIds(items.length === 1 ? [items[0].id] : []);
    else reset();
  }

  function toggleItem(itemId: string) {
    setExpandedItemIds((current) => current.includes(itemId) ? current.filter((id) => id !== itemId) : [...current, itemId]);
  }

  function changeCount(variantId: string, current: number, known: boolean, change: number) {
    const currentDraft = drafts[variantId] ?? (known ? String(current) : "0");
    const parsed = Number(currentDraft);
    const base = Number.isSafeInteger(parsed) ? parsed : current;
    setDrafts((value) => ({ ...value, [variantId]: String(Math.max(0, base + change)) }));
    setError("");
  }

  async function save() {
    if (!affected.length || hasInvalidValue) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/inventory/physical", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ note, adjustments: affected.map((variant) => ({ variantId: variant.id, quantity: variant.after })) }),
      });
      const payload = await response.json().catch(() => null) as { ok?: boolean; message?: string; changes?: SavedChange[] } | null;
      if (!response.ok || !payload?.ok || !payload.changes) throw new Error(payload?.message || "Unable to save inventory");
      onSaved?.(payload.changes);
      setOpen(false);
      reset();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save inventory");
      setStep("edit");
    } finally {
      setSaving(false);
    }
  }

  return <Sheet open={open} onOpenChange={handleOpenChange}>
    <SheetTrigger asChild><Button variant="outline" className="physical-adjust-trigger">{triggerLabel}</Button></SheetTrigger>
    <SheetContent className="physical-adjust-sheet">
      <div className="physical-adjust-sheet__header">
        <p className="workspace-kicker">Inventory update</p>
        <SheetTitle>{step === "review" ? "Review changes" : "Update inventory"}</SheetTitle>
        <SheetDescription>{step === "review" ? `${affected.length} variant${affected.length === 1 ? "" : "s"} will be updated.` : "The current count is shown for every known variant. Use the controls or type the new count directly."}</SheetDescription>
      </div>

      {step === "edit" ? <div className="physical-adjust-sheet__body">
        <div className="physical-adjust-groups" aria-label="Product quantities">
          {groups.map(({ item, variants }) => {
            const isExpanded = expandedItemIds.includes(item.id);
            const changedCount = variants.filter((variant) => variant.changed).length;
            return <section className={`physical-adjust-group${isExpanded ? " is-expanded" : ""}`} key={item.id}>
              <button type="button" className="physical-adjust-group__toggle" aria-expanded={isExpanded} onClick={() => toggleItem(item.id)}><ChevronDownIcon /><span><strong>{item.title}</strong><small>{variants.length} variant{variants.length === 1 ? "" : "s"}{changedCount ? ` · ${changedCount} changed` : ""}</small></span></button>
              {isExpanded && <div className="physical-adjust-rows">
                {variants.map((variant) => <div className="physical-adjust-row" key={variant.id}>
                  <div><strong>{variant.title}</strong><span>Current: {countLabel(variant.quantity, variant.quantityKnown)}</span></div>
                  <div className="physical-adjust-row__quantity"><div className="physical-count-control"><button type="button" aria-label={`Decrease ${item.title}, ${variant.title}`} disabled={variant.raw === "0"} onClick={() => changeCount(variant.id, variant.quantity, variant.quantityKnown, -1)}><MinusIcon /></button><label><span className="sr-only">Count for {item.title}, {variant.title}</span><Input inputMode="numeric" value={variant.raw} onChange={(event) => { setDrafts((current) => ({ ...current, [variant.id]: event.target.value })); setError(""); }} placeholder="—" aria-invalid={variant.raw.trim() !== "" && !variant.valid} /></label><button type="button" aria-label={`Increase ${item.title}, ${variant.title}`} onClick={() => changeCount(variant.id, variant.quantity, variant.quantityKnown, 1)}><PlusIcon /></button></div></div>
                </div>)}
              </div>}
            </section>;
          })}
        </div>
        <div className="physical-adjust-field">
          <label htmlFor="inventory-update-note">Note <em>Optional</em></label>
          <Input id="inventory-update-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={240} placeholder="Add a reference for this change" />
        </div>
        {hasInvalidValue && <p className="physical-adjust-error" role="alert">Use a whole number of zero or more.</p>}
        {error && <p className="physical-adjust-error" role="alert">{error}</p>}
      </div> : <div className="physical-adjust-sheet__body physical-adjust-review">
        {note && <div className="physical-adjust-review__note">{note}</div>}
        <div className="physical-adjust-review__rows">{affected.map((variant) => <div key={variant.id}><span><strong>{variant.itemTitle}</strong><small>{variant.title}</small></span><b>{countLabel(variant.quantity, variant.quantityKnown)} <i>→</i> {variant.after}</b></div>)}</div>
        <p>These variant counts become the new master inventory. Shopify and TikTok quantities are not changed.</p>
        {error && <p className="physical-adjust-error" role="alert">{error}</p>}
      </div>}

      <footer className="physical-adjust-sheet__footer">
        {step === "review" && <Button variant="ghost" onClick={() => setStep("edit")} disabled={saving}>Back</Button>}
        <Button variant="primary" className="physical-adjust-sheet__continue" disabled={hasInvalidValue || affected.length === 0 || saving} onClick={() => step === "edit" ? setStep("review") : save()}>{saving ? "Saving…" : step === "edit" ? `Review ${affected.length || ""} change${affected.length === 1 ? "" : "s"}` : "Save inventory"}</Button>
      </footer>
    </SheetContent>
  </Sheet>;
}
