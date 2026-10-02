import "server-only";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getTursoClient } from "@/lib/turso";
import { insertActivityEvent, invalidateActivityLogCache } from "@/lib/repository";
import type { VatDuplicateCandidate } from "@/lib/vat-routing";
import type { ActivityActor } from "@/lib/types";

// Persistence for Get invoices runs, their queue, and the email/invoice rows
// the pipeline writes. Records are business-wide; staff identity is audit only.

export const VAT_DEFAULT_START_DATE = "2026-07-01";
const MAX_ATTEMPTS = 3;

export type VatRunStatus = "listing" | "processing" | "paused" | "completed" | "cancelled";
export type VatRun = {
  id: string;
  startDate: string;
  status: VatRunStatus;
  total: number;
  processed: number;
  failed: number;
  invoices: number;
  toGet: number;
  pauseService: string | null;
  pauseDetail: string | null;
  lastError: string | null;
  startedBy: string;
  createdAt: string;
  finishedAt: string | null;
};

const text = (value: unknown) => (value === null || value === undefined ? null : String(value));

function toRun(row: Record<string, unknown>): VatRun {
  return {
    id: String(row.id),
    startDate: String(row.start_date),
    status: row.status as VatRunStatus,
    total: Number(row.total),
    processed: Number(row.processed),
    failed: Number(row.failed),
    invoices: Number(row.invoices),
    toGet: Number(row.to_get),
    pauseService: text(row.pause_service),
    pauseDetail: text(row.pause_detail),
    lastError: text(row.last_error),
    startedBy: String(row.started_by_label),
    createdAt: String(row.created_at),
    finishedAt: text(row.finished_at),
  };
}

const RUN_COLUMNS = "id, start_date, status, total, processed, failed, invoices, to_get, pause_service, pause_detail, last_error, started_by_label, created_at, finished_at";

export async function getVatRun(id: string) {
  const db = await getTursoClient();
  const row = (await db.execute({ sql: `SELECT ${RUN_COLUMNS} FROM vat_runs WHERE id = ?`, args: [id] })).rows[0];
  return row ? toRun(row as Record<string, unknown>) : null;
}

/** The unfinished run (if any) and the suggested start: the newest email's day, else 1 July 2026. */
export async function getVatRunOverview() {
  const db = await getTursoClient();
  const [active, latest] = await db.batch([
    { sql: `SELECT ${RUN_COLUMNS} FROM vat_runs WHERE status IN ('listing', 'processing', 'paused') ORDER BY created_at DESC LIMIT 1`, args: [] },
    { sql: "SELECT MAX(received_at) AS latest FROM vat_emails", args: [] },
  ], "read");
  const latestEmail = text(latest.rows[0]?.latest);
  return {
    activeRun: active.rows[0] ? toRun(active.rows[0] as Record<string, unknown>) : null,
    latestEmailAt: latestEmail,
    suggestedStartDate: latestEmail ? latestEmail.slice(0, 10) : VAT_DEFAULT_START_DATE,
  };
}

export async function createVatRun(startDate: string, actor: ActivityActor) {
  const db = await getTursoClient();
  const id = randomUUID();
  const now = new Date().toISOString();
  await db.batch([
    // Starting again from a new date replaces any unfinished run; its handled emails are skipped anyway.
    { sql: "UPDATE vat_runs SET status = 'cancelled', finished_at = ?, updated_at = ? WHERE status IN ('listing', 'processing', 'paused')", args: [now, now] },
    {
      sql: `INSERT INTO vat_runs (id, start_date, status, started_by_id, started_by_label, created_at, updated_at)
            VALUES (?, ?, 'listing', ?, ?, ?, ?)`,
      args: [id, startDate, actor.id, actor.label, now, now],
    },
  ], "write");
  return id;
}

/** One step at a time per run, across tabs and function instances. */
export async function takeVatRunLease(id: string, ms: number) {
  const db = await getTursoClient();
  const now = new Date();
  const result = await db.execute({
    sql: `UPDATE vat_runs SET lease_until = ? WHERE id = ? AND status IN ('listing', 'processing')
          AND (lease_until IS NULL OR lease_until < ?)`,
    args: [new Date(now.getTime() + ms).toISOString(), id, now.toISOString()],
  });
  return Number(result.rowsAffected) === 1;
}

export async function releaseVatRunLease(id: string) {
  const db = await getTursoClient();
  await db.execute({ sql: "UPDATE vat_runs SET lease_until = NULL WHERE id = ?", args: [id] });
}

export async function setVatRunStatus(id: string, status: VatRunStatus, extra: { pauseService?: string; pauseDetail?: string; lastError?: string } = {}) {
  const db = await getTursoClient();
  const now = new Date().toISOString();
  await db.execute({
    sql: `UPDATE vat_runs SET status = ?, pause_service = ?, pause_detail = ?, last_error = COALESCE(?, last_error), updated_at = ?,
            finished_at = CASE WHEN ? IN ('completed', 'cancelled') THEN ? ELSE finished_at END
          WHERE id = ?`,
    args: [status, extra.pauseService ?? null, extra.pauseDetail ?? null, extra.lastError ?? null, now, status, now, id],
  });
}

export async function addVatRunCounts(id: string, delta: { processed?: number; failed?: number; invoices?: number; toGet?: number; lastError?: string | null }) {
  const db = await getTursoClient();
  await db.execute({
    sql: `UPDATE vat_runs SET processed = processed + ?, failed = failed + ?, invoices = invoices + ?, to_get = to_get + ?,
            last_error = COALESCE(?, last_error), updated_at = ? WHERE id = ?`,
    args: [delta.processed ?? 0, delta.failed ?? 0, delta.invoices ?? 0, delta.toGet ?? 0, delta.lastError ?? null, new Date().toISOString(), id],
  });
}

export async function connectedVatMailboxIds() {
  const db = await getTursoClient();
  return (await db.execute("SELECT id FROM vat_mail_accounts WHERE refresh_token IS NOT NULL ORDER BY id")).rows.map((row) => Number(row.id));
}

/**
 * Ids that still need work: never seen, or seen but unfinished with tries
 * left. Emails already classified are never sent to Jev or LlamaExtract again.
 */
export async function filterUnhandledVatEmails(ids: string[]) {
  const db = await getTursoClient();
  const handled = new Set<string>();
  for (let index = 0; index < ids.length; index += 400) {
    const chunk = ids.slice(index, index + 400);
    const rows = (await db.execute({
      sql: `SELECT id, status, attempts FROM vat_emails WHERE id IN (${chunk.map(() => "?").join(", ")})`,
      args: chunk,
    })).rows;
    for (const row of rows) {
      const unfinished = row.status === "error" || row.status === "processing";
      if (!unfinished || Number(row.attempts) >= MAX_ATTEMPTS) handled.add(String(row.id));
    }
  }
  return ids.filter((id) => !handled.has(id));
}

/** Queues the run's emails oldest first and moves the run to processing. */
export async function enqueueVatRunItems(runId: string, items: Array<{ emailId: string; accountId: number }>) {
  const db = await getTursoClient();
  for (let index = 0; index < items.length; index += 300) {
    await db.batch(items.slice(index, index + 300).map((item, offset) => ({
      sql: "INSERT INTO vat_run_items (run_id, email_id, account_id, position) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING",
      args: [runId, item.emailId, item.accountId, index + offset],
    })), "write");
  }
  const now = new Date().toISOString();
  await db.execute({
    sql: `UPDATE vat_runs SET total = (SELECT COUNT(*) FROM vat_run_items WHERE run_id = ?), status = 'processing', updated_at = ?
          WHERE id = ? AND status = 'listing'`,
    args: [runId, now, runId],
  });
}

export async function nextVatRunItems(runId: string, limit: number) {
  const db = await getTursoClient();
  return (await db.execute({
    sql: "SELECT email_id, account_id FROM vat_run_items WHERE run_id = ? AND state = 'pending' ORDER BY position LIMIT ?",
    args: [runId, limit],
  })).rows.map((row) => ({ emailId: String(row.email_id), accountId: Number(row.account_id) }));
}

export async function setVatRunItemState(runId: string, emailId: string, state: "done" | "failed") {
  const db = await getTursoClient();
  await db.execute({ sql: "UPDATE vat_run_items SET state = ? WHERE run_id = ? AND email_id = ?", args: [state, runId, emailId] });
}

// Email rows -----------------------------------------------------------------------

export async function startVatEmail(input: {
  id: string; accountId: number; threadId: string | null; fromName: string | null; fromEmail: string | null;
  subject: string | null; receivedAt: string; attachmentsJson: string;
}) {
  const db = await getTursoClient();
  await db.execute({
    sql: `INSERT INTO vat_emails (id, account_id, thread_id, from_name, from_email, subject, received_at, attachments_json, status, attempts, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'processing', 1, ?)
          ON CONFLICT(id) DO UPDATE SET status = 'processing', account_id = excluded.account_id, error = NULL, attempts = vat_emails.attempts + 1`,
    args: [input.id, input.accountId, input.threadId, input.fromName, input.fromEmail, input.subject, input.receivedAt, input.attachmentsJson, new Date().toISOString()],
  });
}

export async function vatInvoiceForEmail(emailId: string) {
  const db = await getTursoClient();
  const row = (await db.execute({ sql: "SELECT id, status FROM vat_invoices WHERE email_id = ? LIMIT 1", args: [emailId] })).rows[0];
  return row ? { id: Number(row.id), status: String(row.status) } : null;
}

export async function finishVatEmail(id: string, input: { status: "ignored" | "invoice"; category: string; confidence: number; jevAnswers: unknown; bodyText: string | null }) {
  const db = await getTursoClient();
  await db.execute({
    sql: "UPDATE vat_emails SET status = ?, category = ?, confidence = ?, jev_answers_json = ?, body_text = ?, error = NULL WHERE id = ?",
    args: [input.status, input.category, input.confidence, JSON.stringify(input.jevAnswers ?? null), input.bodyText, id],
  });
}

export async function failVatEmail(id: string, message: string, keepAttempt: boolean) {
  const db = await getTursoClient();
  await db.execute({
    sql: `UPDATE vat_emails SET status = 'error', error = ?, attempts = CASE WHEN ? THEN MAX(attempts - 1, 0) ELSE attempts END WHERE id = ?`,
    args: [message.slice(0, 1000), keepAttempt ? 1 : 0, id],
  });
}

const domainOf = (email: string) => email.split("@")[1]?.toLowerCase() ?? email.toLowerCase();

/** Staff decisions (never Jev's guesses) about earlier emails from this sender's domain. */
export async function vatOwnerHistory(fromEmail: string | null) {
  if (!fromEmail) return undefined;
  const db = await getTursoClient();
  const row = (await db.execute({
    sql: `SELECT SUM(status = 'invoice') AS invoices, SUM(status = 'ignored') AS not_invoices FROM vat_emails
          WHERE decided_by = 'owner' AND lower(substr(from_email, instr(from_email, '@') + 1)) = ?`,
    args: [domainOf(fromEmail)],
  })).rows[0];
  const invoices = Number(row?.invoices ?? 0);
  const notInvoices = Number(row?.not_invoices ?? 0);
  if (invoices + notInvoices === 0) return undefined;
  return {
    invoices,
    notInvoices,
    text: `The owner reviewed ${invoices + notInvoices} earlier email(s) from this sender: ${invoices} were invoices or receipts she needed, ${notInvoices} were not.`,
  };
}

export type VatPipelineInvoice = {
  emailId: string;
  status: "saved" | "to_get";
  documentType: string | null;
  supplierName: string | null;
  supplierVatNumber: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  currency: string | null;
  netMinor: number | null;
  vatMinor: number | null;
  grossMinor: number | null;
  vatBreakdownJson: string | null;
  originalInvoiceNumber: string | null;
  portalUrl: string | null;
  fieldConfidenceJson: string | null;
  notes: string[];
  file: { dropboxPath: string; fileName: string; dropboxUrl: string | null; dropboxAccountId: string } | null;
};

/** Records one email's invoice (saved or to get) with its audit event, atomically. */
export async function insertVatPipelineInvoice(invoice: VatPipelineInvoice, actor: ActivityActor) {
  const db = await getTursoClient();
  const transaction = await db.transaction("write");
  const now = new Date().toISOString();
  try {
    const inserted = await transaction.execute({
      sql: `INSERT INTO vat_invoices (email_id, source, document_type, supplier_name, supplier_vat_number, invoice_number, invoice_date,
              due_date, currency, net_amount_minor, vat_amount_minor, gross_amount_minor, vat_breakdown_json, original_invoice_number,
              portal_url, field_confidence_json, status, notes_json, file_name, dropbox_path, dropbox_url, dropbox_account_id,
              created_at, updated_at, updated_by_id, updated_by_label)
            VALUES (?, 'email', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING id`,
      args: [
        invoice.emailId, invoice.documentType, invoice.supplierName, invoice.supplierVatNumber, invoice.invoiceNumber, invoice.invoiceDate,
        invoice.dueDate, invoice.currency, invoice.netMinor, invoice.vatMinor, invoice.grossMinor, invoice.vatBreakdownJson,
        invoice.originalInvoiceNumber, invoice.portalUrl, invoice.fieldConfidenceJson, invoice.status, JSON.stringify(invoice.notes),
        invoice.file?.fileName ?? null, invoice.file?.dropboxPath ?? null, invoice.file?.dropboxUrl ?? null, invoice.file?.dropboxAccountId ?? null,
        now, now, actor.id, actor.label,
      ],
    });
    const id = Number(inserted.rows[0].id);
    const summary = invoice.status === "saved" ? `Filed ${invoice.supplierName ?? "invoice"} from email` : `Added ${invoice.supplierName ?? "purchase"} to To get`;
    await transaction.execute({
      sql: `INSERT INTO vat_events (id, occurred_at, actor_id, actor_label, action, invoice_id, summary, details_json)
            VALUES (?, ?, ?, ?, 'invoice.created', ?, ?, ?)`,
      args: [randomUUID(), now, actor.id, actor.label, id, summary, JSON.stringify({ source: "get_invoices" })],
    });
    await transaction.commit();
    return id;
  } catch (error) {
    await transaction.rollback();
    throw error;
  } finally {
    transaction.close();
  }
}

// Duplicate pass ---------------------------------------------------------------------

export async function getVatDuplicateCandidates(fromDate: string) {
  const db = await getTursoClient();
  const rows = (await db.execute({
    sql: `SELECT id, status, supplier_name, invoice_date, gross_amount_minor, invoice_number, dropbox_path, dropbox_account_id, notes_json
          FROM vat_invoices WHERE status IN ('saved', 'to_get') AND (invoice_date IS NULL OR invoice_date >= ?)`,
    args: [fromDate],
  })).rows;
  return rows.map((row) => ({
    candidate: {
      id: Number(row.id),
      status: row.status === "saved" ? "saved" : "to_get",
      supplierName: text(row.supplier_name),
      invoiceDate: text(row.invoice_date),
      grossMinor: row.gross_amount_minor === null ? null : Number(row.gross_amount_minor),
      invoiceNumber: text(row.invoice_number),
      hasFile: Boolean(row.dropbox_path),
      notes: (() => { try { return JSON.parse(String(row.notes_json)) as string[]; } catch { return []; } })(),
    } satisfies VatDuplicateCandidate,
    dropboxPath: text(row.dropbox_path),
    dropboxAccountId: text(row.dropbox_account_id),
  }));
}

/** Retains a duplicate or fulfilled To get item as removed, never deletes it. */
export async function markVatInvoiceDuplicate(input: { id: number; keepId: number; reason: "invoice_received" | "duplicate"; movedPath: string | null; actor: ActivityActor }) {
  const db = await getTursoClient();
  const now = new Date().toISOString();
  const transaction = await db.transaction("write");
  try {
    const updated = await transaction.execute({
      sql: `UPDATE vat_invoices SET status = 'removed', removed_from_status = status, removed_reason = ?, removed_at = ?,
              removed_by_id = ?, removed_by_label = ?, updated_at = ?, dropbox_path = COALESCE(?, dropbox_path)
            WHERE id = ? AND status IN ('saved', 'to_get') RETURNING email_id`,
      args: [input.reason, now, input.actor.id, input.actor.label, now, input.movedPath, input.id],
    });
    const emailId = updated.rows[0]?.email_id;
    if (emailId && input.reason === "duplicate") {
      await transaction.execute({ sql: "UPDATE vat_emails SET status = 'ignored', category = 'duplicate' WHERE id = ?", args: [String(emailId)] });
    }
    await transaction.execute({
      sql: `INSERT INTO vat_events (id, occurred_at, actor_id, actor_label, action, invoice_id, summary, details_json)
            VALUES (?, ?, ?, ?, 'invoice.removed', ?, ?, ?)`,
      args: [randomUUID(), now, input.actor.id, input.actor.label, input.id,
        input.reason === "invoice_received" ? `Cleared from To get: invoice received (#${input.keepId})` : `Removed as a duplicate of #${input.keepId}`,
        JSON.stringify({ reason: input.reason, keepId: input.keepId })],
    });
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  } finally {
    transaction.close();
  }
}

export async function flagVatPossibleDuplicates(ids: number[]) {
  if (!ids.length) return;
  const db = await getTursoClient();
  await db.batch(ids.map((id) => ({
    sql: `UPDATE vat_invoices SET notes_json = json_insert(notes_json, '$[#]', 'duplicate')
          WHERE id = ? AND NOT EXISTS (SELECT 1 FROM json_each(vat_invoices.notes_json) WHERE value = 'duplicate')`,
    args: [id],
  })), "write");
}

export async function recordVatRunEvent(actor: ActivityActor, summary: string, details: Record<string, string | number | boolean | null>) {
  const db = await getTursoClient();
  const transaction = await db.transaction("write");
  const now = new Date().toISOString();
  try {
    await transaction.execute({
      sql: `INSERT INTO vat_events (id, occurred_at, actor_id, actor_label, action, invoice_id, summary, details_json)
            VALUES (?, ?, ?, ?, 'run.completed', NULL, ?, ?)`,
      args: [randomUUID(), now, actor.id, actor.label, summary, JSON.stringify(details)],
    });
    await insertActivityEvent(transaction, { actor, source: "manual", eventName: "vat.run.completed", entityType: "vat_run", summary, details, outcome: "succeeded", occurredAt: now });
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  } finally {
    transaction.close();
  }
  invalidateActivityLogCache();
  revalidatePath("/vat");
}
