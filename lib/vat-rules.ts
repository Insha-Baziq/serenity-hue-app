// Pure VAT workspace rules shared by routes, the repository, and tests. Ported
// from the standalone VAT Automation app. Rules stay general: never per supplier.

import { minorToDecimal, parseMoneyToMinor } from "./vat-money.ts";
import type { VatInvoiceFieldsInput, VatTab, VatWorkspaceQuery } from "./vat-types.ts";

/** A plain-language problem with what staff entered; safe to show as-is. */
export class VatInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VatInputError";
  }
}

/** The only notes recorded: things staff or the accountant can act on. */
export const VAT_NOTE_LABELS: Record<string, { label: string; help: string }> = {
  import_vat: {
    label: "Import VAT",
    help: "Courier/customs invoice. The accountant claims import VAT using the HMRC C79 or postponed VAT statement.",
  },
  vat_not_shown: {
    label: "VAT not shown",
    help: "This receipt doesn't show VAT. If the supplier charges VAT, download the full VAT invoice from their website.",
  },
  vat_estimated: {
    label: "VAT estimated",
    help: "The document doesn't show VAT, so it is calculated at the 20% standard rate included in the total (total ÷ 6). Change it if the supplier isn't VAT-registered or the purchase is zero-rated.",
  },
  amount_not_shown: {
    label: "No amount",
    help: "The document doesn't show a total. Check it against the supplier's website or the bank statement.",
  },
  totals_dont_add_up: {
    label: "Totals don't add up",
    help: "Net + VAT doesn't equal the total on this document (e.g. a delivery charge or discount). Check the figures against the file.",
  },
  duplicate: {
    label: "Possible duplicate",
    help: "Same supplier and amount within a few days, so it may be the same purchase twice. If it is, remove one.",
  },
  unsure: {
    label: "Check",
    help: "It wasn't clear from the email whether this is a purchase. Remove it if it isn't.",
  },
  extraction_failed: {
    label: "Couldn't read",
    help: "The file is saved, but the details couldn't be read. Open it and fill them in.",
  },
};

/** Why a purchase is on the "To get" list instead of filed: what staff must do. */
export const VAT_GET_REASON_LABELS: Record<string, { label: string; help: string }> = {
  bill_on_website: {
    label: "Bill on their website",
    help: "The supplier only emailed to say the bill is ready. Log in to their website, download it and upload it here.",
  },
  no_invoice_in_email: {
    label: "No invoice in the email",
    help: "The email confirms the purchase but doesn't include the invoice or the amount. Download the invoice from the supplier account.",
  },
  payment_request: {
    label: "Payment request",
    help: "This asks for payment; it isn't a receipt. Once paid, upload the receipt.",
  },
};

export const VAT_REMOVED_REASON_LABELS: Record<string, string> = {
  not_invoice: "Not a purchase invoice",
  not_needed: "Not needed",
  duplicate: "Duplicate of another invoice",
  invoice_received: "Invoice received",
};

export const VAT_DOC_TYPE_LABELS: Record<string, string> = {
  invoice: "Invoice",
  receipt: "Receipt",
  credit_note: "Credit note",
  proforma: "Proforma",
  import_vat: "Import VAT",
  bill_notice: "Bill notice",
};

export const VAT_CATEGORY_LABELS: Record<string, string> = {
  invoice_attached: "Invoice (attached)",
  invoice_in_body: "Receipt in email",
  invoice_link_only: "Bill on website",
  credit_note: "Credit note",
  not_invoice: "Not an invoice",
  duplicate: "Duplicate of another invoice",
};

export const VAT_MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export const VAT_DROPBOX_ROOT = "/Invoices";
export const VAT_UPLOAD_STAGING_FOLDER = `${VAT_DROPBOX_ROOT}/_Uploads`;
/** Removed documents move here instead of being deleted, so nothing is ever lost. */
export const VAT_REMOVED_FOLDER = `${VAT_DROPBOX_ROOT}/_Removed`;
export const VAT_PAGE_SIZE = 25;
export const VAT_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
export const VAT_UPLOAD_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isIsoDate(value: string) {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Notes derived from a document's figures (the accountant checks the rest). */
export function figureNotes(input: { documentType: string | null; netMinor: number | null; vatMinor: number | null; grossMinor: number | null }) {
  const notes: string[] = [];
  if (input.documentType === "import_vat") notes.push("import_vat");
  // null (not 0) means the document shows no VAT figure at all.
  if (input.vatMinor === null && input.grossMinor) notes.push("vat_not_shown");
  if (input.grossMinor === null) notes.push("amount_not_shown");
  const { netMinor: net, vatMinor: vat, grossMinor: gross } = input;
  if (net !== null && vat !== null && gross !== null && Math.abs(net + vat - gross) > 2) notes.push("totals_dont_add_up");
  return notes;
}

/**
 * When a GBP document shows only a total, VAT is taken as the 20% standard rate
 * included in that total: VAT = total ÷ 6, net = total − VAT (exact pennies).
 * Documents that show VAT (including an explicit 0) and foreign-currency
 * documents, which usually carry no UK VAT, are left as printed.
 */
export function withEstimatedVat<T extends { netMinor: number | null; vatMinor: number | null; grossMinor: number | null; currency: string | null; documentType: string | null }>(figures: T, notes: string[]) {
  const gbp = !figures.currency || figures.currency.toUpperCase() === "GBP";
  if (figures.vatMinor !== null || figures.grossMinor === null || figures.grossMinor === 0 || !gbp || figures.documentType === "import_vat") {
    return { figures, notes };
  }
  const vatMinor = Math.round(figures.grossMinor / 6);
  return {
    figures: { ...figures, vatMinor, netMinor: figures.grossMinor - vatMinor },
    notes: [...notes.filter((note) => note !== "vat_not_shown" && note !== "totals_dont_add_up"), "vat_estimated"],
  };
}

const FIGURE_NOTES = new Set(["import_vat", "vat_not_shown", "vat_estimated", "amount_not_shown", "totals_dont_add_up"]);
/** Notes a staff member resolves simply by reviewing and saving the details. */
const REVIEW_NOTES = new Set(["unsure", "extraction_failed"]);

/**
 * Notes after staff save reviewed details: figure notes are recalculated,
 * review prompts are cleared, and duplicates/to-get reasons are kept.
 */
export function notesAfterReview(previous: string[], status: "saved" | "to_get", figures: Parameters<typeof figureNotes>[0]) {
  const kept = previous.filter((note) => !FIGURE_NOTES.has(note) && !REVIEW_NOTES.has(note));
  if (status === "to_get") return [...new Set(kept)];
  return [...new Set([...kept.filter((note) => !(note in VAT_GET_REASON_LABELS)), ...figureNotes(figures)])];
}

export type NormalizedVatFields = {
  documentType: string | null;
  supplierName: string;
  supplierVatNumber: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  currency: string | null;
  netMinor: number | null;
  vatMinor: number | null;
  grossMinor: number | null;
};

function cleanText(value: unknown, max = 200) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new VatInputError("Invoice details must be text");
  const text = value.trim();
  if (!text) return null;
  if (text.length > max) throw new VatInputError(`Keep each detail within ${max} characters`);
  return text;
}

/** Validates staff-entered invoice details. Throws a plain-language Error. */
export function normalizeVatInvoiceFields(input: VatInvoiceFieldsInput, options: { requireDate: boolean }): NormalizedVatFields {
  const supplierName = cleanText(input.supplierName);
  if (!supplierName) throw new VatInputError("Supplier is required");
  const invoiceDate = cleanText(input.invoiceDate, 10);
  const dueDate = cleanText(input.dueDate, 10);
  if (invoiceDate && !isIsoDate(invoiceDate)) throw new VatInputError("Invoice date must be a valid date");
  if (dueDate && !isIsoDate(dueDate)) throw new VatInputError("Due date must be a valid date");
  if (options.requireDate && !invoiceDate) throw new VatInputError("The invoice date is needed to file it in the right month");
  const documentType = cleanText(input.documentType, 40);
  if (documentType && !(documentType in VAT_DOC_TYPE_LABELS)) throw new VatInputError("Choose a known document type");
  const currency = cleanText(input.currency, 3)?.toUpperCase() ?? null;
  if (currency && !/^[A-Z]{3}$/.test(currency)) throw new VatInputError("Currency must be a three-letter code such as GBP");
  const amount = (value: unknown, label: string) => {
    try {
      return parseMoneyToMinor(cleanText(value, 20));
    } catch (error) {
      throw new VatInputError(`${label}: ${(error as Error).message}`);
    }
  };
  return {
    documentType,
    supplierName,
    supplierVatNumber: cleanText(input.supplierVatNumber, 40),
    invoiceNumber: cleanText(input.invoiceNumber, 80)?.replace(/^[#\s]+/, "") || null,
    invoiceDate,
    dueDate,
    currency,
    netMinor: amount(input.netAmount, "Net"),
    vatMinor: amount(input.vatAmount, "VAT"),
    grossMinor: amount(input.grossAmount, "Total"),
  };
}

/** One folder per month: /Invoices/2026/08 - August */
export function vatFolderFor(invoiceDate: string) {
  const [year, month] = invoiceDate.split("-");
  return `${VAT_DROPBOX_ROOT}/${year}/${month} - ${VAT_MONTH_NAMES[Number(month) - 1]}`;
}

const SYMBOLS: Record<string, string> = { GBP: "£", USD: "$", EUR: "€" };

/** 2026-08-17_Kilsby-Williams_94532-1_£480.00.pdf: the naming the business already uses. */
export function vatInvoiceFileName(
  invoice: { invoiceDate: string; supplierName: string | null; invoiceNumber: string | null; grossMinor: number | null; currency: string | null },
  extension: string,
) {
  const currency = invoice.currency || "GBP";
  const gross = minorToDecimal(invoice.grossMinor);
  const amount = gross === null ? null : `${SYMBOLS[currency] ?? `${currency} `}${gross}`;
  const clean = (part: string) => part
    .replace(/[\\/:*?"<>|#]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  const parts = [invoice.invoiceDate, invoice.supplierName ?? "Unknown", invoice.invoiceNumber, amount]
    .filter((part): part is string => Boolean(part))
    .map(clean);
  return `${parts.join("_")}.${extension}`;
}

export function vatFileExtension(path: string | null, fallback = "pdf") {
  const name = path?.split("/").pop() ?? "";
  const extension = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  return /^[a-z0-9]{1,5}$/.test(extension) ? extension : fallback;
}

// One purchase, one record. These general rules mirror the source app's
// duplicate handling (like Hubdoc's "same supplier, date and amount" check).
const LEGAL_SUFFIXES = /\b(ltd|limited|plc|llc|inc|incorporated|pbc|corp|corporation|co|company|gmbh|s\.?a\.?r\.?l|sarl|bv|pty)\b\.?/g;

/** "Anthropic, PBC" → "anthropic"; "Kilsby Williams LLP" → "kilsby williams llp". */
export function normaliseSupplier(name: string | null) {
  return (name ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(LEGAL_SUFFIXES, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Same supplier if the names match, or one is the other plus words ("Viber" / "Viber Media"). */
export function sameSupplier(a: string | null, b: string | null) {
  const x = normaliseSupplier(a);
  const y = normaliseSupplier(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 4 && (long.startsWith(`${short} `) || long.endsWith(` ${short}`));
}

export type VatMatchCandidate = {
  id: number;
  status: "saved" | "to_get" | "removed";
  supplierName: string | null;
  invoiceDate: string | null;
  grossMinor: number | null;
  invoiceNumber: string | null;
};

export function daysApart(a: string | null, b: string | null) {
  if (!a || !b) return Infinity;
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

/**
 * After an invoice is saved: "To get" items it fulfils (same supplier,
 * compatible amount, within 7 days), and saved invoices that may be the same
 * purchase (same supplier and amount within 3 days, or the same invoice number).
 * Possible duplicates are only flagged, never removed automatically.
 */
export function matchSavedInvoice(saved: VatMatchCandidate, candidates: VatMatchCandidate[]) {
  const covered: number[] = [];
  const duplicates: number[] = [];
  for (const other of candidates) {
    if (other.id === saved.id || !sameSupplier(saved.supplierName, other.supplierName)) continue;
    const compatible = saved.grossMinor === null || other.grossMinor === null || saved.grossMinor === other.grossMinor;
    const days = daysApart(saved.invoiceDate, other.invoiceDate);
    if (other.status === "to_get" && compatible && days <= 7) covered.push(other.id);
    if (other.status === "saved") {
      const sameNumber = Boolean(saved.invoiceNumber) && saved.invoiceNumber === other.invoiceNumber;
      const sameAmount = saved.grossMinor !== null && saved.grossMinor === other.grossMinor && days <= 3;
      if (sameNumber || sameAmount) duplicates.push(other.id);
    }
  }
  return { covered, duplicates };
}

/** Opens the original email in Outlook on the web ("ms:" ids) or Gmail, in its inbox when known. */
export function vatEmailLink(messageId: string, inbox?: string | null) {
  if (messageId.startsWith("ms:")) {
    // Outlook on the web takes the id in its older format ("/" and "+" instead of "-" and "_").
    const itemId = messageId.slice(3).replace(/-/g, "/").replace(/_/g, "+");
    return `https://outlook.office.com/owa/?ItemID=${encodeURIComponent(itemId)}&exvsurl=1&viewmodel=ReadMessageItem`;
  }
  return `https://mail.google.com/mail/u/${inbox ? encodeURIComponent(inbox) : 0}/#all/${messageId}`;
}

export function monthRange(month: string | null) {
  if (!month || !MONTH.test(month)) return null;
  const [year, monthNumber] = month.split("-").map(Number);
  const start = `${year}-${String(monthNumber).padStart(2, "0")}-01`;
  const end = monthNumber === 12 ? `${year + 1}-01-01` : `${year}-${String(monthNumber + 1).padStart(2, "0")}-01`;
  return { start, end };
}

/** Months from the first invoice month to the current month, newest first. */
export function vatMonthOptions(earliest: string | null, now = new Date()) {
  const start = earliest && MONTH.test(earliest.slice(0, 7)) ? earliest.slice(0, 7) : now.toISOString().slice(0, 7);
  const [startYear, startMonth] = start.split("-").map(Number);
  const months: string[] = [];
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth() + 1;
  while ((year > startYear || (year === startYear && month >= startMonth)) && months.length < 120) {
    months.push(`${year}-${String(month).padStart(2, "0")}`);
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return months;
}

const TABS: VatTab[] = ["saved", "to_get", "ignored", "removed"];

export function parseVatWorkspaceQuery(params: Record<string, string | string[] | undefined>): VatWorkspaceQuery {
  const first = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const tab = TABS.includes(first("tab") as VatTab) ? first("tab") as VatTab : "saved";
  const month = first("month");
  const page = Math.max(1, Math.min(10_000, Math.trunc(Number(first("page")) || 1)));
  return { tab, month: month && MONTH.test(month) ? month : null, page, review: tab === "saved" && first("review") === "1" };
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  // Guard against spreadsheet formula injection from supplier-controlled text.
  const safe = /^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export type VatLogRow = {
  invoiceDate: string | null;
  supplierName: string | null;
  invoiceNumber: string | null;
  currency: string | null;
  netMinor: number | null;
  vatMinor: number | null;
  grossMinor: number | null;
  status: "saved" | "to_get";
  notes: string[];
  portalUrl: string | null;
  dropboxUrl: string | null;
};

/** invoice_log.csv for the accountant: saved invoices plus those still to get. */
export function buildVatInvoiceLogCsv(rows: VatLogRow[]) {
  const header = ["Month", "Invoice date", "Supplier", "Invoice no", "Currency", "Net", "VAT", "Total", "Status", "Notes", "Dropbox link"];
  const lines = rows.map((row) => [
    row.invoiceDate ? VAT_MONTH_NAMES[Number(row.invoiceDate.slice(5, 7)) - 1] : "",
    row.invoiceDate ? row.invoiceDate.split("-").reverse().join("/") : "",
    row.supplierName,
    row.invoiceNumber,
    row.currency,
    minorToDecimal(row.netMinor),
    minorToDecimal(row.vatMinor),
    minorToDecimal(row.grossMinor),
    row.status === "saved" ? "Saved" : "TO GET",
    [
      ...row.notes.map((note) => {
        const label = VAT_GET_REASON_LABELS[note] ?? VAT_NOTE_LABELS[note];
        return label ? `${label.label}: ${label.help}` : note;
      }),
      ...(row.portalUrl ? [`Supplier site: ${row.portalUrl}`] : []),
    ].join(" | "),
    row.dropboxUrl,
  ].map(csvCell).join(","));
  // BOM so Excel shows £ correctly.
  return `﻿${[header.join(","), ...lines].join("\r\n")}\r\n`;
}
