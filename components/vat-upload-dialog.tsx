"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { VatInvoiceFields, vatFormFromInvoice } from "@/components/vat-invoice-fields";
import { vatRequest, type VatInvoiceForm } from "@/lib/vat-client";
import { VAT_UPLOAD_MAX_BYTES, VAT_UPLOAD_TYPES } from "@/lib/vat-rules";
import type { VatInvoiceRow } from "@/lib/vat-types";
import styles from "./vat-workspace.module.css";

export type VatUploadTarget = { invoice: VatInvoiceRow | null };

type Props = { target: VatUploadTarget | null; dropboxReady: boolean; onClose: () => void; onFiled: () => void };
type Stage = "idle" | "preparing" | "uploading" | "filing" | "done";

const EXTENSION_TYPES: Record<string, string> = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic" };

function contentTypeFor(file: File) {
  if (file.type in VAT_UPLOAD_TYPES) return file.type;
  return EXTENSION_TYPES[file.name.split(".").pop()?.toLowerCase() ?? ""] ?? file.type;
}

const STAGE_LABEL: Record<Stage, string> = {
  idle: "",
  preparing: "Preparing the upload…",
  uploading: "Sending the file to Dropbox…",
  filing: "Filing it in its month folder…",
  done: "Filed.",
};

export function VatUploadDialog({ target, dropboxReady, onClose, onFiled }: Props) {
  const [form, setForm] = useState<VatInvoiceForm>(vatFormFromInvoice(null));
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  // The file stays in Dropbox's staging folder if filing fails, so a corrected
  // retry only repeats the filing step.
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [shownTarget, setShownTarget] = useState<VatUploadTarget | null>(null);
  if (shownTarget !== target) {
    setShownTarget(target);
    setForm(vatFormFromInvoice(target?.invoice ?? null));
    setFile(null);
    setStage("idle");
    setError(null);
    setResult(null);
    setUploadId(null);
  }

  const busy = stage === "preparing" || stage === "uploading" || stage === "filing";

  function chooseFile(next: File | null) {
    setError(null);
    setUploadId(null);
    if (next && !(contentTypeFor(next) in VAT_UPLOAD_TYPES)) {
      setFile(null);
      setError("Choose a PDF or a photo (JPG, PNG, WebP or HEIC).");
      return;
    }
    if (next && next.size > VAT_UPLOAD_MAX_BYTES) {
      setFile(null);
      setError("The file is larger than 20 MB.");
      return;
    }
    setFile(next);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!file && !uploadId) {
      setError("Choose the invoice file first.");
      return;
    }
    setError(null);
    try {
      let id = uploadId;
      if (!id && file) {
        setStage("preparing");
        const prepared = await vatRequest<{ uploadId: string; uploadUrl: string }>("/api/vat/uploads", {
          body: { fileName: file.name, contentType: contentTypeFor(file), size: file.size, invoiceId: target?.invoice?.id ?? null },
        });
        setStage("uploading");
        const sent = await fetch(prepared.uploadUrl, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file });
        if (!sent.ok) throw new Error("Dropbox didn't accept the file. Try again.");
        id = prepared.uploadId;
        setUploadId(id);
      }
      setStage("filing");
      const filed = await vatRequest<{ clearedToGet: number; possibleDuplicates: number; logWarning: string | null }>(`/api/vat/uploads/${id}/complete`, { body: { details: form } });
      const notes = ["Filed in Dropbox and added to Invoices."];
      if (filed.clearedToGet) notes.push(`${filed.clearedToGet} matching To get item${filed.clearedToGet === 1 ? " was" : "s were"} cleared.`);
      if (filed.possibleDuplicates) notes.push("It looks similar to another invoice, so both are marked Possible duplicate.");
      if (filed.logWarning) notes.push(filed.logWarning);
      setResult(notes.join(" "));
      setStage("done");
      onFiled();
    } catch (requestError) {
      setStage("idle");
      setError((requestError as Error).message);
    }
  }

  const forItem = target?.invoice;
  return <Dialog open={target !== null} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className={styles.dialog}>
      <div className={styles.sheetHeader}>
        <p className={styles.kicker}>{forItem ? (forItem.status === "to_get" ? "Upload the invoice" : "Replace document") : "Upload invoice"}</p>
        <DialogTitle asChild><h2>{forItem?.supplierName ?? "Add a purchase invoice"}</h2></DialogTitle>
        <DialogDescription>A paper receipt, or an invoice downloaded from a supplier. Enter its figures as shown on the document.</DialogDescription>
      </div>
      {!dropboxReady
        ? <div className={styles.sheetBody}><p className={styles.formError} role="alert">Uploads need the business Dropbox. Connect Dropbox from Connections, then try again.</p><div className={styles.actions}><Button variant="outline" onClick={onClose}>Close</Button></div></div>
        : stage === "done"
          ? <div className={styles.sheetBody}><p className={styles.progress} role="status">{result}</p><div className={styles.actions}><Button variant="primary" onClick={onClose}>Done</Button></div></div>
          : <form className={styles.sheetBody} onSubmit={submit}>
              <label className={styles.fileDrop} htmlFor="vat-upload-file">
                <strong>Invoice file</strong>
                <span className={styles.formHint}>PDF or photo, up to 20 MB. It goes straight to the business Dropbox.</span>
                <input id="vat-upload-file" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,application/pdf,image/*" disabled={busy || Boolean(uploadId)} onChange={(event) => chooseFile(event.target.files?.[0] ?? null)} />
                {uploadId && <span className={styles.formHint}>The file is already in Dropbox; correct the details and file it again.</span>}
              </label>
              <VatInvoiceFields idPrefix="vat-upload" form={form} onChange={setForm} disabled={busy} />
              {busy && <p className={styles.progress} role="status">{STAGE_LABEL[stage]}</p>}
              {error && <p className={styles.formError} role="alert">{error}</p>}
              <div className={styles.actions}>
                <Button variant="primary" type="submit" disabled={busy}>{uploadId ? "File it" : "Upload and file"}</Button>
                <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
              </div>
            </form>}
    </DialogContent>
  </Dialog>;
}
