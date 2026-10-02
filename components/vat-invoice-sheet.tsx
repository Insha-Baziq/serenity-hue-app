"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { VatInvoiceFields, vatFormFromInvoice } from "@/components/vat-invoice-fields";
import { formatVatDate, VatLinkButtons } from "@/components/vat-workspace";
import { vatRequest, type VatInvoiceForm } from "@/lib/vat-client";
import { formatVatMoney } from "@/lib/vat-money";
import { VAT_DOC_TYPE_LABELS, VAT_GET_REASON_LABELS, VAT_NOTE_LABELS, VAT_REMOVED_REASON_LABELS } from "@/lib/vat-rules";
import type { VatInvoiceDetail, VatInvoiceRow } from "@/lib/vat-types";
import styles from "./vat-workspace.module.css";

type Props = {
  invoiceId: number | null;
  dropboxReady: boolean;
  onClose: () => void;
  onChanged: () => void;
  /** Called after a review decision so the next invoice to review can open. */
  onReviewed: (id: number) => void;
  onUpload: (invoice: VatInvoiceDetail) => void;
  /** The row already shown in the list, so the panel opens instantly while details load. */
  initialInvoice?: VatInvoiceRow | null;
};

const REMOVE_REASONS = ["not_invoice", "not_needed", "duplicate"] as const;

function statusLabel(invoice: VatInvoiceDetail) {
  return invoice.status === "saved" ? "Saved invoice" : invoice.status === "to_get" ? "To get" : "Removed";
}

/** A list row as a detail placeholder; history and similar invoices arrive from the server. */
function placeholderDetail(row: VatInvoiceRow): VatInvoiceDetail {
  return { ...row, vatBreakdown: [], originalInvoiceNumber: null, inbox: null, updatedBy: null, createdAt: row.updatedAt, events: [], similar: [] };
}

export function VatInvoiceSheet({ invoiceId, dropboxReady, onClose, onChanged, onReviewed, onUpload, initialInvoice }: Props) {
  const [invoice, setInvoice] = useState<VatInvoiceDetail | null>(null);
  const [form, setForm] = useState<VatInvoiceForm>(vatFormFromInvoice(null));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removeReason, setRemoveReason] = useState<(typeof REMOVE_REASONS)[number]>("not_invoice");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [detailLoaded, setDetailLoaded] = useState(false);

  async function load(id: number) {
    setLoadError(null);
    try {
      const result = await vatRequest<{ invoice: VatInvoiceDetail }>(`/api/vat/invoices/${id}`);
      setInvoice(result.invoice);
      setForm(vatFormFromInvoice(result.invoice));
    } catch (requestError) {
      setLoadError((requestError as Error).message);
    }
  }

  // Reset per-invoice state while rendering when a different invoice opens.
  const [shownId, setShownId] = useState<number | null>(null);
  if (shownId !== invoiceId) {
    setShownId(invoiceId);
    const placeholder = initialInvoice && initialInvoice.id === invoiceId ? placeholderDetail(initialInvoice) : null;
    setInvoice(placeholder);
    setForm(vatFormFromInvoice(placeholder));
    setDetailLoaded(false);
    setLoadError(null);
    setError(null);
    setMessage(null);
    setConfirmRemove(false);
  }

  useEffect(() => {
    if (invoiceId === null) return;
    let cancelled = false;
    vatRequest<{ invoice: VatInvoiceDetail }>(`/api/vat/invoices/${invoiceId}`)
      .then((result) => {
        if (cancelled) return;
        setInvoice(result.invoice);
        setForm(vatFormFromInvoice(result.invoice));
        setDetailLoaded(true);
      })
      .catch((requestError: Error) => { if (!cancelled) setLoadError(requestError.message); });
    return () => { cancelled = true; };
  }, [invoiceId]);

  async function run(action: () => Promise<{ logWarning?: string | null; fileUnchanged?: boolean; changed?: boolean }>, done: string) {
    if (!invoice) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await action();
      const notes = [result.changed === false ? "Nothing changed." : done];
      if (result.fileUnchanged) notes.push("The document was filed by the earlier app or another Dropbox account, so its file was left where it is.");
      if (result.logWarning) notes.push(result.logWarning);
      setMessage(notes.join(" "));
      setConfirmRemove(false);
      onChanged();
      await load(invoice.id);
    } catch (requestError) {
      setError((requestError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const save = () => run(() => vatRequest(`/api/vat/invoices/${invoice!.id}`, { method: "PATCH", body: { details: form, expectedUpdatedAt: invoice!.updatedAt } }), "Details saved.");
  const remove = () => run(() => vatRequest(`/api/vat/invoices/${invoice!.id}/remove`, { body: { reason: removeReason, expectedUpdatedAt: invoice!.updatedAt } }), "Moved to Removed. The record and its document are kept.");
  const restore = () => run(() => vatRequest(`/api/vat/invoices/${invoice!.id}/restore`, { body: { expectedUpdatedAt: invoice!.updatedAt } }), "Restored.");

  // Review decisions move straight on to the next invoice waiting for review.
  async function decide(action: () => Promise<unknown>) {
    if (!invoice) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
      onReviewed(invoice.id);
    } catch (requestError) {
      setError((requestError as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const keep = () => decide(() => vatRequest(`/api/vat/invoices/${invoice!.id}/approve`, { body: { expectedUpdatedAt: invoice!.updatedAt } }));
  const removeThis = (reason: "duplicate" | "not_invoice") => decide(() => vatRequest(`/api/vat/invoices/${invoice!.id}/remove`, { body: { reason, expectedUpdatedAt: invoice!.updatedAt } }));
  const removeOther = (id: number, updatedAt: string) => run(
    () => vatRequest(`/api/vat/invoices/${id}/remove`, { body: { reason: "duplicate", expectedUpdatedAt: updatedAt } }),
    "Removed the other one as a duplicate. Keep this one if it is right.",
  );

  const ownFileNeedsDropbox = Boolean(invoice?.hasFile && !invoice.legacyFile && !dropboxReady);
  const notes = invoice?.notes.filter((note) => note in VAT_NOTE_LABELS || note in VAT_GET_REASON_LABELS) ?? [];

  return <Sheet open={invoiceId !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
    <SheetContent className={styles.sheet} aria-describedby={undefined}>
      <div className={styles.sheetHeader}>
        <p className={styles.kicker}>{invoice ? statusLabel(invoice) : "Invoice"}</p>
        <SheetTitle asChild><h2>{invoice?.supplierName ?? (loadError ? "Unavailable" : "Loading…")}</h2></SheetTitle>
        {invoice && <SheetDescription>
          {formatVatDate(invoice.invoiceDate)} · {formatVatMoney(invoice.grossMinor, invoice.currency)}{invoice.documentType ? ` · ${VAT_DOC_TYPE_LABELS[invoice.documentType] ?? invoice.documentType}` : ""}
        </SheetDescription>}
      </div>
      <div className={styles.sheetBody}>
        {loadError && <p className={styles.formError} role="alert">{loadError}</p>}
        {invoice && <>
          {notes.length > 0 && <section className={styles.section} aria-label="Notes">
            <div className={styles.noteList}>{notes.map((note) => {
              const label = VAT_GET_REASON_LABELS[note] ?? VAT_NOTE_LABELS[note];
              return <div className={styles.noteItem} key={note}><strong>{label.label}</strong>{label.help}</div>;
            })}</div>
          </section>}

          {invoice.needsReview && <section className={styles.dangerZone} style={{ borderColor: "#f1d8b8", background: "var(--orange-soft)" }} aria-label="Review">
            <h3>Review</h3>
            {!detailLoaded ? <p className={styles.loadingLine}>Looking for similar invoices…</p> : invoice.similar.length
              ? <>
                  <p className={styles.formHint}>Similar invoices from this supplier. If one is the same purchase, remove the extra one.</p>
                  {invoice.similar.map((other) => <div className={styles.connectionRow} key={other.id}>
                    <div>
                      <span className={styles.strong}>{formatVatMoney(other.grossMinor, other.currency)} · {formatVatDate(other.receivedAt ?? other.invoiceDate)}</span>
                      <span className={styles.muted}>{[other.invoiceNumber && `No. ${other.invoiceNumber}`, other.emailSubject].filter(Boolean).join(" · ") || "No number"}</span>
                      <VatLinkButtons emailId={other.emailId} dropboxUrl={other.dropboxUrl} />
                    </div>
                    <Button variant="ghost" size="compact" disabled={busy} onClick={() => removeOther(other.id, other.updatedAt)}>Remove that one</Button>
                  </div>)}
                </>
              : <p className={styles.formHint}>No similar invoice is left. Keep it if it is a real purchase.</p>}
            <div className={styles.actions}>
              <Button variant="primary" disabled={busy} onClick={keep}>Keep this invoice</Button>
              <Button variant="outline" disabled={busy || ownFileNeedsDropbox} onClick={() => removeThis("duplicate")}>Remove as duplicate</Button>
              <Button variant="ghost" disabled={busy || ownFileNeedsDropbox} onClick={() => removeThis("not_invoice")}>Not a purchase</Button>
            </div>
          </section>}

          {invoice.status === "removed" && <div className={styles.noteItem}>
            <strong>Removed {formatVatDate(invoice.removedAt)}{invoice.removedBy ? ` by ${invoice.removedBy}` : ""}</strong>
            {VAT_REMOVED_REASON_LABELS[invoice.removedReason ?? ""] ?? "Removed"}. The record and its document are kept and can be restored.
          </div>}

          <section className={styles.section}>
            <h3>Details</h3>
            <VatInvoiceFields idPrefix={`vat-invoice-${invoice.id}`} form={form} onChange={setForm} disabled={busy || invoice.status === "removed"} />
            {ownFileNeedsDropbox && <p className={styles.formHint}>Saving keeps the document&apos;s file name in step, so it needs the connected Dropbox. Connect Dropbox to save changes to this invoice.</p>}
            {invoice.status !== "removed" && <div className={styles.actions}>
              <Button variant="primary" onClick={save} disabled={busy || ownFileNeedsDropbox}>{busy ? "Saving…" : "Save details"}</Button>
              <Button variant="outline" onClick={() => onUpload(invoice)} disabled={busy || !dropboxReady} title={dropboxReady ? undefined : "Connect Dropbox to upload documents"}>
                {invoice.status === "to_get" ? "Upload the invoice" : "Replace document"}
              </Button>
            </div>}
            {message && <p className={styles.formHint} role="status">{message}</p>}
            {error && <p className={styles.formError} role="alert">{error}</p>}
          </section>

          <section className={styles.section}>
            <h3>Source</h3>
            <VatLinkButtons emailId={invoice.emailId} inbox={invoice.inbox} dropboxUrl={invoice.dropboxUrl} labels />
            <dl className={styles.facts}>
              <dt>Document</dt>
              <dd>{invoice.dropboxUrl ? invoice.fileName ?? "In Dropbox" : "No file"}{invoice.legacyFile ? " (filed by the earlier app)" : ""}</dd>
              {invoice.portalUrl && <><dt>Supplier site</dt><dd><a className={styles.link} href={invoice.portalUrl} target="_blank" rel="noreferrer">{invoice.portalUrl}</a></dd></>}
              <dt>Came from</dt>
              <dd>{invoice.source === "manual" ? "Upload" : invoice.emailSubject ?? "Email"}</dd>
              {invoice.emailFrom && <><dt>Sender</dt><dd>{invoice.emailFrom}</dd></>}
              {invoice.inbox && <><dt>Inbox</dt><dd>{invoice.inbox}</dd></>}
              {invoice.originalInvoiceNumber && <><dt>Credits invoice</dt><dd>{invoice.originalInvoiceNumber}</dd></>}
              {invoice.vatBreakdown.length > 0 && <><dt>VAT rates</dt><dd>{invoice.vatBreakdown.map((line) => `${line.rate}%: ${formatVatMoney(line.vatMinor, invoice.currency)} on ${formatVatMoney(line.netMinor, invoice.currency)}`).join("; ")}</dd></>}
              {invoice.updatedBy && <><dt>Last edited by</dt><dd>{invoice.updatedBy}</dd></>}
            </dl>
          </section>

          {invoice.status === "removed"
            ? <div className={styles.actions}>
                <Button variant="primary" onClick={restore} disabled={busy || ownFileNeedsDropbox}>Restore</Button>
              </div>
            : <section className={styles.dangerZone} aria-label="Remove">
                {confirmRemove
                  ? <>
                      <label className={styles.field} htmlFor={`vat-remove-${invoice.id}`}>Why remove it?
                        <select id={`vat-remove-${invoice.id}`} className={styles.select} value={removeReason} onChange={(event) => setRemoveReason(event.target.value as typeof removeReason)}>
                          {REMOVE_REASONS.map((reason) => <option key={reason} value={reason}>{VAT_REMOVED_REASON_LABELS[reason]}</option>)}
                        </select>
                      </label>
                      <p className={styles.formHint}>The record moves to Removed{invoice.hasFile && !invoice.legacyFile ? " and its document moves to the removed folder in Dropbox" : ""}. Nothing is deleted.</p>
                      <div className={styles.actions}>
                        <Button variant="primary" onClick={remove} disabled={busy || ownFileNeedsDropbox}>Remove</Button>
                        <Button variant="ghost" onClick={() => setConfirmRemove(false)} disabled={busy}>Cancel</Button>
                      </div>
                    </>
                  : <Button variant="outline" onClick={() => setConfirmRemove(true)} disabled={busy}>Remove from {invoice.status === "saved" ? "Invoices" : "To get"}…</Button>}
              </section>}

          {invoice.events.length > 0 && <section className={styles.section}>
            <h3>History</h3>
            <div className={styles.history}>{invoice.events.map((event) => <div className={styles.historyItem} key={event.id}>
              <strong>{event.summary}</strong>
              <span>{event.actor} · {formatVatDate(event.occurredAt)}</span>
            </div>)}</div>
          </section>}
        </>}
      </div>
    </SheetContent>
  </Sheet>;
}
