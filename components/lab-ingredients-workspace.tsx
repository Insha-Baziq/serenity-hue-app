"use client";

import { ArrowLeft, ChevronLeft, ChevronRight, FileUp, Pencil, Plus, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
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
  const [adding, setAdding] = useState(false); const [newTitle, setNewTitle] = useState(""); const [newQuantity, setNewQuantity] = useState(""); const [newReorder, setNewReorder] = useState(""); const [addError, setAddError] = useState(""); const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false); const [importMessage, setImportMessage] = useState(""); const [importError, setImportError] = useState(""); const importInput = useRef<HTMLInputElement>(null);
  const [deleting, setDeleting] = useState<LabIngredient | null>(null); const [deleteError, setDeleteError] = useState(""); const [removing, setRemoving] = useState(false);
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
  async function addIngredient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setAddError("");
    const amount = newQuantity.trim() ? Number(newQuantity) : undefined;
    const point = newReorder.trim() ? Number(newReorder) : undefined;
    if (!newTitle.trim()) { setAddError("Enter an ingredient name."); return; }
    if ((amount !== undefined && (!Number.isFinite(amount) || amount < 0)) || (point !== undefined && (!Number.isFinite(point) || point < 0))) { setAddError("Enter zero or a positive number of grams."); return; }
    setCreating(true);
    try {
      const response = await fetch("/api/labs/ingredients", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: newTitle, quantityGrams: amount, reorderPointGrams: point }) });
      const result = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) { setAddError(result.message || "Unable to add this ingredient."); return; }
      const addedTitle = newTitle.trim(); setAdding(false); setNewTitle(""); setNewQuantity(""); setNewReorder(""); setImportMessage(`Added ${addedTitle} to ingredient inventory.`); router.refresh();
    } catch { setAddError("Unable to add this ingredient. Check your connection and try again."); } finally { setCreating(false); }
  }
  async function importCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImportError(""); setImportMessage(""); setImporting(true);
    try {
      const form = new FormData(); form.set("file", file);
      const response = await fetch("/api/labs/ingredients/import", { method: "POST", body: form });
      const result = await response.json().catch(() => ({})) as { message?: string; createdCount?: number; skippedCount?: number };
      if (!response.ok) { setImportError(result.message || "Unable to import this CSV."); return; }
      const createdCount = result.createdCount ?? 0; const skippedCount = result.skippedCount ?? 0;
      setImportMessage(`Imported ${createdCount} ingredient${createdCount === 1 ? "" : "s"}${skippedCount ? `; skipped ${skippedCount} already in inventory` : ""}.`); router.refresh();
    } catch { setImportError("Unable to import this CSV. Check the file and try again."); } finally { setImporting(false); }
  }
  function requestDelete(item: LabIngredient) {
    setDeleting(item);
    setDeleteError(item.usedByFormulaCount ? "Ingredient linked to formula. Remove it from the formula before deleting it." : "");
  }
  async function removeIngredient() {
    if (!deleting) return;
    setDeleteError(""); setRemoving(true);
    try {
      const response = await fetch("/api/labs/ingredients", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: deleting.id }) });
      const result = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) { setDeleteError(result.message || "Unable to delete this ingredient."); return; }
      const title = deleting.title; setDeleting(null); setImportError(""); setImportMessage(`${title} was removed from active ingredient inventory.`); router.refresh();
    } catch { setDeleteError("Unable to delete this ingredient. Check your connection and try again."); } finally { setRemoving(false); }
  }
  return <section className="workspace workspace--labs">
    <Link className="labs-back" href="/labs"><ArrowLeft size={16} />Labs</Link>
    <header className="workspace-header labs-header"><div><h1>Ingredient inventory</h1><p className="workspace-description">A separate gram-based inventory used only for production batches.</p></div><div className="labs-ingredient-actions"><Button variant="outline" onClick={() => { setAddError(""); setAdding(true); }}><Plus size={16} />Add ingredient</Button><Button variant="primary" onClick={() => importInput.current?.click()} disabled={importing}><FileUp size={16} />{importing ? "Importing…" : "Import CSV"}</Button><input ref={importInput} className="labs-ingredient-file-input" type="file" accept=".csv,text/csv" onChange={importCsv} aria-label="Choose ingredient CSV file" /></div></header>
    {(importMessage || importError) && <p className={importError ? "lab-form-error labs-ingredient-import-status" : "labs-ingredient-import-status"} role={importError ? "alert" : "status"}>{importError || importMessage}</p>}
    <div className="labs-ingredients-frame"><div className="inventory-toolbar"><label className="search-field search-field--inventory"><Search size={18} aria-hidden="true" /><span className="sr-only">Search ingredients</span><Input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Search ingredients" /></label><p className="labs-ingredient-csv-hint">CSV columns: <code>ingredient</code> or <code>title</code>; optional <code>quantity_grams</code> and <code>reorder_point_grams</code>. Blank quantities stay Not counted.</p></div>
      <div className="labs-ingredients-scroll"><table className="labs-ingredients-table"><thead><tr><th>Ingredient</th><th>On hand</th><th>Reorder point</th><th>Used in formulas</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{visibleItems.map((item) => <tr key={item.id}><td><strong>{item.title}</strong></td><td className={item.quantityKnown ? "" : "labs-not-counted"}>{item.quantityKnown ? formatGrams(item.quantityGrams) : "Not counted"}</td><td>{item.reorderPointGrams ? formatGrams(item.reorderPointGrams) : "—"}</td><td>{item.usedByFormulaCount}</td><td><div className="labs-ingredient-row-actions"><button className="labs-edit-button" type="button" onClick={() => edit(item)} aria-label={`Update ${item.title}`}><Pencil size={16} /></button><button className="labs-delete-button" type="button" onClick={() => requestDelete(item)} aria-label={`Delete ${item.title}`} title="Delete ingredient"><Trash2 size={16} /></button></div></td></tr>)}</tbody></table></div>
      {filtered.length > 0 && <footer className="table-footer labs-ingredients-footer"><span className="pagination-summary">{pageStart + 1}–{pageEnd} of {filtered.length} ingredients</span><div className="pagination" aria-label="Ingredient inventory pagination"><Button variant="ghost" size="icon" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={currentPage === 1} aria-label="Previous page"><ChevronLeft size={16} /></Button>{pageItems.map((item, index) => typeof item !== "number" ? <span className="pagination-ellipsis" key={`ellipsis-${index}`}>…</span> : <Button variant="ghost" size="compact" key={item} className={item === currentPage ? "is-current" : ""} aria-current={item === currentPage ? "page" : undefined} onClick={() => setPage(item)}>{item}</Button>)}<Button variant="ghost" size="icon" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={currentPage === totalPages} aria-label="Next page"><ChevronRight size={16} /></Button></div></footer>}
      {!filtered.length && <div className="table-empty">No ingredients match that search.</div>}
    </div>
    <Dialog open={adding} onOpenChange={(open) => { if (!open && !creating) { setAdding(false); setAddError(""); } }}><DialogContent className="lab-batch-dialog labs-add-ingredient-dialog" aria-describedby="lab-add-ingredient-description"><div className="lab-batch-dialog__header"><DialogTitle>Add ingredient</DialogTitle><DialogDescription id="lab-add-ingredient-description">Add a production material to Labs. It stays separate from product and packaging inventory.</DialogDescription></div><form onSubmit={addIngredient}><div className="lab-batch-fields labs-add-ingredient-fields"><label className="labs-add-ingredient-name"><span>Ingredient name</span><Input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} maxLength={180} autoFocus placeholder="e.g. Rosehip oil" /></label><label><span>Quantity on hand (g) <i>optional</i></span><Input value={newQuantity} onChange={(event) => setNewQuantity(event.target.value)} type="number" inputMode="decimal" min="0" max="10000000" step="0.001" placeholder="Leave blank if not counted" /></label><label><span>Reorder point (g) <i>optional</i></span><Input value={newReorder} onChange={(event) => setNewReorder(event.target.value)} type="number" inputMode="decimal" min="0" max="10000000" step="0.001" placeholder="0" /></label></div>{addError && <p className="lab-form-error" role="alert">{addError}</p>}<div className="lab-batch-actions"><Button variant="outline" onClick={() => setAdding(false)} disabled={creating}>Cancel</Button><Button variant="primary" type="submit" disabled={creating}>{creating ? "Adding…" : "Add ingredient"}</Button></div></form></DialogContent></Dialog>
    <Dialog open={Boolean(deleting)} onOpenChange={(open) => { if (!open && !removing) { setDeleting(null); setDeleteError(""); } }}><DialogContent className="lab-batch-dialog labs-delete-ingredient-dialog" aria-describedby="lab-delete-ingredient-description"><div className="lab-batch-dialog__header"><DialogTitle>{deleteError ? "Cannot delete ingredient" : "Delete ingredient?"}</DialogTitle><DialogDescription id="lab-delete-ingredient-description">{deleteError ? "This ingredient is still in use. Remove its formula link first." : <>{deleting?.title} will be removed from active inventory. Any historical ledger entries are retained.</>}</DialogDescription></div>{deleteError && <p className="lab-form-error labs-delete-ingredient-error" role="alert">{deleteError}</p>}<div className="lab-batch-actions"><Button variant="outline" onClick={() => { setDeleting(null); setDeleteError(""); }} disabled={removing}>{deleteError ? "Close" : "Cancel"}</Button>{!deleteError && <Button variant="primary" className="labs-delete-confirm" onClick={removeIngredient} disabled={removing}>{removing ? "Deleting…" : "Delete ingredient"}</Button>}</div></DialogContent></Dialog>
    <Dialog open={Boolean(editing)} onOpenChange={(open) => { if (!open && !saving) setEditing(null); }}><DialogContent className="lab-batch-dialog" aria-describedby="lab-ingredient-description"><div className="lab-batch-dialog__header"><DialogTitle>Update ingredient</DialogTitle><DialogDescription id="lab-ingredient-description">Record the current physical amount in grams. This does not affect products or packaging.</DialogDescription></div><form onSubmit={save}><div className="lab-batch-fields"><label><span>Ingredient</span><Input value={editing?.title ?? ""} disabled /></label><label><span>Quantity on hand (g)</span><Input value={quantity} onChange={(event) => setQuantity(event.target.value)} type="number" inputMode="decimal" min="0" step="0.001" autoFocus /></label><label><span>Reorder point (g)</span><Input value={reorder} onChange={(event) => setReorder(event.target.value)} type="number" inputMode="decimal" min="0" step="0.001" placeholder="Optional" /></label></div>{error && <p className="lab-form-error" role="alert">{error}</p>}<div className="lab-batch-actions"><Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>Cancel</Button><Button variant="primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save ingredient"}</Button></div></form></DialogContent></Dialog>
  </section>;
}
