// Idempotent import of a VAT Automation PostgreSQL export into the Operations
// Turso schema. Safe to run repeatedly: rows already imported (matched by their
// source ids) are left untouched, so later staff edits are never overwritten.
// Credentials are never imported, even if a future export contained them.

import { parseMoneyToMinor } from "../lib/vat-money.ts";

const FORMAT = "serenity-hue-vat-export/v1";
const BATCH_SIZE = 200;
const INVOICE_STATUSES = new Set(["saved", "to_get"]);
const EMAIL_STATUSES = new Set(["processing", "invoice", "ignored", "error"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function exactMinor(value, label) {
  if (value === null || value === undefined) return null;
  try {
    // Purely textual: amounts with more than two decimals are rejected, never rounded.
    return parseMoneyToMinor(String(value));
  } catch {
    throw new Error(`${label}: ${value} is not an exact two-decimal amount`);
  }
}

function isoTimestamp(value, fallback) {
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  return fallback;
}

function isoDate(value) {
  return typeof value === "string" && ISO_DATE.test(value) ? value : null;
}

function json(value, fallback) {
  return JSON.stringify(value ?? fallback);
}

/** Validates the export shape and returns its four collections. */
export function readVatExport(data) {
  if (!data || data.format !== FORMAT) throw new Error(`Expected a ${FORMAT} export`);
  for (const key of ["settings", "mailAccounts", "emails", "invoices"]) {
    if (!Array.isArray(data[key])) throw new Error(`The export has no ${key} list`);
  }
  return data;
}

async function runBatches(db, statements) {
  let affected = 0;
  for (let index = 0; index < statements.length; index += BATCH_SIZE) {
    const results = await db.batch(statements.slice(index, index + BATCH_SIZE), "write");
    affected += results.reduce((sum, result) => sum + Number(result.rowsAffected ?? 0), 0);
  }
  return affected;
}

export async function importVatExport(db, rawData, options = {}) {
  const data = readVatExport(rawData);
  const importedAt = options.now ?? new Date().toISOString();

  // Validate and convert every invoice before writing anything.
  const invoices = data.invoices.map((invoice) => {
    const label = `invoice ${invoice.id}`;
    if (!Number.isSafeInteger(invoice.id)) throw new Error(`${label}: missing id`);
    if (!INVOICE_STATUSES.has(invoice.status)) throw new Error(`${label}: unknown status ${invoice.status}`);
    return {
      legacyId: invoice.id,
      emailId: invoice.emailId ?? null,
      source: invoice.source === "email" ? "email" : "manual",
      documentType: invoice.documentType ?? null,
      supplierName: invoice.supplierName ?? null,
      supplierVatNumber: invoice.supplierVatNumber ?? null,
      invoiceNumber: invoice.invoiceNumber ?? null,
      invoiceDate: isoDate(invoice.invoiceDate),
      dueDate: isoDate(invoice.dueDate),
      currency: invoice.currency ?? null,
      netMinor: exactMinor(invoice.netAmount, `${label} net`),
      vatMinor: exactMinor(invoice.vatAmount, `${label} VAT`),
      grossMinor: exactMinor(invoice.grossAmount, `${label} total`),
      vatBreakdown: Array.isArray(invoice.vatBreakdown)
        ? invoice.vatBreakdown.map((line, index) => ({
            rate: Number(line.rate),
            netMinor: exactMinor(line.net, `${label} breakdown ${index + 1} net`),
            vatMinor: exactMinor(line.vat, `${label} breakdown ${index + 1} VAT`),
          }))
        : null,
      originalInvoiceNumber: invoice.originalInvoiceNumber ?? null,
      portalUrl: invoice.portalUrl ?? null,
      fieldConfidence: invoice.fieldConfidence ?? null,
      status: invoice.status,
      notes: Array.isArray(invoice.notes) ? invoice.notes.filter((note) => typeof note === "string") : [],
      fileName: invoice.fileName ?? null,
      dropboxPath: invoice.dropboxPath ?? null,
      dropboxUrl: invoice.dropboxUrl ?? null,
      createdAt: isoTimestamp(invoice.createdAt, importedAt),
      updatedAt: isoTimestamp(invoice.updatedAt, importedAt),
    };
  });

  // Inboxes: identity only, never tokens. An inbox already connected in the
  // Operations app keeps its authorization and is linked to its source id.
  const accountStatements = data.mailAccounts.flatMap((account) => {
    if (!Number.isSafeInteger(account.id) || !["google", "microsoft"].includes(account.provider) || typeof account.accountEmail !== "string") {
      throw new Error(`mail account ${account.id}: unexpected shape`);
    }
    const email = account.accountEmail.toLowerCase();
    const createdAt = isoTimestamp(account.createdAt, importedAt);
    return [
      {
        sql: `INSERT INTO vat_mail_accounts (legacy_id, provider, account_email, last_error, last_synced_at, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
        args: [account.id, account.provider, email, account.lastError ?? null, isoTimestamp(account.lastSyncedAt, null), createdAt, createdAt],
      },
      {
        sql: "UPDATE vat_mail_accounts SET legacy_id = ? WHERE provider = ? AND account_email = ? AND legacy_id IS NULL",
        args: [account.id, account.provider, email],
      },
    ];
  });
  await runBatches(db, accountStatements);
  const accountMap = new Map((await db.execute("SELECT id, legacy_id FROM vat_mail_accounts WHERE legacy_id IS NOT NULL")).rows
    .map((row) => [Number(row.legacy_id), Number(row.id)]));

  const emailStatements = data.emails.map((email) => {
    if (typeof email.id !== "string" || !email.id) throw new Error("An email has no id");
    if (!EMAIL_STATUSES.has(email.status)) throw new Error(`email ${email.id}: unknown status ${email.status}`);
    return {
      sql: `INSERT INTO vat_emails (id, account_id, thread_id, from_name, from_email, subject, received_at, attachments_json, body_text,
              category, confidence, jev_answers_json, status, decided_by, error, attempts, created_at, imported_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO NOTHING`,
      args: [
        email.id,
        email.accountId === null || email.accountId === undefined ? null : accountMap.get(email.accountId) ?? null,
        email.threadId ?? null,
        email.fromName ?? null,
        email.fromEmail ?? null,
        email.subject ?? null,
        isoTimestamp(email.receivedAt, importedAt),
        json(email.attachments, []),
        email.bodyText ?? null,
        email.category ?? null,
        typeof email.confidence === "number" ? email.confidence : null,
        email.jevAnswers === null || email.jevAnswers === undefined ? null : json(email.jevAnswers, null),
        email.status,
        email.decidedBy === "owner" ? "owner" : "jev",
        email.error ?? null,
        Number.isSafeInteger(email.attempts) ? email.attempts : 0,
        isoTimestamp(email.createdAt, importedAt),
        importedAt,
      ],
    };
  });
  const emailsInserted = await runBatches(db, emailStatements);

  const invoiceStatements = invoices.map((invoice) => ({
    sql: `INSERT INTO vat_invoices (legacy_id, email_id, source, document_type, supplier_name, supplier_vat_number, invoice_number,
            invoice_date, due_date, currency, net_amount_minor, vat_amount_minor, gross_amount_minor, vat_breakdown_json,
            original_invoice_number, portal_url, field_confidence_json, status, notes_json, file_name, dropbox_path, dropbox_url,
            dropbox_account_id, created_at, updated_at, imported_at)
          VALUES (?, (SELECT id FROM vat_emails WHERE id = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
          ON CONFLICT(legacy_id) DO NOTHING`,
    args: [
      invoice.legacyId, invoice.emailId, invoice.source, invoice.documentType, invoice.supplierName, invoice.supplierVatNumber,
      invoice.invoiceNumber, invoice.invoiceDate, invoice.dueDate, invoice.currency, invoice.netMinor, invoice.vatMinor,
      invoice.grossMinor, invoice.vatBreakdown === null ? null : JSON.stringify(invoice.vatBreakdown), invoice.originalInvoiceNumber,
      invoice.portalUrl, invoice.fieldConfidence === null ? null : JSON.stringify(invoice.fieldConfidence), invoice.status,
      JSON.stringify(invoice.notes), invoice.fileName, invoice.dropboxPath, invoice.dropboxUrl, invoice.createdAt, invoice.updatedAt, importedAt,
    ],
  }));
  const invoicesInserted = await runBatches(db, invoiceStatements);

  const settings = data.settings.filter((setting) => setting.key === "sync_start_date" && ISO_DATE.test(String(setting.value)));
  const settingsInserted = await runBatches(db, settings.map((setting) => ({
    sql: "INSERT INTO vat_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING",
    args: [setting.key, String(setting.value), isoTimestamp(setting.updatedAt, importedAt)],
  })));

  const summary = {
    mailAccounts: data.mailAccounts.length,
    emails: { total: data.emails.length, inserted: emailsInserted },
    invoices: { total: invoices.length, inserted: invoicesInserted },
    settings: { total: settings.length, inserted: settingsInserted },
  };
  if (emailsInserted || invoicesInserted) {
    await db.execute({
      sql: `INSERT INTO vat_events (id, occurred_at, actor_id, actor_label, action, invoice_id, summary, details_json)
            VALUES (?, ?, NULL, 'VAT data import', 'import.completed', NULL, ?, ?)`,
      args: [crypto.randomUUID(), importedAt, `Imported ${invoicesInserted} invoices and ${emailsInserted} emails from the VAT Automation app`, JSON.stringify(summary)],
    });
  }
  return summary;
}
