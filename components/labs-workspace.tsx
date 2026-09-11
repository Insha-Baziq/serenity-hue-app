"use client";

import { ArrowRight, Boxes, ClipboardList, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { LabFormula, LabIngredient } from "@/lib/types";

type DraftLine = { key: string; ingredient: string; calculation: "fixed" | "remainder" | "manual"; percentage: string; phase: string; note: string };
const blankLine = (): DraftLine => ({ key: crypto.randomUUID(), ingredient: "", calculation: "fixed", percentage: "", phase: "", note: "" });

export function LabsWorkspace({ formulas, ingredients }: { formulas: LabFormula[]; ingredients: LabIngredient[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false); const [title, setTitle] = useState(""); const [subtitle, setSubtitle] = useState(""); const [notes, setNotes] = useState(""); const [lines, setLines] = useState<DraftLine[]>([blankLine()]); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  function close() { if (saving) return; setOpen(false); setTitle(""); setSubtitle(""); setNotes(""); setLines([blankLine()]); setError(""); }
  function updateLine(key: string, patch: Partial<DraftLine>) { setLines((current) => current.map((line) => line.key === key ? { ...line, ...patch } : line)); }
  async function addFormula(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    if (!title.trim()) { setError("Give this formula a clear name."); return; }
    if (lines.some((line) => !line.ingredient.trim())) { setError("Name every ingredient or remove the empty row."); return; }
    if (lines.some((line) => line.calculation === "fixed" && (!Number.isFinite(Number(line.percentage)) || Number(line.percentage) <= 0))) { setError("Add a percentage for each fixed-ratio ingredient."); return; }
    if (lines.filter((line) => line.calculation === "remainder").length > 1) { setError("Use only one remainder-to-100% ingredient."); return; }
    setSaving(true);
    try {
      const response = await fetch("/api/labs/formulas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, subtitle, notes, lines: lines.map(({ ingredient, calculation, percentage, phase, note }) => ({ ingredient, calculation, percentage: calculation === "fixed" ? Number(percentage) : undefined, phase, note })) }) });
      const result = await response.json().catch(() => ({})) as { message?: string; formula?: LabFormula };
      if (!response.ok || !result.formula) { setError(result.message || "Unable to create this formula."); return; }
      close(); router.push(`/labs/${result.formula.id}`); router.refresh();
    } catch { setError("Unable to create this formula. Check your connection and try again."); } finally { setSaving(false); }
  }
  return <section className="workspace workspace--labs">
    <header className="workspace-header labs-header">
      <div><h1>Labs</h1></div>
      <div className="labs-header-actions">
        <Link className="ui-button ui-button--outline ui-button--default-size" href="/labs/ingredients"><Boxes size={17} />Ingredient inventory</Link>
        <Link className="ui-button ui-button--outline ui-button--default-size" href="/labs/batches"><ClipboardList size={17} />Batches</Link>
      </div>
    </header>
    <section aria-labelledby="lab-formulas-heading">
      <div className="labs-section-heading"><div><h2 id="lab-formulas-heading">Formulas</h2></div><Button variant="primary" onClick={() => setOpen(true)}><Plus size={17} />Add formula</Button></div>
      <div className="labs-formula-grid">{formulas.map((formula) => <Link className="labs-formula-card" href={`/labs/${formula.id}`} key={formula.id}><span className="labs-formula-card__body"><strong>{formula.title}</strong><small>{formula.subtitle || "Formula details to be confirmed"}</small></span><span className="labs-formula-card__footer"><em>{formula.ingredientCount} {formula.ingredientCount === 1 ? "ingredient" : "ingredients"}</em><span>Open <ArrowRight size={15} aria-hidden="true" /></span></span></Link>)}</div>
    </section>
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent className="lab-batch-dialog lab-formula-dialog" aria-describedby="lab-formula-description">
        <div className="lab-batch-dialog__header"><DialogTitle>Add formula</DialogTitle><DialogDescription id="lab-formula-description">Capture the ratio now. Named ingredients are added to the separate ingredient inventory as Not counted, ready for a physical count.</DialogDescription></div>
        <form onSubmit={addFormula}>
          <div className="lab-formula-builder__details"><label><span>Formula name</span><Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={140} autoFocus placeholder="e.g. Daily Barrier Serum" /></label><label><span>Short description</span><Input value={subtitle} onChange={(event) => setSubtitle(event.target.value)} maxLength={200} placeholder="e.g. Working formula v1" /></label><label><span>Formula notes</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1400} placeholder="Safety, pH, stability, or handling notes" /></label></div>
          <div className="lab-formula-builder__heading"><div><h3>Ingredients & ratios</h3><p>Use “remainder to 100%” for one water or carrier base. Manual q.s. lines remain visible but are never auto-deducted.</p></div><Button variant="ghost" size="compact" onClick={() => setLines((current) => [...current, blankLine()])}><Plus size={15} />Add ingredient</Button></div>
          <div className="lab-formula-builder__rows">{lines.map((line, index) => <div className="lab-formula-builder__row" key={line.key}>
            <label><span>Ingredient</span><Input list="lab-ingredient-names" value={line.ingredient} onChange={(event) => updateLine(line.key, { ingredient: event.target.value })} placeholder="Start typing or add new" /></label>
            <label>
              <span>Calculation</span>
              <Select value={line.calculation} onValueChange={(value) => updateLine(line.key, { calculation: value as DraftLine["calculation"], percentage: value === "fixed" ? line.percentage : "" })}>
                <SelectTrigger className="lab-formula-builder__calculation-select" aria-label={`Calculation for ingredient ${index + 1}`}><SelectValue /></SelectTrigger>
                <SelectContent side="bottom" align="start" avoidCollisions={false}><SelectItem value="fixed">Fixed %</SelectItem><SelectItem value="remainder">Remainder to 100%</SelectItem><SelectItem value="manual">Manual q.s.</SelectItem></SelectContent>
              </Select>
            </label>
            {line.calculation === "fixed" ? <label><span>Ratio (%)</span><Input value={line.percentage} onChange={(event) => updateLine(line.key, { percentage: event.target.value })} type="number" inputMode="decimal" min="0.001" max="100" step="0.001" placeholder="0.0" /></label> : <div className="lab-formula-builder__calculation-note">{line.calculation === "remainder" ? "Calculated from the remaining percentage." : "Shown on formula; excluded from auto-deduction."}</div>}
            <label><span>Phase <i>optional</i></span><Input value={line.phase} onChange={(event) => updateLine(line.key, { phase: event.target.value })} maxLength={40} placeholder="A" /></label>
            <label className="lab-formula-builder__note"><span>Note <i>optional</i></span><Input value={line.note} onChange={(event) => updateLine(line.key, { note: event.target.value })} maxLength={500} placeholder="e.g. q.s. for pH" /></label>
            <Button variant="ghost" size="icon" className="lab-formula-builder__remove" onClick={() => lines.length > 1 && setLines((current) => current.filter((item) => item.key !== line.key))} disabled={lines.length === 1} aria-label={`Remove ingredient ${index + 1}`}><Trash2 size={16} /></Button>
          </div>)}</div>
          <datalist id="lab-ingredient-names">{ingredients.map((ingredient) => <option key={ingredient.id} value={ingredient.title} />)}</datalist>
          {error && <p className="lab-form-error" role="alert">{error}</p>}
          <div className="lab-batch-actions"><Button variant="outline" onClick={close} disabled={saving}>Cancel</Button><Button variant="primary" type="submit" disabled={saving}>{saving ? "Creating…" : "Create formula"}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  </section>;
}

export function formatGrams(value: number) {
  if (value >= 1000 && value % 1000 === 0) return `${value / 1000} kg`;
  return `${value.toLocaleString("en-GB", { maximumFractionDigits: 3 })} g`;
}
