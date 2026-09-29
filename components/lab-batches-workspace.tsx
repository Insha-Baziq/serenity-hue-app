"use client";

import { ArrowLeft, ArrowRight, Beaker, ClipboardList, PackageCheck, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { LabBatch } from "@/lib/types";
import { relativeTime } from "@/lib/format";

export function LabBatchesWorkspace({ batches: initialBatches, formula }: { batches: LabBatch[]; formula: { id: string; title: string } | null }) {
  const [batches, setBatches] = useState(initialBatches);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = batches.find((batch) => batch.id === selectedId) ?? null;
  const heading = formula ? `${formula.title} batches` : "Batches";

  function openBatch(batch: LabBatch) {
    setSelectedId(batch.id);
  }

  function updateBatch(next: LabBatch) {
    setBatches((current) => current.map((batch) => batch.id === next.id ? next : batch));
  }

  return <section className="workspace workspace--labs">
    <Link className="labs-back" href={formula ? `/labs/${formula.id}` : "/labs"}><ArrowLeft size={16} />{formula ? formula.title : "Labs"}</Link>
    <header className="workspace-header labs-header"><div><h1>{heading}</h1></div>{formula && <Link className="ui-button ui-button--outline ui-button--default-size" href="/labs/batches"><ClipboardList size={17} />All batches</Link>}</header>
    {batches.length ? <section className="labs-batches-panel" aria-label={formula ? `${formula.title} batch history` : "All batch history"}><Table className="labs-batches-table"><TableHeader><TableRow><TableHead>Batch</TableHead><TableHead>Formula</TableHead><TableHead>Created</TableHead><TableHead>Batch size</TableHead><TableHead>Packaged so far</TableHead><TableHead>Remaining bulk</TableHead><TableHead><span className="sr-only">Open</span></TableHead></TableRow></TableHeader><TableBody>{batches.map((batch) => <TableRow className="labs-batches-table__row" key={batch.id} onClick={() => openBatch(batch)}><TableCell><strong>{batchLabel(batch.batchNumber)}</strong></TableCell><TableCell><span className="labs-batches-table__formula">{batch.formula}</span></TableCell><TableCell><span>{relativeTime(batch.createdAt)}</span><small>{batch.actor}</small></TableCell><TableCell><strong>{formatQuantity(batch.outputQuantity, batch.outputUnit)}</strong></TableCell><TableCell><strong>{formatQuantity(batch.packagedQuantity, batch.outputUnit)}</strong></TableCell><TableCell><strong>{formatQuantity(batch.remainingQuantity, batch.outputUnit)}</strong></TableCell><TableCell className="labs-batches-table__action"><Button variant="ghost" size="icon" onClick={(event) => { event.stopPropagation(); openBatch(batch); }} aria-label={`Open ${batchLabel(batch.batchNumber)}`}><ArrowRight size={17} aria-hidden="true" /></Button></TableCell></TableRow>)}</TableBody></Table></section> : <div className="labs-empty"><Beaker size={20} /><p>{formula ? "No batches have been created from this formula yet." : "No batches have been created yet. Open a formula when you are ready to create the first one."}</p></div>}
    <BatchPackagingSheet key={selected?.id ?? "closed"} batch={selected} onOpenChange={(open) => !open && setSelectedId(null)} onSaved={updateBatch} />
  </section>;
}

function BatchPackagingSheet({ batch, onOpenChange, onSaved }: { batch: LabBatch | null; onOpenChange: (open: boolean) => void; onSaved: (batch: LabBatch) => void }) {
  const [draft, setDraft] = useState("");
  const [updateInventory, setUpdateInventory] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const added = Number(draft);
  const valid = draft.trim() !== "" && Number.isFinite(added) && added > 0;
  const nextPackaged = valid && batch ? batch.packagedQuantity + added : batch?.packagedQuantity ?? 0;
  const remaining = valid && batch ? Math.max(0, batch.remainingQuantity - added) : batch?.remainingQuantity ?? 0;
  const addedUnits = useMemo(() => {
    if (!batch || !valid || !batch.output || batch.outputUnit !== batch.output.fillUnit) return null;
    const units = added / batch.output.fillQuantity;
    return Number.isInteger(units) ? units : null;
  }, [added, batch, valid]);

  async function save() {
    if (!batch || !valid) { setError("Enter the amount packaged now."); return; }
    if (added > batch.remainingQuantity + 0.000001) { setError(`You can add up to ${formatQuantity(batch.remainingQuantity, batch.outputUnit)} from this batch.`); return; }
    if (!batch.output) { setError("Set packaging details for this formula before adding finished units."); return; }
    if (addedUnits === null) { setError(`Use an amount that makes complete ${formatQuantity(batch.output.fillQuantity, batch.output.fillUnit)} units.`); return; }
    setSaving(true); setError("");
    try {
      const response = await fetch(`/api/labs/batches/${encodeURIComponent(batch.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ addedQuantity: added, updateInventory }) });
      const result = await response.json().catch(() => ({})) as { ok?: boolean; message?: string; batch?: LabBatch };
      if (!response.ok || !result.ok || !result.batch) { setError(result.message || "Unable to update this batch."); return; }
      onSaved(result.batch); onOpenChange(false);
    } catch { setError("Unable to update this batch. Check your connection and try again."); }
    finally { setSaving(false); }
  }

  return <Sheet open={Boolean(batch)} onOpenChange={onOpenChange}><SheetContent className="lab-batch-sheet" aria-describedby="lab-batch-sheet-description">
    {batch && <div className="lab-batch-sheet__body"><header className="lab-batch-sheet__header"><SheetTitle>{batchLabel(batch.batchNumber)}</SheetTitle><SheetDescription id="lab-batch-sheet-description">{batch.formula}</SheetDescription><p>Created {relativeTime(batch.createdAt)} by {batch.actor}</p></header>
      <dl className="lab-batch-sheet__totals"><div><dt>Batch size</dt><dd>{formatQuantity(batch.outputQuantity, batch.outputUnit)}</dd></div><div><dt>Packaged so far</dt><dd>{formatQuantity(batch.packagedQuantity, batch.outputUnit)}</dd></div><div><dt>Remaining bulk</dt><dd>{formatQuantity(batch.remainingQuantity, batch.outputUnit)}</dd></div></dl>
      <section className="lab-batch-sheet__packaging" aria-labelledby="lab-batch-packaging-heading"><div className="lab-batch-sheet__packaging-heading"><h3 id="lab-batch-packaging-heading">Add packaged amount</h3><p>Enter only the amount packaged now. It will be added to the saved total above.</p></div><label><span>Amount packaged now ({batch.outputUnit === "ml" ? "mL" : "g"})</span><Input value={draft} onChange={(event) => { setDraft(event.target.value); setError(""); }} type="number" inputMode="decimal" min="0.001" max={batch.remainingQuantity} step="0.001" placeholder="e.g. 500" aria-describedby="lab-packaged-limit" autoFocus /><small id="lab-packaged-limit">Maximum available: {formatQuantity(batch.remainingQuantity, batch.outputUnit)}</small></label><label className="lab-batch-sheet__inventory-toggle"><input type="checkbox" checked={!updateInventory} onChange={(event) => setUpdateInventory(!event.target.checked)} /><span><strong>DON&apos;T UPDATE INVENTORY</strong><small>When checked, this packaging is recorded on the batch but master inventory stays unchanged.</small></span></label>{batch.output ? <div className="lab-batch-sheet__output"><PackageCheck size={16} /><span><strong>{batch.output.product} · {batch.output.variant}</strong><small>{formatQuantity(batch.output.fillQuantity, batch.output.fillUnit)} per finished unit</small></span></div> : <div className="lab-batch-sheet__warning"><TriangleAlert size={16} /><span>Set packaging details on the formula before adding finished units.</span></div>}{valid && <div className="lab-batch-sheet__preview"><span>After saving</span><strong>{formatQuantity(nextPackaged, batch.outputUnit)} packaged</strong><small>{formatQuantity(remaining, batch.outputUnit)} remaining{addedUnits !== null ? ` · ${addedUnits} finished unit${addedUnits === 1 ? "" : "s"} ${updateInventory ? "added to master inventory" : "recorded; master inventory unchanged"}` : " · amount must make complete finished units"}</small></div>}{error && <p className="lab-form-error" role="alert"><TriangleAlert size={16} />{error}</p>}<Button className="lab-batch-sheet__save" variant="primary" type="button" onClick={save} disabled={saving || !valid}>{saving ? "Saving…" : updateInventory ? "Add to packaged total and inventory" : "Add packaged amount only"}</Button></section>
    </div>}
  </SheetContent></Sheet>;
}

function batchLabel(value: string) {
  const trimmed = value.trim();
  return /^batch\b/i.test(trimmed) ? trimmed : `Batch ${trimmed}`;
}

function formatQuantity(value: number, unit: "g" | "ml") {
  return `${value.toLocaleString("en-GB", { maximumFractionDigits: 3 })} ${unit === "ml" ? "mL" : "g"}`;
}
