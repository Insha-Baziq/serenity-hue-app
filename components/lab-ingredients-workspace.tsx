"use client";

import { ArrowLeft, ChevronLeft, ChevronRight, Pencil, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { formatGrams } from "@/components/labs-workspace";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { getPageItems } from "@/lib/pagination";
import type { LabIngredient } from "@/lib/types";

export function LabIngredientsWorkspace({ items }: { items: LabIngredient[] }) {
  const router = useRouter();
  const [query, setQuery] = useState(""); const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<LabIngredient | null>(null); const [quantity, setQuantity] = useState(""); const [reorder, setReorder] = useState(""); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  const filtered = useMemo(() => items.filter((item) => item.title.toLowerCase().includes(query.trim().toLowerCase())), [items, query]);
  const pageSize = 10; const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize)); const currentPage = Math.min(page, totalPages); const pageStart = filtered.length ? (currentPage - 1) * pageSize : 0; const pageEnd = Math.min(pageStart + pageSize, filtered.length); const visibleItems = filtered.slice(pageStart, pageEnd);
  const pageItems = getPageItems(currentPage, totalPages);
  function edit(item: LabIngredient) { setEditing(item); setQuantity(item.quantityKnown ? String(item.quantityGrams) : ""); setReorder(String(item.reorderPointGrams || "")); setError(""); }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editing) return; const amount = Number(quantity); const point = reorder.trim() ? Number(reorder) : 0;
    if (!Number.isFinite(amount) || amount < 0 || !Number.isFinite(point) || point < 0) { setError("Enter zero or a positive number of grams."); return; }
    setSaving(true); try {
      const response = await fetch("/api/labs/ingredients", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: editing.id, quantityGrams: amount, reorderPointGrams: point }) });
      const result = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) { setError(result.message || "Unable to update this ingredient."); return; }
      setEditing(null); router.refresh();
    } catch { setError("Unable to update this ingredient. Check your connection and try again."); } finally { setSaving(false); }
  }
  return <section className="workspace workspace--labs">
    <Link className="labs-back" href="/labs"><ArrowLeft size={16} />Labs</Link>
    <header className="workspace-header labs-header"><div><h1>Ingredient inventory</h1><p className="workspace-description">A separate gram-based inventory used only for production batches.</p></div></header>
    <div className="labs-ingredients-frame"><div className="inventory-toolbar"><label className="search-field search-field--inventory"><Search size={18} aria-hidden="true" /><span className="sr-only">Search ingredients</span><Input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Search ingredients" /></label></div>
      <div className="labs-ingredients-scroll"><table className="labs-ingredients-table"><thead><tr><th>Ingredient</th><th>On hand</th><th>Reorder point</th><th>Used in formulas</th><th></th></tr></thead><tbody>{visibleItems.map((item) => <tr key={item.id}><td><strong>{item.title}</strong></td><td className={item.quantityKnown ? "" : "labs-not-counted"}>{item.quantityKnown ? formatGrams(item.quantityGrams) : "Not counted"}</td><td>{item.reorderPointGrams ? formatGrams(item.reorderPointGrams) : "—"}</td><td>{item.usedByFormulaCount}</td><td><button className="labs-edit-button" type="button" onClick={() => edit(item)} aria-label={`Update ${item.title}`}><Pencil size={16} /></button></td></tr>)}</tbody></table></div>
      {filtered.length > 0 && <footer className="table-footer labs-ingredients-footer"><span className="pagination-summary">{pageStart + 1}–{pageEnd} of {filtered.length} ingredients</span><div className="pagination" aria-label="Ingredient inventory pagination"><Button variant="ghost" size="icon" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={currentPage === 1} aria-label="Previous page"><ChevronLeft size={16} /></Button>{pageItems.map((item, index) => typeof item !== "number" ? <span className="pagination-ellipsis" key={`ellipsis-${index}`}>…</span> : <Button variant="ghost" size="compact" key={item} className={item === currentPage ? "is-current" : ""} aria-current={item === currentPage ? "page" : undefined} onClick={() => setPage(item)}>{item}</Button>)}<Button variant="ghost" size="icon" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={currentPage === totalPages} aria-label="Next page"><ChevronRight size={16} /></Button></div></footer>}
      {!filtered.length && <div className="table-empty">No ingredients match that search.</div>}
    </div>
    <Dialog open={Boolean(editing)} onOpenChange={(open) => { if (!open && !saving) setEditing(null); }}><DialogContent className="lab-batch-dialog" aria-describedby="lab-ingredient-description"><div className="lab-batch-dialog__header"><DialogTitle>Update ingredient</DialogTitle><DialogDescription id="lab-ingredient-description">Record the current physical amount in grams. This does not affect products or packaging.</DialogDescription></div><form onSubmit={save}><div className="lab-batch-fields"><label><span>Ingredient</span><Input value={editing?.title ?? ""} disabled /></label><label><span>Quantity on hand (g)</span><Input value={quantity} onChange={(event) => setQuantity(event.target.value)} type="number" inputMode="decimal" min="0" step="0.001" autoFocus /></label><label><span>Reorder point (g)</span><Input value={reorder} onChange={(event) => setReorder(event.target.value)} type="number" inputMode="decimal" min="0" step="0.001" placeholder="Optional" /></label></div>{error && <p className="lab-form-error" role="alert">{error}</p>}<div className="lab-batch-actions"><Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>Cancel</Button><Button variant="primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save ingredient"}</Button></div></form></DialogContent></Dialog>
  </section>;
}
