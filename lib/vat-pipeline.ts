import "server-only";

import { vatEmailToPdf } from "@/lib/vat-email-pdf";
import { classifyVatEmail } from "@/lib/vat-jev";
import { extractVatBillNotice, extractVatInvoice, parseVatText, type VatExtractedInvoice } from "@/lib/vat-llama";
import type { VatMailbox, VatParsedEmail } from "@/lib/vat-mailbox";
import { parseMoneyToMinor } from "@/lib/vat-money";
import { routeVatEmail, VAT_CONFIDENCE_THRESHOLD, vatCandidateAttachments, type VatCategory } from "@/lib/vat-routing";
import { figureNotes, isIsoDate, withEstimatedVat, vatFolderFor, vatInvoiceFileName } from "@/lib/vat-rules";
import { failVatEmail, finishVatEmail, insertVatPipelineInvoice, startVatEmail, vatInvoiceForEmail, vatOwnerHistory, type VatPipelineInvoice } from "@/lib/vat-run-store";
import { uploadVatDropboxDocument, VatDropboxError, vatDropboxSharedLink } from "@/lib/vat-dropbox";
import { isVatServiceBlocked, VatServiceBlockedError } from "@/lib/vat-services";
import type { ActivityActor } from "@/lib/types";

// One email: Jev classifies it once, then LlamaExtract reads purchases into a
// saved invoice (filed in Dropbox) or a To get item. Ported from the VAT
// Automation pipeline. A refusing service never leads to a decision.

export type VatDropboxAccess = { token: string; accountId: string };
export type VatEmailOutcome = "ignored" | "saved" | "to_get" | "already_recorded";

const minor = (value: number | null | undefined) => (value === null || value === undefined || !Number.isFinite(value) ? null : parseMoneyToMinor(value.toFixed(2)));

const emailText = (email: VatParsedEmail) =>
  `From: ${email.fromName ?? ""} <${email.fromEmail ?? ""}>\nSubject: ${email.subject ?? ""}\nDate: ${email.receivedAt.toISOString().slice(0, 10)}\n\n${email.bodyText}`;

function dropboxBlocked(error: unknown): unknown {
  if (error instanceof VatDropboxError && (error.code === "auth" || error.code === "insufficient_space")) {
    return new VatServiceBlockedError("dropbox", error.code === "auth" ? "access expired or was removed. Reconnect Dropbox" : "storage is full");
  }
  return error;
}

export async function processVatEmail(mailbox: VatMailbox, id: string, dropbox: VatDropboxAccess, actor: ActivityActor): Promise<VatEmailOutcome> {
  const email = await mailbox.getEmail(id);
  await startVatEmail({
    id,
    accountId: mailbox.accountId,
    threadId: email.threadId,
    fromName: email.fromName,
    fromEmail: email.fromEmail,
    subject: email.subject,
    receivedAt: email.receivedAt.toISOString(),
    attachmentsJson: JSON.stringify(email.attachments),
  });

  try {
    // An interrupted earlier attempt may already have recorded its invoice: never record it twice.
    if (await vatInvoiceForEmail(id)) {
      await finishVatEmail(id, { status: "invoice", category: "invoice_attached", confidence: 1, jevAnswers: null, bodyText: email.bodyText });
      return "already_recorded";
    }
    const candidates = vatCandidateAttachments(email.attachments);
    const history = await vatOwnerHistory(email.fromEmail);
    const input = { ...email, attachments: candidates, ownerHistory: history?.text };
    let jev = await classifyVatEmail(input);

    // Unsure and there is a document not yet looked inside: read it cheaply and ask again.
    if (jev.probability < VAT_CONFIDENCE_THRESHOLD && candidates.length) {
      const document = candidates[jev.attachmentIndex ?? 0];
      try {
        const content = await mailbox.downloadAttachment(id, document.attachmentId);
        const attachmentText = await parseVatText(content, document.filename);
        if (attachmentText.trim()) jev = await classifyVatEmail({ ...input, attachmentText });
      } catch (error) {
        if (isVatServiceBlocked(error)) throw error;
      }
    }

    const route = routeVatEmail(jev, candidates.length > 0, history);
    const common = { category: jev.category, confidence: jev.probability, jevAnswers: jev.raw };
    if (route.to === "ignored") {
      await finishVatEmail(id, { ...common, status: "ignored", bodyText: null });
      return "ignored";
    }

    // Unclear emails are still recorded (noted "Check") so nothing that might be a purchase is hidden.
    const category: Exclude<VatCategory, "not_invoice"> = route.to === "invoice"
      ? route.category
      : jev.category !== "not_invoice" ? jev.category : candidates.length ? "invoice_attached" : "invoice_in_body";
    const attachment = jev.attachmentIndex !== null ? candidates[jev.attachmentIndex] : undefined;
    const outcome = await createInvoiceFromEmail(mailbox, email, category, attachment?.attachmentId, {
      notes: route.to === "unclear" ? ["unsure"] : [],
      unpaid: route.to === "invoice" && route.unpaid,
      dropbox,
      actor,
    });
    await finishVatEmail(id, { ...common, status: "invoice", bodyText: email.bodyText });
    return outcome;
  } catch (error) {
    const blocked = dropboxBlocked(error);
    // A service out of credits says nothing about this email: don't use up one of its tries.
    await failVatEmail(id, (blocked as Error).message ?? "Processing failed", isVatServiceBlocked(blocked));
    throw blocked;
  }
}

async function createInvoiceFromEmail(
  mailbox: VatMailbox,
  email: VatParsedEmail,
  category: VatCategory,
  attachmentId: string | undefined,
  options: { notes: string[]; unpaid: boolean; dropbox: VatDropboxAccess; actor: ActivityActor },
): Promise<"saved" | "to_get"> {
  const emailDate = email.receivedAt.toISOString().slice(0, 10);
  const fallbackSupplier = email.fromName ?? email.fromEmail;

  if (category === "invoice_link_only") {
    let notice = null;
    try {
      notice = (await extractVatBillNotice(emailText(email))).data;
    } catch (error) {
      if (isVatServiceBlocked(error)) throw error;
    }
    await insertVatPipelineInvoice({
      ...emptyInvoice(email.id),
      status: "to_get",
      documentType: "bill_notice",
      supplierName: notice?.supplierName ?? fallbackSupplier,
      invoiceDate: notice?.billDate && isIsoDate(notice.billDate) ? notice.billDate : emailDate,
      grossMinor: minor(notice?.amountDue),
      currency: notice?.amountDue !== null && notice?.amountDue !== undefined ? process.env.VAT_DEFAULT_CURRENCY ?? "GBP" : null,
      portalUrl: notice?.portalUrl ?? null,
      notes: ["bill_on_website", ...options.notes],
    }, options.actor);
    return "to_get";
  }

  const candidates = vatCandidateAttachments(email.attachments);
  const attachment = candidates.find((item) => item.attachmentId === attachmentId)
    ?? (category !== "invoice_in_body" ? candidates.find((item) => item.mimeType === "application/pdf") ?? candidates[0] : undefined);

  if (attachment) {
    const document = await mailbox.downloadAttachment(email.id, attachment.attachmentId);
    return storeEmailInvoice({
      email, document, extension: attachment.filename.split(".").pop()?.toLowerCase() || "pdf",
      extractInput: { content: document, filename: attachment.filename }, category, fallbackSupplier, emailDate, bodyOnly: false, ...options,
    });
  }
  // Receipt written in the email itself: keep the email as a PDF and read its text.
  return storeEmailInvoice({
    email, document: await vatEmailToPdf(email), extension: "pdf",
    extractInput: { content: Buffer.from(emailText(email), "utf8"), filename: "email.txt" }, category, fallbackSupplier, emailDate, bodyOnly: true, ...options,
  });
}

function emptyInvoice(emailId: string): VatPipelineInvoice {
  return {
    emailId, status: "to_get", documentType: null, supplierName: null, supplierVatNumber: null, invoiceNumber: null, invoiceDate: null,
    dueDate: null, currency: null, netMinor: null, vatMinor: null, grossMinor: null, vatBreakdownJson: null, originalInvoiceNumber: null,
    portalUrl: null, fieldConfidenceJson: null, notes: [], file: null,
  };
}

async function storeEmailInvoice(input: {
  email: VatParsedEmail;
  document: Buffer;
  extension: string;
  extractInput: { content: Buffer; filename: string };
  category: VatCategory;
  fallbackSupplier: string | null;
  emailDate: string;
  bodyOnly: boolean;
  notes: string[];
  unpaid: boolean;
  dropbox: VatDropboxAccess;
  actor: ActivityActor;
}): Promise<"saved" | "to_get"> {
  let data: VatExtractedInvoice | null = null;
  let confidence: Record<string, number> = {};
  const notes = [...input.notes];
  try {
    const result = await extractVatInvoice(input.extractInput.content, input.extractInput.filename);
    data = result.data;
    confidence = result.confidence;
  } catch (error) {
    if (isVatServiceBlocked(error)) throw error;
    notes.push("extraction_failed");
  }

  if (data && (input.category === "credit_note" || data.documentType === "credit_note")) {
    const negative = (value: number | null) => (value === null ? value : -Math.abs(value));
    data = {
      ...data,
      documentType: "credit_note",
      netAmount: negative(data.netAmount),
      vatAmount: negative(data.vatAmount),
      grossAmount: negative(data.grossAmount),
      vatBreakdown: data.vatBreakdown.map((line) => ({ rate: line.rate, net: -Math.abs(line.net), vat: -Math.abs(line.vat) })),
    };
  }

  const printedGross = minor(data?.grossAmount);
  const printed = {
    netMinor: minor(data?.netAmount),
    vatMinor: minor(data?.vatAmount),
    grossMinor: printedGross,
    // No currency printed (common on UK invoices): assume GBP when there is an amount.
    currency: data?.currency?.toUpperCase() ?? (printedGross !== null ? process.env.VAT_DEFAULT_CURRENCY ?? "GBP" : null),
    documentType: data?.documentType ?? null,
  };
  const estimated = withEstimatedVat(printed, data ? figureNotes(printed) : []);
  const { netMinor, vatMinor, grossMinor } = estimated.figures;
  notes.push(...estimated.notes);
  const invoiceDate = data?.invoiceDate && isIsoDate(data.invoiceDate) ? data.invoiceDate : input.emailDate;
  const details = {
    supplierName: data?.supplierName || input.fallbackSupplier || "Unknown",
    invoiceNumber: data?.invoiceNumber?.replace(/^[#\s]+/, "") || null,
    currency: estimated.figures.currency,
    grossMinor,

  };

  const getReason = input.unpaid
    ? "payment_request"
    : (data && grossMinor === null) || (!data && input.bodyOnly) ? "no_invoice_in_email" : null;
  if (getReason) {
    await insertVatPipelineInvoice({
      ...emptyInvoice(input.email.id),
      ...details,
      status: "to_get",
      documentType: data?.documentType ?? null,
      invoiceDate,
      notes: [...new Set([getReason, ...notes.filter((note) => !["amount_not_shown", "vat_not_shown", "extraction_failed"].includes(note))])],
    }, input.actor);
    return "to_get";
  }

  let file;
  try {
    const path = await uploadVatDropboxDocument(input.dropbox.token, `${vatFolderFor(invoiceDate)}/${vatInvoiceFileName({ ...details, invoiceDate }, input.extension)}`, input.document);
    file = { dropboxPath: path, fileName: path.split("/").pop() ?? path, dropboxUrl: await vatDropboxSharedLink(input.dropbox.token, path), dropboxAccountId: input.dropbox.accountId };
  } catch (error) {
    throw dropboxBlocked(error);
  }
  await insertVatPipelineInvoice({
    ...emptyInvoice(input.email.id),
    ...details,
    status: "saved",
    documentType: data?.documentType ?? null,
    supplierVatNumber: data?.supplierVatNumber ?? null,
    invoiceDate,
    dueDate: data?.dueDate && isIsoDate(data.dueDate) ? data.dueDate : null,
    netMinor,
    vatMinor,
    vatBreakdownJson: data ? JSON.stringify(data.vatBreakdown.map((line) => ({ rate: line.rate, netMinor: minor(line.net), vatMinor: minor(line.vat) }))) : null,
    originalInvoiceNumber: data?.originalInvoiceNumber ?? null,
    fieldConfidenceJson: JSON.stringify(confidence),
    notes: [...new Set(notes)],
    file,
  }, input.actor);
  return "saved";
}
