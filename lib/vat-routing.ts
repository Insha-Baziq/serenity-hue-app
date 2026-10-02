// Pure classification routing ported from the VAT Automation app. General
// rules only: never per supplier.

import { daysApart, sameSupplier } from "./vat-rules.ts";

export const VAT_CONFIDENCE_THRESHOLD = 0.8;

// Any purchase the owner made counts; she decides later whether it is a business cost.
export const VAT_CATEGORIES = {
  invoice_attached:
    "A receipt, invoice or bill for something the inbox owner bought or paid for (any seller, any kind of purchase), and the document is attached to the email as a file (PDF, image or document).",
  invoice_in_body:
    "The email itself is a receipt, order confirmation with the amount paid, booking/ticket purchase confirmation, or invoice for something the inbox owner bought or paid for (any seller: shops, restaurants, food delivery, airlines, software, subscriptions). It states what was bought and/or the amount paid or due, and no invoice file is attached.",
  invoice_link_only:
    "A seller or utility says a bill, invoice or statement is ready, but the document is neither attached nor shown in the email; you must log in to an account or click a link to view or download it.",
  credit_note:
    "A credit note, or confirmation that a refund has actually been issued with its amount, from a seller for an earlier purchase. Return requests, return labels, return drop-off confirmations and \"we received your return\" notices without an issued refund are NOT credit notes.",
  not_invoice:
    "No purchase was made or paid for in this email: marketing, newsletters, promotions and discount codes, shipping or delivery tracking without prices, failed or declined payments, subscription or trial reminders with no charge, sales made BY the inbox owner's own shop to its customers (Shopify or TikTok Shop new-order notifications), platform payout notices, account, login or security notices, verification codes, invitations and conversations. Also not an invoice: payment failed or declined notices, upcoming or scheduled instalment payment reminders and buy-now-pay-later instalment updates, statements of account and payment reminders about invoices already sent earlier, 'your export or report is ready' notices, and return started, return label, drop-off or return received notices without an issued refund, unless the email itself contains a new invoice or receipt.",
} as const;
export type VatCategory = keyof typeof VAT_CATEGORIES;

// Separate from the category (the email's form): whether money actually moved.
export const VAT_PAYMENT_STATUSES = {
  paid:
    "A receipt, invoice or order confirmation for something the owner bought or subscribed to: payment confirmation, 'thanks for your order' with an order summary, a paid ticket or booking, a subscription started or renewed. This includes free or £0/$0 orders and plans when the email is a receipt or order summary.",
  payment_requested:
    "The owner is asked to pay and there is no confirmation it was paid yet: an invoice or bill with an amount due, a 'pay now' or 'complete your payment' message, bank-transfer details to pay, a request for payment, or a booking reserved until payment is made.",
  bill_on_website:
    "A bill, invoice or statement is ready but not included in the email; the owner has to log in to an account or website to see or download it.",
  no_purchase:
    "Nothing was bought or charged: promotions, newsletters, reminders that a subscription will end, requests to add or update a card or payment details to keep a subscription or trial (even if they show an estimated bill), failed or declined payments, trial reminders ('your trial ends soon', 'your trial has ended'), welcome or onboarding emails with no order summary, account, login or security emails, delivery tracking, sales to the owner's own customers, instalment or scheduled-payment reminders and failed instalments for an order already placed, statements of account or reminders about invoices sent earlier, 'your export or report is ready' notices, and return or drop-off notices without an issued refund.",
} as const;
export type VatPaymentStatus = keyof typeof VAT_PAYMENT_STATUSES;

export type VatJevResult = {
  category: VatCategory;
  probability: number;
  attachmentIndex: number | null;
  payment: { status: VatPaymentStatus; probability: number };
  raw: unknown;
};

export type VatRoute =
  | { to: "invoice"; category: Exclude<VatCategory, "not_invoice">; unpaid: boolean }
  | { to: "ignored" }
  | { to: "unclear" };

const sure = (probability: number) => probability >= VAT_CONFIDENCE_THRESHOLD;

/**
 * Combines Jev's two independent answers: the email's form and whether money
 * moved. Either being confident is enough; otherwise staff decisions for the
 * sender's domain decide, and anything still unclear is kept (noted "Check").
 */
export function routeVatEmail(jev: VatJevResult, hasAttachments: boolean, owner?: { invoices: number; notInvoices: number }): VatRoute {
  const pay = jev.payment;
  const unpaid = pay.status === "payment_requested" && pay.probability >= 0.5;
  const formFromPayment = (): Exclude<VatCategory, "not_invoice"> =>
    pay.status === "bill_on_website" ? "invoice_link_only" : hasAttachments ? "invoice_attached" : "invoice_in_body";

  if (sure(jev.probability)) {
    if (jev.category !== "not_invoice") return { to: "invoice", category: jev.category, unpaid };
    return sure(pay.probability) && pay.status !== "no_purchase" ? { to: "invoice", category: formFromPayment(), unpaid } : { to: "ignored" };
  }
  if (sure(pay.probability)) {
    if (pay.status === "no_purchase") return { to: "ignored" };
    const category = jev.category !== "not_invoice" && pay.status !== "bill_on_website" ? jev.category : formFromPayment();
    return { to: "invoice", category, unpaid };
  }
  if (jev.category === "not_invoice" && pay.status === "no_purchase") return { to: "ignored" };
  if (owner && owner.notInvoices >= 2 && owner.invoices === 0) return { to: "ignored" };
  if (owner && owner.invoices >= 2 && owner.notInvoices === 0) return { to: "invoice", category: formFromPayment(), unpaid };
  return { to: "unclear" };
}

export type VatAttachment = { attachmentId: string; filename: string; mimeType: string; size: number; inline: boolean };

/** Skips small inline images (logos, signatures) but keeps every possible document. */
export function vatCandidateAttachments(attachments: VatAttachment[]) {
  return attachments.filter((attachment) => !(attachment.mimeType.startsWith("image/") && (attachment.inline || attachment.size < 20_000)));
}

export type VatDuplicateCandidate = {
  id: number;
  status: "saved" | "to_get";
  supplierName: string | null;
  invoiceDate: string | null;
  grossMinor: number | null;
  invoiceNumber: string | null;
  hasFile: boolean;
  notes: string[];
};

function completeness(invoice: VatDuplicateCandidate) {
  return (invoice.hasFile ? 8 : 0) + (invoice.grossMinor !== null ? 4 : 0) + (invoice.invoiceNumber ? 1 : 0);
}

/**
 * The source app's post-run duplicate rules, with removal meaning "retain as
 * removed", never delete:
 *  1. A To get item covered by a saved invoice (or an earlier To get item) for
 *     the same supplier, compatible amount, within 7 days is cleared.
 *  2. Two saved invoices that are certainly one purchase (same invoice number,
 *     or same supplier and amount within 3 days where only one has a number):
 *     the less complete record is removed as a duplicate.
 *  3. Same supplier and amount with different or no numbers: both are flagged.
 */
export function planVatDuplicates(invoices: VatDuplicateCandidate[]) {
  const live = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  const removals: Array<{ id: number; keepId: number; reason: "invoice_received" | "duplicate" }> = [];
  const flagged = new Set<number>();
  const compatible = (a: VatDuplicateCandidate, b: VatDuplicateCandidate) => a.grossMinor === null || b.grossMinor === null || a.grossMinor === b.grossMinor;

  for (const toGet of invoices.filter((invoice) => invoice.status === "to_get").sort((a, b) => a.id - b.id)) {
    const cover = [...live.values()].find((other) => other.id !== toGet.id
      && sameSupplier(other.supplierName, toGet.supplierName)
      && compatible(other, toGet)
      && daysApart(other.invoiceDate, toGet.invoiceDate) <= 7
      && (other.status === "saved" || other.id < toGet.id));
    if (!cover) continue;
    removals.push({ id: toGet.id, keepId: cover.id, reason: cover.status === "saved" ? "invoice_received" : "duplicate" });
    live.delete(toGet.id);
  }

  const saved = [...live.values()].filter((invoice) => invoice.status === "saved").sort((a, b) => a.id - b.id);
  for (let index = 0; index < saved.length; index += 1) {
    const a = saved[index];
    if (!live.has(a.id)) continue;
    for (const b of saved.slice(0, index)) {
      if (!live.has(b.id) || !sameSupplier(a.supplierName, b.supplierName)) continue;
      const sameNumber = Boolean(a.invoiceNumber) && a.invoiceNumber === b.invoiceNumber;
      const likely = compatible(a, b) && daysApart(a.invoiceDate, b.invoiceDate) <= 3;
      // Suppliers send several emails about one refund; the same refund amount twice within a week is one refund.
      const sameRefund = a.grossMinor !== null && a.grossMinor < 0 && a.grossMinor === b.grossMinor && daysApart(a.invoiceDate, b.invoiceDate) <= 7;
      if (!sameNumber && !likely && !sameRefund) continue;
      if (sameNumber || sameRefund || !a.invoiceNumber !== !b.invoiceNumber) {
        const [keep, drop] = completeness(a) > completeness(b) ? [a, b] : [b, a];
        removals.push({ id: drop.id, keepId: keep.id, reason: "duplicate" });
        live.delete(drop.id);
        break;
      }
      if (!a.notes.includes("duplicate")) flagged.add(a.id);
      if (!b.notes.includes("duplicate")) flagged.add(b.id);
    }
  }
  return { removals, flagged: [...flagged].filter((id) => live.has(id)) };
}
