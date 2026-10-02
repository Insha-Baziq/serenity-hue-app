"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { VatInvoiceFields, vatFormFromInvoice } from "@/components/vat-invoice-fields";
import { formatVatDate } from "@/components/vat-workspace";
import { vatRequest, type VatInvoiceForm } from "@/lib/vat-client";
import { formatVatMoney } from "@/lib/vat-money";
import { vatEmailLink, VAT_DOC_TYPE_LABELS, VAT_GET_REASON_LABELS, VAT_NOTE_LABELS, VAT_REMOVED_REASON_LABELS } from "@/lib/vat-rules";
import type { VatInvoiceDetail } from "@/lib/vat-types";
import styles from "./vat-workspace.module.css";

type Props = {
  invoiceId: number | null;
  dropboxReady: boolean;
  onClose: () => void;
  onChanged: () => void;
  onUpload: (invoice: VatInvoiceDetail) => void;
};

const REMOVE_REASONS = ["not_invoice", "not_needed", "duplicate"] as const;

function statusLabel(invoice: VatInvoiceDetail) {
  return invoice.status === "saved" ? "Saved invoice" : invoice.status === "to_get" ? "To get" : "Removed";
}

export function VatInvoiceSheet({ invoiceId, dropboxReady, onClose, onChanged, onUpload }: Props) {
  const [invoice, setInvoice] = useState<VatInvoiceDetail | null>(null);
  const [form, setForm] = useState<VatInvoiceForm>(vatFormFromInvoice(null));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removeReason, setRemoveReason] = useState<(typeof REMOVE_REASONS)[number]>("not_invoice");
  const [confirmRemove, setConfirmRemove] = useState(false);

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
    setInvoice(null);
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
            <dl className={styles.facts}>
              <dt>Document</dt>
              <dd>{invoice.dropboxUrl ? <a className={styles.link} href={invoice.dropboxUrl} target="_blank" rel="noreferrer">{invoice.fileName ?? "Open in Dropbox"}</a> : "No file"}{invoice.legacyFile ? " (filed by the earlier app)" : ""}</dd>
              {invoice.portalUrl && <><dt>Supplier site</dt><dd><a className={styles.link} href={invoice.portalUrl} target="_blank" rel="noreferrer">{invoice.portalUrl}</a></dd></>}
              <dt>Came from</dt>
              <dd>{invoice.source === "manual" ? "Upload" : invoice.emailId
                ? <a className={styles.link} href={vatEmailLink(invoice.emailId, invoice.inbox)} target="_blank" rel="noreferrer">{invoice.emailSubject ?? "Open email"}</a>
                : invoice.emailSubject ?? "Email"}</dd>
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
