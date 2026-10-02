import assert from "node:assert/strict";
import test from "node:test";
import { formatVatMoney, minorToDecimal, parseMoneyToMinor } from "../lib/vat-money.ts";
import {
  buildVatInvoiceLogCsv,
  figureNotes,
  matchSavedInvoice,
  normalizeVatInvoiceFields,
  notesAfterReview,
  parseVatWorkspaceQuery,
  sameSupplier,
  vatFolderFor,
  vatInvoiceFileName,
  vatMonthOptions,
} from "../lib/vat-rules.ts";

test("VAT money is exact: decimal text round-trips through integer minor units", () => {
  assert.equal(parseMoneyToMinor("100.00"), 10000);
  assert.equal(parseMoneyToMinor("£1,234.5"), 123450);
  assert.equal(parseMoneyToMinor("-0.10"), -10);
  assert.equal(parseMoneyToMinor("0.1"), 10);
  assert.equal(parseMoneyToMinor("  "), null);
  assert.equal(parseMoneyToMinor(null), null);
  // 0.1 + 0.2 style float drift cannot occur: the parse is purely textual.
  assert.equal(parseMoneyToMinor("19.99") + parseMoneyToMinor("0.01"), 2000);
  assert.throws(() => parseMoneyToMinor("1.234"), /two decimal places/);
  assert.throws(() => parseMoneyToMinor("abc"), /two decimal places/);
  assert.equal(minorToDecimal(123450), "1234.50");
  assert.equal(minorToDecimal(-5), "-0.05");
  assert.equal(minorToDecimal(null), null);
  assert.equal(formatVatMoney(48000, "GBP"), "£480.00");
  assert.equal(formatVatMoney(null), "—");
});

test("figure notes flag only what the accountant can act on", () => {
  assert.deepEqual(figureNotes({ documentType: "invoice", netMinor: 10000, vatMinor: 2000, grossMinor: 12000 }), []);
  assert.deepEqual(figureNotes({ documentType: "receipt", netMinor: null, vatMinor: null, grossMinor: 999 }), ["vat_not_shown"]);
  assert.deepEqual(figureNotes({ documentType: null, netMinor: null, vatMinor: null, grossMinor: null }), ["amount_not_shown"]);
  assert.deepEqual(figureNotes({ documentType: "import_vat", netMinor: 10000, vatMinor: 2000, grossMinor: 12500 }), ["import_vat", "totals_dont_add_up"]);
  // A rounding penny is tolerated, as in the source app.
  assert.deepEqual(figureNotes({ documentType: null, netMinor: 833, vatMinor: 167, grossMinor: 1001 }), []);
});

test("reviewed details recalculate figure notes, clear review prompts, and keep duplicates", () => {
  const figures = { documentType: "invoice", netMinor: 1000, vatMinor: 200, grossMinor: 1200 };
  assert.deepEqual(notesAfterReview(["unsure", "extraction_failed", "duplicate", "vat_not_shown"], "saved", figures), ["duplicate"]);
  assert.deepEqual(notesAfterReview(["bill_on_website", "unsure"], "to_get", figures), ["bill_on_website"]);
});

test("staff-entered invoice details are validated in plain language", () => {
  const fields = normalizeVatInvoiceFields({
    supplierName: "  Kilsby Williams ",
    invoiceNumber: "#94963-2",
    invoiceDate: "2026-09-21",
    currency: "gbp",
    netAmount: "83.33",
    vatAmount: "16.67",
    grossAmount: "£100.00",
  }, { requireDate: true });
  assert.equal(fields.supplierName, "Kilsby Williams");
  assert.equal(fields.invoiceNumber, "94963-2");
  assert.equal(fields.currency, "GBP");
  assert.equal(fields.grossMinor, 10000);
  assert.throws(() => normalizeVatInvoiceFields({ supplierName: "" }, { requireDate: false }), /Supplier is required/);
  assert.throws(() => normalizeVatInvoiceFields({ supplierName: "A", invoiceDate: "2026-02-30" }, { requireDate: false }), /valid date/);
  assert.throws(() => normalizeVatInvoiceFields({ supplierName: "A" }, { requireDate: true }), /right month/);
  assert.throws(() => normalizeVatInvoiceFields({ supplierName: "A", grossAmount: "12.345" }, { requireDate: false }), /Total:/);
  assert.throws(() => normalizeVatInvoiceFields({ supplierName: "A", documentType: "random" }, { requireDate: false }), /document type/);
});

test("filing keeps the existing monthly folders and file names", () => {
  assert.equal(vatFolderFor("2026-08-17"), "/Invoices/2026/08 - August");
  assert.equal(
    vatInvoiceFileName({ invoiceDate: "2026-09-21", supplierName: "Kilsby Williams", invoiceNumber: "94963-2", grossMinor: 10000, currency: "GBP" }, "pdf"),
    "2026-09-21_Kilsby-Williams_94963-2_£100.00.pdf",
  );
  assert.equal(
    vatInvoiceFileName({ invoiceDate: "2026-09-01", supplierName: "A/B: C", invoiceNumber: null, grossMinor: null, currency: null }, "png"),
    "2026-09-01_A-B-C.png",
  );
});

test("a saved invoice clears matching To get items and only flags possible duplicates", () => {
  const saved = { id: 10, status: "saved", supplierName: "Viber Media Ltd", invoiceDate: "2026-09-10", grossMinor: 500, invoiceNumber: "A1" };
  const { covered, duplicates } = matchSavedInvoice(saved, [
    { id: 1, status: "to_get", supplierName: "Viber", invoiceDate: "2026-09-05", grossMinor: null, invoiceNumber: null },
    { id: 2, status: "to_get", supplierName: "Viber", invoiceDate: "2026-08-01", grossMinor: 500, invoiceNumber: null },
    { id: 3, status: "to_get", supplierName: "Apple", invoiceDate: "2026-09-10", grossMinor: 500, invoiceNumber: null },
    { id: 4, status: "saved", supplierName: "Viber Media", invoiceDate: "2026-09-12", grossMinor: 500, invoiceNumber: "B2" },
    { id: 5, status: "saved", supplierName: "Viber", invoiceDate: "2026-06-12", grossMinor: 900, invoiceNumber: "A1" },
    { id: 6, status: "saved", supplierName: "Viber", invoiceDate: "2026-09-20", grossMinor: 500, invoiceNumber: "C3" },
    { id: 10, status: "to_get", supplierName: "Viber", invoiceDate: "2026-09-10", grossMinor: 500, invoiceNumber: null },
  ]);
  assert.deepEqual(covered, [1]);
  assert.deepEqual(duplicates, [4, 5]);
  assert.equal(sameSupplier("Anthropic, PBC", "anthropic"), true);
  assert.equal(sameSupplier("Co", "Co-op"), false);
});

test("workspace query parsing falls back to safe defaults", () => {
  assert.deepEqual(parseVatWorkspaceQuery({ tab: "to_get", month: "2026-09", page: "3" }), { tab: "to_get", month: "2026-09", page: 3, review: false });
  assert.deepEqual(parseVatWorkspaceQuery({ tab: "drop table", month: "2026-13", page: "-4" }), { tab: "saved", month: null, page: 1, review: false });
  assert.deepEqual(vatMonthOptions("2026-08-14", new Date("2026-10-01T00:00:00Z")), ["2026-10", "2026-09", "2026-08"]);
});

test("the accountant's log keeps exact amounts and neutralises spreadsheet formulas", () => {
  const csv = buildVatInvoiceLogCsv([
    { invoiceDate: "2026-09-21", supplierName: "=HYPERLINK(\"x\")", invoiceNumber: "1", currency: "GBP", netMinor: 8333, vatMinor: 1667, grossMinor: 10000, status: "saved", notes: ["duplicate"], portalUrl: null, dropboxUrl: "https://example.test/f" },
    { invoiceDate: "2026-09-22", supplierName: "Shop, Ltd", invoiceNumber: null, currency: null, netMinor: null, vatMinor: null, grossMinor: -500, status: "to_get", notes: ["bill_on_website"], portalUrl: "https://supplier.test", dropboxUrl: null },
  ]);
  assert.ok(csv.startsWith("﻿Month,Invoice date"));
  const [, first, second] = csv.split("\r\n");
  assert.match(first, /^September,21\/09\/2026,"'=HYPERLINK\(""x""\)",1,GBP,83\.33,16\.67,100\.00,Saved,"Possible duplicate:/);
  assert.match(second, /"Shop, Ltd",,,,,-5\.00,TO GET,"Bill on their website: .* \| Supplier site: https:\/\/supplier\.test",$/);
});

test("a GBP total with no VAT shown is split at the 20% standard rate", async () => {
  const { withEstimatedVat } = await import("../lib/vat-rules.ts");
  const base = { netMinor: null, vatMinor: null, currency: "GBP", documentType: "receipt" };
  const ten = withEstimatedVat({ ...base, grossMinor: 1000 }, ["vat_not_shown"]);
  assert.deepEqual([ten.figures.netMinor, ten.figures.vatMinor], [833, 167]);
  assert.deepEqual(ten.notes, ["vat_estimated"]);
  assert.equal(withEstimatedVat({ ...base, grossMinor: 1000, vatMinor: 0 }, []).figures.vatMinor, 0, "explicit zero VAT is kept");
  assert.equal(withEstimatedVat({ ...base, grossMinor: 1000, currency: "USD" }, []).figures.vatMinor, null, "foreign currency is left as printed");
  assert.equal(withEstimatedVat({ ...base, grossMinor: -1200 }, []).figures.vatMinor, -200, "credit notes estimate negative VAT");
});
