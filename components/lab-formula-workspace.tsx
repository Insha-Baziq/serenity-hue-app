"use client";

import { ArrowLeft, Beaker, ClipboardList, FlaskConical, Info, PackageCheck, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { formatGrams } from "@/components/labs-workspace";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { LabFormula, PhysicalInventoryItem } from "@/lib/types";

type QuantityUnit = "g" | "ml";

export function LabFormulaWorkspace({ formula, physicalInventory }: { formula: LabFormula; physicalInventory: PhysicalInventoryItem[] }) {
  const router = useRouter();
  const outputOptions = physicalInventory.flatMap((item) => item.variants.map((variant) => ({ id: variant.id, label: `${item.title} · ${variant.title}` })));
  const [open, setOpen] = useState(false);
  const [outputOpen, setOutputOpen] = useState(false);
  const [batchNumber, setBatchNumber] = useState("");
  const [grams, setGrams] = useState("");
  const [outputVariantId, setOutputVariantId] = useState(formula.output?.physicalVariantId ?? "");
  const [fillQuantity, setFillQuantity] = useState(formula.output ? String(formula.output.fillQuantity) : "");
  const [fillUnit, setFillUnit] = useState<QuantityUnit>(formula.output?.fillUnit ?? "ml");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [savingOutput, setSavingOutput] = useState(false);
  const target = Number(grams);
  const preview = useMemo(() => calculate(formula, target), [formula, target]);

  async function createBatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!Number.isFinite(target) || target <= 0) { setError("Enter a calculation batch size greater than zero in grams."); return; }
    if (!batchNumber.trim()) { setError("Enter the batch number."); return; }
    setSubmitting(true);
    try {
      const response = await fetch("/api/labs/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ formulaId: formula.id, batchNumber: batchNumber.trim(), targetGrams: target }),
      });
      const result = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) { setError(result.message || "Unable to create this batch."); return; }
      setOpen(false);
      setBatchNumber(""); setGrams("");
      router.push("/labs"); router.refresh();
    } catch { setError("Unable to create this batch. Check your connection and try again."); }
    finally { setSubmitting(false); }
  }

  async function saveOutput(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!outputVariantId || !Number.isFinite(Number(fillQuantity)) || Number(fillQuantity) <= 0) { setError("Choose a master-inventory variant and enter its per-unit fill amount."); return; }
    setSavingOutput(true);
    try {
      const response = await fetch(`/api/labs/formulas/${encodeURIComponent(formula.id)}/output`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ physicalVariantId: outputVariantId, fillQuantity: Number(fillQuantity), fillUnit }) });
      const result = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) { setError(result.message || "Unable to save packaging setup."); return; }
      setOutputOpen(false);
      router.refresh();
    } catch { setError("Unable to save packaging setup. Check your connection and try again."); }
    finally { setSavingOutput(false); }
  }

  return <section className="workspace workspace--labs">
    <Link className="labs-back" href="/labs"><ArrowLeft size={16} />Labs</Link>
    <header className="labs-formula-header"><span className="labs-formula-header__mark"><FlaskConical size={28} strokeWidth={1.45} /></span><div><h1>{formula.title}</h1><p>{formula.subtitle}</p></div><div className="labs-formula-header__actions"><Link className="ui-button ui-button--outline ui-button--default-size" href={`/labs/batches?formula=${encodeURIComponent(formula.id)}`}><ClipboardList size={17} />Batches</Link><Button variant="outline" size="compact" onClick={() => { setError(""); setOutputOpen(true); }}><PackageCheck size={15} />{formula.output ? "Packaging" : "Set packaging"}</Button><Button variant="primary" onClick={() => { setError(""); setOpen(true); }}><Beaker size={17} />Create batch</Button></div></header>

    <section className="labs-recipe" aria-labelledby="formula-ratio-heading"><div className="labs-section-heading"><div><h2 id="formula-ratio-heading">Formula ratio</h2><p>Ingredient ratios used for batch calculations.</p></div></div><div className="labs-recipe-table-wrap"><table className="labs-recipe-table"><thead><tr><th>Ingredient</th><th>Phase</th><th>Ratio</th><th>Inventory</th></tr></thead><tbody>{formula.lines.map((line) => <tr key={line.ingredientId}><td><strong>{line.ingredient}</strong>{line.note && <small>{line.note}</small>}</td><td>{line.phase || "—"}</td><td>{line.calculation === "remainder" ? "Remainder to 100%" : line.calculation === "manual" ? "Manual q.s." : `${line.percentage}%`}</td><td>{line.quantityKnown ? formatGrams(line.quantityGrams) : "Not counted"}</td></tr>)}</tbody></table></div></section>

    <Dialog open={outputOpen} onOpenChange={(next) => { if (!savingOutput) setOutputOpen(next); }}><DialogContent className="lab-output-dialog" aria-describedby="lab-output-dialog-description"><div className="lab-output-dialog__header"><p className="workspace-kicker">Packaging setup</p><DialogTitle>Finished product</DialogTitle><DialogDescription id="lab-output-dialog-description">Choose the product variant and fill size used when this formula is packaged.</DialogDescription></div><form onSubmit={saveOutput}><div className="lab-output-dialog__fields"><label><span>Product variant</span><Select value={outputVariantId || "none"} onValueChange={(value) => setOutputVariantId(value === "none" ? "" : value)}><SelectTrigger><SelectValue placeholder="Choose a variant" /></SelectTrigger><SelectContent><SelectItem value="none">Choose a variant</SelectItem>{outputOptions.map((option) => <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>)}</SelectContent></Select></label><label><span>Fill amount <i>per unit</i></span><Input value={fillQuantity} onChange={(event) => setFillQuantity(event.target.value)} type="number" min="0.001" step="0.001" inputMode="decimal" placeholder="e.g. 10" /></label><label><span>Fill unit</span><Select value={fillUnit} onValueChange={(value) => setFillUnit(value as QuantityUnit)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ml">Milliliters (mL)</SelectItem><SelectItem value="g">Grams (g)</SelectItem></SelectContent></Select></label></div>{formula.output && <p className="lab-output-dialog__current">Currently set to {formula.output.product} · {formula.output.variant} at {formatQuantity(formula.output.fillQuantity, formula.output.fillUnit)} per unit.</p>}{error && <p className="lab-form-error" role="alert"><TriangleAlert size={16} />{error}</p>}<div className="lab-batch-actions"><Button variant="outline" type="button" onClick={() => setOutputOpen(false)} disabled={savingOutput}>Cancel</Button><Button variant="primary" type="submit" disabled={savingOutput}>{savingOutput ? "Saving…" : "Save packaging"}</Button></div></form></DialogContent></Dialog>

    <Dialog open={open} onOpenChange={(next) => { if (!submitting) setOpen(next); }}><DialogContent className="lab-batch-dialog" aria-describedby="lab-batch-description"><div className="lab-batch-dialog__header"><DialogTitle>Create batch</DialogTitle><DialogDescription id="lab-batch-description">Enter the batch number and size. Ingredient stock is checked for reference but will not block creation.</DialogDescription></div><form onSubmit={createBatch}><div className="lab-batch-fields"><label><span>Batch number</span><Input value={batchNumber} onChange={(event) => setBatchNumber(event.target.value)} placeholder="e.g. UES-2026-001" maxLength={80} autoFocus /></label><label><span>Batch size (g)</span><Input value={grams} onChange={(event) => setGrams(event.target.value)} type="number" inputMode="decimal" min="0.001" step="0.001" placeholder="e.g. 5000" /></label></div>{Number.isFinite(target) && target > 0 && <div className="lab-batch-preview"><h3>Review ingredient requirements</h3>{preview.map((line) => <div key={line.ingredientId}><span>{line.ingredient}</span><strong>{formatGrams(line.required)}</strong><small>{line.state}</small></div>)}{formula.lines.some((line) => line.calculation === "manual") && <p><Info size={15} />Manual q.s. pH-adjustment ingredients are shown on the formula but excluded from automated deductions.</p>}</div>}{error && <p className="lab-form-error" role="alert"><TriangleAlert size={16} />{error}</p>}<div className="lab-batch-actions"><Button variant="outline" type="button" onClick={() => setOpen(false)} disabled={submitting}>Cancel</Button><Button variant="primary" type="submit" disabled={submitting}>{submitting ? "Creating…" : "Confirm & create batch"}</Button></div></form></DialogContent></Dialog>
  </section>;
}

function calculate(formula: LabFormula, target: number) {
  const fixed = formula.lines.filter((line) => line.calculation === "fixed").reduce((total, line) => total + (line.percentage ?? 0), 0);
  return formula.lines.flatMap((line) => {
    if (line.calculation === "manual") return [];
    const percentage = line.calculation === "remainder" ? 100 - fixed : line.percentage ?? 0;
    const required = Math.round(target * percentage * 10) / 1000;
    const remaining = Math.max(0, Math.round((line.quantityGrams - required) * 1000) / 1000);
    const state = !line.quantityKnown ? "Not counted — batch can still be created" : line.quantityGrams + 0.00001 < required ? "Insufficient count — no deduction recorded" : `${formatGrams(remaining)} remaining`;
    return [{ ...line, required, remaining, state }];
  });
}

function formatQuantity(value: number, unit: QuantityUnit) {
  return `${value.toLocaleString("en-GB", { maximumFractionDigits: 3 })} ${unit === "ml" ? "mL" : "g"}`;
}
