import assert from "node:assert/strict";
import test from "node:test";
import { planVatDuplicates, routeVatEmail, vatCandidateAttachments } from "../lib/vat-routing.ts";

const jev = (category, probability, status, payProbability) => ({
  category, probability, attachmentIndex: null, payment: { status, probability: payProbability }, raw: null,
});

test("a confident answer routes the email; doubt keeps it rather than hiding it", () => {
  assert.deepEqual(routeVatEmail(jev("invoice_attached", 0.95, "paid", 0.9), true), { to: "invoice", category: "invoice_attached", unpaid: false });
  assert.deepEqual(routeVatEmail(jev("not_invoice", 0.92, "no_purchase", 0.4), false), { to: "ignored" });
  // Confident "not an invoice" is overruled when the payment answer is just as sure money moved.
  assert.deepEqual(routeVatEmail(jev("not_invoice", 0.9, "bill_on_website", 0.85), false), { to: "invoice", category: "invoice_link_only", unpaid: false });
  assert.deepEqual(routeVatEmail(jev("invoice_in_body", 0.5, "payment_requested", 0.85), false), { to: "invoice", category: "invoice_in_body", unpaid: true });
  assert.deepEqual(routeVatEmail(jev("invoice_in_body", 0.5, "paid", 0.5), false), { to: "unclear" });
  // Staff decisions for the sender settle what Jev can't.
  assert.deepEqual(routeVatEmail(jev("invoice_in_body", 0.5, "paid", 0.5), false, { invoices: 0, notInvoices: 2 }), { to: "ignored" });
});

test("logos and signature images are not considered invoice documents", () => {
  const kept = vatCandidateAttachments([
    { attachmentId: "1", filename: "logo.png", mimeType: "image/png", size: 4_000, inline: true },
    { attachmentId: "2", filename: "photo.jpg", mimeType: "image/jpeg", size: 400_000, inline: false },
    { attachmentId: "3", filename: "invoice.pdf", mimeType: "application/pdf", size: 9_000, inline: false },
  ]);
  assert.deepEqual(kept.map((attachment) => attachment.attachmentId), ["2", "3"]);
});

test("after a run, fulfilled To get items and certain duplicates are retained as removed", () => {
  const base = { invoiceNumber: null, hasFile: false, notes: [] };
  const plan = planVatDuplicates([
    { ...base, id: 1, status: "to_get", supplierName: "Apple", invoiceDate: "2026-09-01", grossMinor: null },
    { ...base, id: 2, status: "saved", supplierName: "Apple Inc", invoiceDate: "2026-09-03", grossMinor: 999, invoiceNumber: "A1", hasFile: true },
    { ...base, id: 3, status: "saved", supplierName: "Apple", invoiceDate: "2026-09-03", grossMinor: 999 },
    { ...base, id: 4, status: "saved", supplierName: "Canva", invoiceDate: "2026-09-10", grossMinor: 1300, invoiceNumber: "X" },
    { ...base, id: 5, status: "saved", supplierName: "Canva", invoiceDate: "2026-09-11", grossMinor: 1300, invoiceNumber: "Y" },
  ]);
  assert.deepEqual(plan.removals, [
    { id: 1, keepId: 2, reason: "invoice_received" },
    { id: 3, keepId: 2, reason: "duplicate" },
  ]);
  assert.deepEqual(plan.flagged.sort(), [4, 5]);
});
