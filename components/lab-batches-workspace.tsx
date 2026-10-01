"use client";

import { ArrowLeft, ArrowRight, Beaker, ClipboardList, NotebookPen, PackageCheck, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatExactDateTime } from "@/lib/format";
import type { LabBatch } from "@/lib/types";

export function LabBatchesWorkspace({ batches: initialBatches, formula }: { batches: LabBatch[]; formula: { id: string; title: string } | null }) {
  const [batches, setBatches] = useState(initialBatches);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = batches.find((batch) => batch.id === selectedId) ?? null;
  const heading = formula ? `${formula.title} batches` : "Batches";

  function updateBatch(next: LabBatch) {
    setBatches((current) => current.map((batch) => batch.id === next.id ? next : batch));
  }

  return <section className="workspace workspace--labs">
    <Link className="labs-back" href={formula ? `/labs/${formula.id}` : "/labs"}><ArrowLeft size={16} />{formula ? formula.title : "Labs"}</Link>
    <header className="workspace-header labs-header"><div><h1>{heading}</h1></div>{formula && <Link className="ui-button ui-button--outline ui-button--default-size" href="/labs/batches"><ClipboardList size={17} />All batches</Link>}</header>
    {batches.length ? <section className="labs-batches-panel" aria-label={formula ? `${formula.title} batch history` : "All batch history"}>
      <Table className="labs-batches-table">
        <TableHeader><TableRow><TableHead>Batch</TableHead><TableHead>Formula</TableHead><TableHead>Created</TableHead><TableHead>Updated</TableHead><TableHead>Batch size</TableHead><TableHead>Packaged so far</TableHead><TableHead>Remaining bulk</TableHead><TableHead><span className="sr-only">Open</span></TableHead></TableRow></TableHeader>
        <TableBody>{batches.map((batch) => <TableRow className="labs-batches-table__row" key={batch.id} onClick={() => setSelectedId(batch.id)}>
          <TableCell><strong>{batchLabel(batch.batchNumber)}</strong></TableCell>
          <TableCell><span className="labs-batches-table__formula">{batch.formula}</span></TableCell>
          <TableCell><time dateTime={batch.createdAt}>{formatExactDateTime(batch.createdAt)}</time><small>by {batch.actor}</small></TableCell>
          <TableCell><time dateTime={batch.updatedAt}>{formatExactDateTime(batch.updatedAt)}</time></TableCell>
          <TableCell><strong>{formatQuantity(batch.outputQuantity, batch.outputUnit)}</strong></TableCell>
          <TableCell><strong>{formatQuantity(batch.packagedQuantity, batch.outputUnit)}</strong></TableCell>
          <TableCell><strong>{formatQuantity(batch.remainingQuantity, batch.outputUnit)}</strong></TableCell>
          <TableCell className="labs-batches-table__action"><Button variant="ghost" size="icon" onClick={(event) => { event.stopPropagation(); setSelectedId(batch.id); }} aria-label={`Open ${batchLabel(batch.batchNumber)}`}><ArrowRight size={17} aria-hidden="true" /></Button></TableCell>
        </TableRow>)}</TableBody>
      </Table>
    </section> : <div className="labs-empty"><Beaker size={20} /><p>{formula ? "No batches have been created from this formula yet." : "No batches have been created yet. Open a formula when you are ready to create the first one."}</p></div>}
    <BatchPackagingSheet key={selected?.id ?? "closed"} batch={selected} onOpenChange={(open) => !open && setSelectedId(null)} onSaved={updateBatch} />
  </section>;
}

function BatchPackagingSheet({ batch, onOpenChange, onSaved }: { batch: LabBatch | null; onOpenChange: (open: boolean) => void; onSaved: (batch: LabBatch) => void }) {
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notesOpen, setNotesOpen] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesError, setNotesError] = useState("");
  const added = Number(draft);
  const valid = draft.trim() !== "" && Number.isFinite(added) && added > 0;
  const nextPackaged = valid && batch ? batch.packagedQuantity + added : batch?.packagedQuantity ?? 0;
  const remaining = valid && batch ? Math.max(0, batch.remainingQuantity - added) : batch?.remainingQuantity ?? 0;
  const addedUnits = useMemo(() => {
    if (!batch || !valid || !batch.packaging || batch.outputUnit !== batch.packaging.fillUnit) return null;
    const units = added / batch.packaging.fillQuantity;
    return Number.isInteger(units) ? units : null;
  }, [added, batch, valid]);

  async function savePackaging() {
    if (!batch || !valid) { setError("Enter the amount packaged now."); return; }
    if (added > batch.remainingQuantity + 0.000001) { setError(`You can add up to ${formatQuantity(batch.remainingQuantity, batch.outputUnit)} from this batch.`); return; }
    if (batch.packaging && batch.outputUnit !== batch.packaging.fillUnit) { setError("The batch unit and formula fill unit must match before adding packaged amounts."); return; }
    if (batch.packaging && addedUnits === null) { setError(`Use an amount that makes complete ${formatQuantity(batch.packaging.fillQuantity, batch.packaging.fillUnit)} units.`); return; }
    setSaving(true); setError("");
    try {
      const response = await fetch(`/api/labs/batches/${encodeURIComponent(batch.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ addedQuantity: added }) });
      const result = await response.json().catch(() => ({})) as { ok?: boolean; message?: string; batch?: LabBatch };
      if (!response.ok || !result.ok || !result.batch) { setError(result.message || "Unable to update this batch."); return; }
      onSaved(result.batch); onOpenChange(false);
    } catch { setError("Unable to update this batch. Check your connection and try again."); }
    finally { setSaving(false); }
  }

  function openNotes() {
    if (!batch) return;
    setNotesDraft(batch.notes);
    setEditingNotes(!batch.notes);
    setNotesError("");
    setNotesOpen(true);
  }

  async function saveNotes() {
    if (!batch) return;
    setSavingNotes(true); setNotesError("");
    try {
      const response = await fetch(`/api/labs/batches/${encodeURIComponent(batch.id)}/notes`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: notesDraft, expectedUpdatedAt: batch.updatedAt }),
      });
      const result = await response.json().catch(() => ({})) as { ok?: boolean; message?: string; batch?: LabBatch };
      if (!response.ok || !result.ok || !result.batch) { setNotesError(result.message || "Unable to save batch notes."); return; }
      onSaved(result.batch);
      setEditingNotes(false);
      setNotesOpen(false);
    } catch { setNotesError("Unable to save batch notes. Check your connection and try again."); }
    finally { setSavingNotes(false); }
  }

  return <Sheet open={Boolean(batch)} onOpenChange={onOpenChange}>
    <SheetContent className="lab-batch-sheet" aria-describedby="lab-batch-sheet-description">
      {batch && <div className="lab-batch-sheet__body">
        <header className="lab-batch-sheet__header">
          <SheetTitle>{batchLabel(batch.batchNumber)}</SheetTitle>
          <SheetDescription id="lab-batch-sheet-description">{batch.formula}</SheetDescription>
          <p>Created <time dateTime={batch.createdAt}>{formatExactDateTime(batch.createdAt)}</time> by {batch.actor}</p>
          <p>Updated <time dateTime={batch.updatedAt}>{formatExactDateTime(batch.updatedAt)}</time></p>
        </header>
        <dl className="lab-batch-sheet__totals"><div><dt>Batch size</dt><dd>{formatQuantity(batch.outputQuantity, batch.outputUnit)}</dd></div><div><dt>Packaged so far</dt><dd>{formatQuantity(batch.packagedQuantity, batch.outputUnit)}</dd></div><div><dt>Remaining bulk</dt><dd>{formatQuantity(batch.remainingQuantity, batch.outputUnit)}</dd></div></dl>
        <section className="lab-batch-sheet__notes" aria-labelledby="lab-batch-notes-heading">
          <div><h3 id="lab-batch-notes-heading">Notes</h3><p>{batch.notes ? batch.notes : "No notes have been added to this batch."}</p></div>
          <Button variant="outline" size="compact" type="button" onClick={openNotes}><NotebookPen size={15} />{batch.notes ? "View notes" : "Add notes"}</Button>
        </section>
        <section className="lab-batch-sheet__packaging" aria-labelledby="lab-batch-packaging-heading"><div className="lab-batch-sheet__packaging-heading"><h3 id="lab-batch-packaging-heading">Add packaged amount</h3><p>Enter only the amount packaged now. Labs records the packaged units and remaining bulk separately from master on-hand.</p></div><label><span>Amount packaged now ({batch.outputUnit === "ml" ? "mL" : "g"})</span><Input value={draft} onChange={(event) => { setDraft(event.target.value); setError(""); }} type="number" inputMode="decimal" min="0.001" max={batch.remainingQuantity} step="0.001" placeholder="e.g. 500" aria-describedby="lab-packaged-limit" /><small id="lab-packaged-limit">Maximum available: {formatQuantity(batch.remainingQuantity, batch.outputUnit)}</small></label>{batch.packaging ? <div className="lab-batch-sheet__output"><PackageCheck size={16} /><span><strong>{formatQuantity(batch.packaging.fillQuantity, batch.packaging.fillUnit)} per finished unit</strong><small>Packaging details are stored in Labs only.</small></span></div> : <div className="lab-batch-sheet__warning"><TriangleAlert size={16} /><span>You can record the packaged amount now. Finished unit counts will be available after a unit fill size is set on the formula.</span></div>}{valid && <div className="lab-batch-sheet__preview"><span>After saving</span><strong>{formatQuantity(nextPackaged, batch.outputUnit)} packaged</strong><small>{formatQuantity(remaining, batch.outputUnit)} remaining{addedUnits !== null ? ` · ${addedUnits} finished unit${addedUnits === 1 ? "" : "s"} recorded in Labs` : batch.packaging ? " · amount must make complete finished units" : " · finished unit count unavailable"}</small></div>}{error && <p className="lab-form-error" role="alert"><TriangleAlert size={16} />{error}</p>}<Button className="lab-batch-sheet__save" variant="primary" type="button" onClick={savePackaging} disabled={saving || !valid}>{saving ? "Saving…" : "Save packaged amount"}</Button></section>
      </div>}
    </SheetContent>
    <Dialog open={notesOpen} onOpenChange={(open) => { if (!savingNotes) { setNotesOpen(open); if (!open) setNotesError(""); } }}>
      <DialogContent className="lab-batch-notes-dialog" overlayClassName="ui-dialog-overlay--over-sheet" aria-describedby="lab-batch-notes-description">
        <DialogTitle>{batch ? `Notes for ${batchLabel(batch.batchNumber)}` : "Batch notes"}</DialogTitle>
        <DialogDescription id="lab-batch-notes-description">Keep production observations and handling details with this batch.</DialogDescription>
        {editingNotes ? <div className="lab-batch-notes-dialog__editor"><label htmlFor="lab-batch-notes-input">Batch notes</label><textarea id="lab-batch-notes-input" value={notesDraft} onChange={(event) => { setNotesDraft(event.target.value); setNotesError(""); }} maxLength={4000} rows={10} placeholder="Add observations, quality checks, or handling details…" autoFocus /><small>{notesDraft.length.toLocaleString("en-GB")} / 4,000 characters</small></div>
          : <div className="lab-batch-notes-dialog__reader">{batch?.notes || "No notes have been added to this batch."}</div>}
        {notesError && <p className="lab-form-error" role="alert"><TriangleAlert size={16} />{notesError}</p>}
        <div className="lab-batch-notes-dialog__actions">
          <Button variant="outline" type="button" onClick={() => { if (editingNotes && batch?.notes) { setEditingNotes(false); setNotesDraft(batch.notes); setNotesError(""); } else setNotesOpen(false); }} disabled={savingNotes}>{editingNotes && batch?.notes ? "Cancel edit" : "Close"}</Button>
          {editingNotes ? <Button variant="primary" type="button" onClick={saveNotes} disabled={savingNotes}>{savingNotes ? "Saving…" : "Save notes"}</Button>
            : <Button variant="primary" type="button" onClick={() => { setNotesDraft(batch?.notes ?? ""); setEditingNotes(true); }}>Edit notes</Button>}
        </div>
      </DialogContent>
    </Dialog>
  </Sheet>;
}

function batchLabel(value: string) {
  const trimmed = value.trim();
  return /^batch\b/i.test(trimmed) ? trimmed : `Batch ${trimmed}`;
}

function formatQuantity(value: number, unit: "g" | "ml") {
  return `${value.toLocaleString("en-GB", { maximumFractionDigits: 3 })} ${unit === "ml" ? "mL" : "g"}`;
}
