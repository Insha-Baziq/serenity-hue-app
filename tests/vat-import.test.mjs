import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { createClient } from "@libsql/client";
import { importVatExport } from "../scripts/vat-import.mjs";

async function withDatabase(run) {
  const directory = await mkdtemp(join(tmpdir(), "serenity-hue-vat-"));
  const db = createClient({ url: pathToFileURL(join(directory, "vat.db")).href });
  try {
    await db.executeMultiple(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"));
    await run(db);
  } finally {
    db.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }).catch(() => undefined);
  }
}

function exportFixture() {
  return {
    format: "serenity-hue-vat-export/v1",
    exportedAt: "2026-10-01T10:00:00.000Z",
    settings: [{ key: "sync_start_date", value: "2026-09-01", updatedAt: "2026-09-30T09:00:00.000Z" }],
    mailAccounts: [
      { id: 1, provider: "microsoft", accountEmail: "Accounts@Example.test", lastError: null, lastSyncedAt: "2026-09-30T15:00:00.000Z", createdAt: "2026-09-29T08:00:00.000Z", refreshToken: "must-not-import" },
      { id: 2, provider: "microsoft", accountEmail: "owner@example.test", lastError: null, lastSyncedAt: null, createdAt: "2026-09-29T08:00:00.000Z" },
    ],
    emails: [
      { id: "ms:abc", accountId: 1, subject: "Your invoice", fromName: "Kilsby Williams", fromEmail: "billing@kw.test", receivedAt: "2026-09-21T10:15:00.000Z", attachments: [{ filename: "inv.pdf" }], bodyText: "Invoice attached", category: "invoice_attached", confidence: 0.93, jevAnswers: { category: { choice: "invoice_attached" } }, status: "invoice", decidedBy: "jev", error: null, attempts: 1, createdAt: "2026-09-30T15:00:00.000Z" },
      { id: "ms:news", accountId: 2, subject: "Newsletter", fromName: null, fromEmail: "news@shop.test", receivedAt: "2026-09-22T10:15:00.000Z", attachments: [], bodyText: null, category: "not_invoice", confidence: 0.99, jevAnswers: null, status: "ignored", decidedBy: "owner", error: null, attempts: 1, createdAt: "2026-09-30T15:00:00.000Z" },
    ],
    invoices: [
      { id: 7, emailId: "ms:abc", source: "email", documentType: "invoice", supplierName: "Kilsby Williams", invoiceNumber: "94963-2", invoiceDate: "2026-09-21", dueDate: null, currency: "GBP", netAmount: "83.33", vatAmount: "16.67", grossAmount: "100.00", vatBreakdown: [{ rate: "20", net: "83.33", vat: "16.67" }], fieldConfidence: { total: 0.9 }, status: "saved", notes: [], fileName: "f.pdf", dropboxPath: "/Invoices/2026/09 - September/f.pdf", dropboxUrl: "https://dropbox.test/f", createdAt: "2026-09-30T15:00:00.000Z", updatedAt: "2026-09-30T15:00:00.000Z" },
      { id: 8, emailId: null, source: "email", documentType: "credit_note", supplierName: "Shopify", invoiceNumber: null, invoiceDate: "2026-09-02", dueDate: null, currency: "USD", netAmount: "-0.10", vatAmount: null, grossAmount: "-12345678.99", vatBreakdown: null, fieldConfidence: null, status: "to_get", notes: ["bill_on_website"], portalUrl: "https://shopify.test/bills", createdAt: "2026-09-30T15:00:00.000Z", updatedAt: "2026-09-30T15:00:00.000Z" },
    ],
  };
}

test("VAT tables retain records, store money as integers, and keep history append-only", async () => {
  await withDatabase(async (db) => {
    await db.execute("INSERT INTO vat_invoices (source, status, created_at, updated_at, gross_amount_minor) VALUES ('manual', 'saved', 'x', 'x', 100)");
    await assert.rejects(db.execute("DELETE FROM vat_invoices"), /retained/);
    await assert.rejects(db.execute("INSERT INTO vat_invoices (source, status, created_at, updated_at, gross_amount_minor) VALUES ('manual', 'saved', 'x', 'x', 1.5)"), /CHECK/);
    await assert.rejects(db.execute("INSERT INTO vat_invoices (source, status, created_at, updated_at) VALUES ('manual', 'removed', 'x', 'x')"), /CHECK/);
    await assert.rejects(db.execute("INSERT INTO vat_invoices (source, status, created_at, updated_at, invoice_date) VALUES ('manual', 'saved', 'x', 'x', '21/09/2026')"), /CHECK/);
    await db.execute("INSERT INTO vat_events (id, occurred_at, actor_label, action, summary) VALUES ('e1', 'x', 'Staff', 'a', 's')");
    await assert.rejects(db.execute("UPDATE vat_events SET summary = 'changed'"), /append-only/);
    await assert.rejects(db.execute("DELETE FROM vat_events"), /append-only/);
  });
});

test("the PostgreSQL export imports exactly, without credentials, and re-runs safely", async () => {
  await withDatabase(async (db) => {
    // An inbox already connected in Operations keeps its authorization.
    await db.execute("INSERT INTO vat_mail_accounts (provider, account_email, refresh_token, created_at, updated_at) VALUES ('microsoft', 'owner@example.test', 'vat-token:v1:existing', 'x', 'x')");

    const first = await importVatExport(db, exportFixture(), { now: "2026-10-01T12:00:00.000Z" });
    assert.deepEqual(first.invoices, { total: 2, inserted: 2 });
    assert.deepEqual(first.emails, { total: 2, inserted: 2 });

    const invoices = (await db.execute("SELECT legacy_id, net_amount_minor, vat_amount_minor, gross_amount_minor, typeof(gross_amount_minor) AS kind, vat_breakdown_json, email_id, dropbox_account_id, status FROM vat_invoices ORDER BY legacy_id")).rows;
    assert.equal(invoices[0].gross_amount_minor, 10000);
    assert.equal(invoices[0].kind, "integer");
    assert.equal(invoices[0].email_id, "ms:abc");
    assert.equal(invoices[0].dropbox_account_id, null, "files from the earlier app are marked legacy");
    assert.deepEqual(JSON.parse(invoices[0].vat_breakdown_json), [{ rate: 20, netMinor: 8333, vatMinor: 1667 }]);
    assert.equal(invoices[1].net_amount_minor, -10);
    assert.equal(invoices[1].vat_amount_minor, null);
    assert.equal(invoices[1].gross_amount_minor, -1234567899);

    const accounts = (await db.execute("SELECT legacy_id, account_email, refresh_token FROM vat_mail_accounts ORDER BY legacy_id")).rows;
    assert.deepEqual(accounts.map((row) => [row.legacy_id, row.account_email, row.refresh_token]), [
      [1, "accounts@example.test", null],
      [2, "owner@example.test", "vat-token:v1:existing"],
    ]);
    const emails = (await db.execute("SELECT e.id, a.legacy_id FROM vat_emails e JOIN vat_mail_accounts a ON a.id = e.account_id ORDER BY e.id")).rows;
    assert.deepEqual(emails.map((row) => [row.id, row.legacy_id]), [["ms:abc", 1], ["ms:news", 2]]);
    const everything = JSON.stringify((await db.execute("SELECT * FROM vat_mail_accounts")).rows);
    assert.ok(!everything.includes("must-not-import"));

    // Staff edit after import, then the import runs again.
    await db.execute("UPDATE vat_invoices SET supplier_name = 'Kilsby Williams LLP' WHERE legacy_id = 7");
    const second = await importVatExport(db, exportFixture(), { now: "2026-10-02T12:00:00.000Z" });
    assert.equal(second.invoices.inserted, 0);
    assert.equal(second.emails.inserted, 0);
    const kept = (await db.execute("SELECT supplier_name FROM vat_invoices WHERE legacy_id = 7")).rows[0];
    assert.equal(kept.supplier_name, "Kilsby Williams LLP");
    const counts = (await db.execute("SELECT (SELECT COUNT(*) FROM vat_invoices) AS invoices, (SELECT COUNT(*) FROM vat_events WHERE action = 'import.completed') AS imports")).rows[0];
    assert.equal(counts.invoices, 2);
    assert.equal(counts.imports, 1);
  });
});

test("an inexact amount stops the import before anything is written", async () => {
  await withDatabase(async (db) => {
    const data = exportFixture();
    data.invoices[0].grossAmount = "100.005";
    await assert.rejects(importVatExport(db, data), /invoice 7 total: 100\.005 is not an exact two-decimal amount/);
    const count = (await db.execute("SELECT COUNT(*) AS count FROM vat_emails")).rows[0].count;
    assert.equal(count, 0);
  });
});
