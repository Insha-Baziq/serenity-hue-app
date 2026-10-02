import "server-only";

import { randomBytes, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getTursoClient } from "@/lib/turso";
import { getVatApiKeyStatuses } from "@/lib/vat-api-keys";
import { insertActivityEvent, invalidateActivityLogCache } from "@/lib/repository";
import { decryptVatToken, encryptVatToken, hashVatOAuthState, isVatDropboxConfigured, isVatOutlookConfigured, missingVatSettings, vatDropboxRedirectUri, vatOutlookRedirectUri } from "@/lib/vat-config";
import { matchSavedInvoice, monthRange, notesAfterReview, sameSupplier, VAT_PAGE_SIZE, vatMonthOptions, type NormalizedVatFields, type VatLogRow, type VatMatchCandidate } from "@/lib/vat-rules";
import type { ActivityActor } from "@/lib/types";
import type { VatConnectionState, VatEmailRow, VatEventRow, VatInvoiceDetail, VatInvoiceRow, VatInvoiceStatus, VatMailboxRow, VatVatLine, VatWorkspaceData, VatWorkspaceQuery } from "@/lib/vat-types";

// All VAT persistence. Records are business-wide: no query filters by staff
// member. Staff identity is written only to audit columns and vat_events.

type DatabaseClient = Awaited<ReturnType<typeof getTursoClient>>;
type Transaction = Awaited<ReturnType<DatabaseClient["transaction"]>>;
type Executor = Pick<DatabaseClient, "execute">;
type Row = Record<string, unknown>;

export class VatRecordError extends Error {
  constructor(readonly code: "not_found" | "stale" | "invalid_state", message: string) {
    super(message);
    this.name = "VatRecordError";
  }
}

const text = (value: unknown) => (value === null || value === undefined ? null : String(value));
const integer = (value: unknown) => (value === null || value === undefined ? null : Number(value));

function jsonArray<T>(value: unknown): T[] {
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function revalidateVat() {
  revalidatePath("/vat");
}

async function inTransaction<T>(work: (transaction: Transaction) => Promise<T>) {
  const db = await getTursoClient();
  const transaction = await db.transaction("write");
  try {
    const result = await work(transaction);
    await transaction.commit();
    return result;
  } catch (error) {
    await transaction.rollback();
    throw error;
  } finally {
    transaction.close();
  }
}

async function recordVatEvent(executor: Executor, input: { actor: ActivityActor; action: string; invoiceId?: number | null; summary: string; details?: Record<string, string | number | boolean | null> }) {
  const occurredAt = new Date().toISOString();
  await executor.execute({
    sql: `INSERT INTO vat_events (id, occurred_at, actor_id, actor_label, action, invoice_id, summary, details_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [randomUUID(), occurredAt, input.actor.id, input.actor.label, input.action, input.invoiceId ?? null, input.summary.slice(0, 500), JSON.stringify(input.details ?? {})],
  });
  await insertActivityEvent(executor, {
    actor: input.actor,
    source: "manual",
    eventName: `vat.${input.action}`,
    entityType: input.invoiceId ? "vat_invoice" : "vat_connection",
    entityId: input.invoiceId ? String(input.invoiceId) : null,
    summary: input.summary,
    details: input.details,
    outcome: "succeeded",
    occurredAt,
  });
}

/**
 * Only saved invoices flagged Possible duplicate or Check need a person to look;
 * everything else is approved automatically. Kept or edited invoices are reviewed.
 */
const NEEDS_REVIEW = `(i.status = 'saved' AND i.reviewed_at IS NULL
  AND EXISTS (SELECT 1 FROM json_each(i.notes_json) WHERE json_each.value IN ('duplicate', 'unsure')))`;

const INVOICE_COLUMNS = `${NEEDS_REVIEW} AS needs_review, i.id, i.email_id, i.source, i.document_type, i.supplier_name, i.supplier_vat_number,
  i.invoice_number, i.invoice_date, i.due_date, i.currency, i.net_amount_minor, i.vat_amount_minor,
  i.gross_amount_minor, i.status, i.notes_json, i.portal_url, i.file_name, i.dropbox_path, i.dropbox_url,
  i.dropbox_account_id, i.removed_reason, i.removed_at, i.removed_by_label, i.updated_at,
  e.subject AS email_subject, COALESCE(e.from_name, e.from_email) AS email_from, e.received_at AS email_received_at`;

// Lists show and filter by when the email arrived; uploads (no email) use their invoice date.
const RECEIVED_DATE = "COALESCE(substr(e.received_at, 1, 10), i.invoice_date)";

function toInvoiceRow(row: Row): VatInvoiceRow {
  const dropboxPath = text(row.dropbox_path);
  return {
    id: Number(row.id),
    emailId: text(row.email_id),
    source: row.source === "email" ? "email" : "manual",
    documentType: text(row.document_type),
    supplierName: text(row.supplier_name),
    supplierVatNumber: text(row.supplier_vat_number),
    invoiceNumber: text(row.invoice_number),
    invoiceDate: text(row.invoice_date),
    dueDate: text(row.due_date),
    currency: text(row.currency),
    netMinor: integer(row.net_amount_minor),
    vatMinor: integer(row.vat_amount_minor),
    grossMinor: integer(row.gross_amount_minor),
    status: row.status as VatInvoiceStatus,
    notes: jsonArray<string>(row.notes_json).filter((note) => typeof note === "string"),
    portalUrl: text(row.portal_url),
    fileName: text(row.file_name),
    dropboxUrl: text(row.dropbox_url),
    legacyFile: Boolean(dropboxPath) && !row.dropbox_account_id,
    hasFile: Boolean(dropboxPath),
    needsReview: Boolean(Number(row.needs_review ?? 0)),
    emailSubject: text(row.email_subject),
    emailFrom: text(row.email_from),
    receivedAt: text(row.email_received_at),
    removedReason: text(row.removed_reason),
    removedAt: text(row.removed_at),
    removedBy: text(row.removed_by_label),
    updatedAt: String(row.updated_at),
  };
}

function toEmailRow(row: Row): VatEmailRow {
  return {
    id: String(row.id),
    fromName: text(row.from_name),
    fromEmail: text(row.from_email),
    subject: text(row.subject),
    receivedAt: String(row.received_at),
    category: text(row.category),
    status: row.status === "error" ? "error" : "ignored",
    error: text(row.error),
    inbox: text(row.inbox),
    decidedBy: row.decided_by === "owner" ? "owner" : "jev",
  };
}

const EMAIL_LIST_FILTER = "(e.status = 'ignored' OR (e.status = 'error' AND e.attempts >= 3))";

/** One read round trip: tab counts, one page of the selected list, and setup state. */
export async function getVatWorkspace(query: VatWorkspaceQuery): Promise<VatWorkspaceData> {
  const db = await getTursoClient();
  const range = monthRange(query.month);
  const offset = (query.page - 1) * VAT_PAGE_SIZE;
  const savedFilter = range ? `AND ${RECEIVED_DATE} >= ? AND ${RECEIVED_DATE} < ?` : "";
  const rangeArgs = range ? [range.start, range.end] : [];
  const emailFilter = range ? "AND e.received_at >= ? AND e.received_at < ?" : "";

  const listStatement = query.tab === "ignored"
    ? {
        sql: `SELECT e.id, e.from_name, e.from_email, e.subject, e.received_at, e.category, e.status, e.error, e.decided_by,
                     a.account_email AS inbox
              FROM vat_emails e LEFT JOIN vat_mail_accounts a ON a.id = e.account_id
              WHERE ${EMAIL_LIST_FILTER} ${emailFilter}
              ORDER BY e.received_at DESC LIMIT ? OFFSET ?`,
        args: [...rangeArgs, VAT_PAGE_SIZE, offset],
      }
    : {
        sql: `SELECT ${INVOICE_COLUMNS}
              FROM vat_invoices i LEFT JOIN vat_emails e ON e.id = i.email_id
              WHERE i.status = ? ${query.tab === "saved" ? savedFilter : ""} ${query.review ? `AND ${NEEDS_REVIEW}` : ""}
              ORDER BY ${query.tab === "removed" ? "i.removed_at DESC" : `${RECEIVED_DATE} IS NULL, ${RECEIVED_DATE} DESC`}, i.id DESC
              LIMIT ? OFFSET ?`,
        args: [query.tab, ...(query.tab === "saved" ? rangeArgs : []), VAT_PAGE_SIZE, offset],
      };

  const [counts, ignored, list, earliest, syncStart] = await db.batch([
    {
      sql: `SELECT
              COALESCE(SUM(CASE WHEN i.status = 'saved' ${savedFilter} THEN 1 ELSE 0 END), 0) AS saved,
              COALESCE(SUM(CASE WHEN i.status = 'to_get' THEN 1 ELSE 0 END), 0) AS to_get,
              COALESCE(SUM(CASE WHEN i.status = 'removed' THEN 1 ELSE 0 END), 0) AS removed,
              COALESCE(SUM(CASE WHEN ${NEEDS_REVIEW} ${savedFilter} THEN 1 ELSE 0 END), 0) AS review
            FROM vat_invoices i LEFT JOIN vat_emails e ON e.id = i.email_id`,
      args: [...rangeArgs, ...rangeArgs],
    },
    { sql: `SELECT COUNT(*) AS count FROM vat_emails e WHERE ${EMAIL_LIST_FILTER} ${emailFilter}`, args: rangeArgs },
    listStatement,
    { sql: `SELECT MIN(${RECEIVED_DATE}) AS earliest FROM vat_invoices i LEFT JOIN vat_emails e ON e.id = i.email_id WHERE i.status = 'saved'`, args: [] },
    { sql: "SELECT value FROM vat_settings WHERE key = 'sync_start_date'", args: [] },
  ], "read");

  const countRow = counts.rows[0] ?? {};
  const tabCounts = {
    saved: Number(countRow.saved ?? 0),
    to_get: Number(countRow.to_get ?? 0),
    removed: Number(countRow.removed ?? 0),
    ignored: Number(ignored.rows[0]?.count ?? 0),
  };
  const reviewCount = Number(countRow.review ?? 0);
  const total = query.review ? reviewCount : tabCounts[query.tab];
  return {
    query,
    counts: tabCounts,
    reviewCount,
    invoices: query.tab === "ignored" ? [] : list.rows.map((row) => toInvoiceRow(row as Row)),
    emails: query.tab === "ignored" ? list.rows.map((row) => toEmailRow(row as Row)) : [],
    total,
    pageSize: VAT_PAGE_SIZE,
    pageCount: Math.ceil(total / VAT_PAGE_SIZE),
    months: vatMonthOptions(text(earliest.rows[0]?.earliest)),
    syncStartDate: text(syncStart.rows[0]?.value),
    connections: await getVatConnectionState(db),
  };
}

export async function getVatConnectionState(existing?: DatabaseClient): Promise<VatConnectionState> {
  const db = existing ?? await getTursoClient();
  const [dropbox, mailboxes] = await db.batch([
    { sql: "SELECT account_email, connected_by_label, connected_at, last_error FROM vat_connections WHERE provider = 'dropbox'", args: [] },
    {
      sql: `SELECT id, provider, account_email, refresh_token IS NOT NULL AS connected, connected_by_label, connected_at, last_error, last_synced_at
            FROM vat_mail_accounts ORDER BY disconnected_at IS NOT NULL, account_email`,
      args: [],
    },
  ], "read");
  const connection = dropbox.rows[0];
  return {
    dropbox: {
      configured: isVatDropboxConfigured(),
      connected: Boolean(connection),
      accountEmail: text(connection?.account_email),
      connectedBy: text(connection?.connected_by_label),
      connectedAt: text(connection?.connected_at),
      lastError: text(connection?.last_error),
    },
    outlook: { configured: isVatOutlookConfigured() },
    missingSettings: missingVatSettings(),
    redirectUris: { dropbox: vatDropboxRedirectUri(), outlook: vatOutlookRedirectUri() },
    apiKeys: await getVatApiKeyStatuses(),
    mailboxes: mailboxes.rows.map((row): VatMailboxRow => ({
      id: Number(row.id),
      provider: row.provider === "google" ? "google" : "microsoft",
      email: String(row.account_email),
      connected: Boolean(Number(row.connected)),
      connectedBy: text(row.connected_by_label),
      connectedAt: text(row.connected_at),
      lastError: text(row.last_error),
      lastSyncedAt: text(row.last_synced_at),
    })),
  };
}

export async function getVatInvoiceDetail(id: number): Promise<VatInvoiceDetail | null> {
  const db = await getTursoClient();
  const [invoice, events] = await db.batch([
    {
      sql: `SELECT ${INVOICE_COLUMNS}, i.vat_breakdown_json, i.original_invoice_number, i.updated_by_label, i.created_at,
                   a.account_email AS inbox
            FROM vat_invoices i
            LEFT JOIN vat_emails e ON e.id = i.email_id
            LEFT JOIN vat_mail_accounts a ON a.id = e.account_id
            WHERE i.id = ?`,
      args: [id],
    },
    { sql: "SELECT id, occurred_at, actor_label, action, summary FROM vat_events WHERE invoice_id = ? ORDER BY occurred_at DESC LIMIT 50", args: [id] },
  ], "read");
  const row = invoice.rows[0] as Row | undefined;
  if (!row) return null;
  const current = toInvoiceRow(row);

  // Similar saved invoices: same supplier within 14 days (by invoice or email date), read from a bounded window.
  const anchor = current.invoiceDate ?? current.receivedAt?.slice(0, 10) ?? null;
  let similar: VatInvoiceRow[] = [];
  if (anchor && current.supplierName) {
    const shift = (days: number) => new Date(Date.parse(`${anchor}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
    const nearby = await db.execute({
      sql: `SELECT ${INVOICE_COLUMNS} FROM vat_invoices i LEFT JOIN vat_emails e ON e.id = i.email_id
            WHERE i.status = 'saved' AND i.id <> ?
              AND (i.invoice_date BETWEEN ? AND ? OR substr(e.received_at, 1, 10) BETWEEN ? AND ?)
            ORDER BY i.invoice_date DESC LIMIT 200`,
      args: [id, shift(-14), shift(14), shift(-14), shift(14)],
    });
    similar = nearby.rows.map((item) => toInvoiceRow(item as Row)).filter((item) => sameSupplier(item.supplierName, current.supplierName)).slice(0, 10);
  }

  return {
    ...current,
    similar,
    vatBreakdown: jsonArray<VatVatLine>(row.vat_breakdown_json),
    originalInvoiceNumber: text(row.original_invoice_number),
    inbox: text(row.inbox),
    updatedBy: text(row.updated_by_label),
    createdAt: String(row.created_at),
    events: events.rows.map((event): VatEventRow => ({
      id: String(event.id),
      occurredAt: String(event.occurred_at),
      actor: String(event.actor_label),
      action: String(event.action),
      summary: String(event.summary),
    })),
  };
}

/** The fields filing needs to decide whether and where a file moves. */
export type VatInvoiceFilingState = {
  id: number;
  status: VatInvoiceStatus;
  removedFromStatus: "saved" | "to_get" | null;
  updatedAt: string;
  invoiceDate: string | null;
  supplierName: string | null;
  invoiceNumber: string | null;
  grossMinor: number | null;
  currency: string | null;
  dropboxPath: string | null;
  dropboxAccountId: string | null;
  emailId: string | null;
};

export async function getVatInvoiceFilingState(id: number, executor?: Executor): Promise<VatInvoiceFilingState | null> {
  const db = executor ?? await getTursoClient();
  const result = await db.execute({
    sql: `SELECT id, status, removed_from_status, updated_at, invoice_date, supplier_name, invoice_number, gross_amount_minor,
                 currency, dropbox_path, dropbox_account_id, email_id
          FROM vat_invoices WHERE id = ?`,
    args: [id],
  });
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    status: row.status as VatInvoiceStatus,
    removedFromStatus: row.removed_from_status === "saved" || row.removed_from_status === "to_get" ? row.removed_from_status : null,
    updatedAt: String(row.updated_at),
    invoiceDate: text(row.invoice_date),
    supplierName: text(row.supplier_name),
    invoiceNumber: text(row.invoice_number),
    grossMinor: integer(row.gross_amount_minor),
    currency: text(row.currency),
    dropboxPath: text(row.dropbox_path),
    dropboxAccountId: text(row.dropbox_account_id),
    emailId: text(row.email_id),
  };
}

async function lockedState(transaction: Transaction, id: number, expectedUpdatedAt: string) {
  const state = await getVatInvoiceFilingState(id, transaction);
  if (!state) throw new VatRecordError("not_found", "That invoice is no longer available.");
  if (state.updatedAt !== expectedUpdatedAt) {
    throw new VatRecordError("stale", "This invoice changed since you opened it. Reload before saving.");
  }
  return state;
}

function nextUpdatedAt(previous: string) {
  const prior = Date.parse(previous);
  return new Date(Math.max(Date.now(), Number.isNaN(prior) ? 0 : prior + 1)).toISOString();
}

export type VatFileLocation = { dropboxPath: string; fileName: string; dropboxUrl: string | null; dropboxAccountId: string };

/**
 * Saves reviewed details. Unchanged details write nothing. A moved file's new
 * location is written in the same transaction as the details it reflects.
 */
export async function updateVatInvoiceDetails(input: {
  id: number;
  fields: NormalizedVatFields;
  expectedUpdatedAt: string;
  actor: ActivityActor;
  file?: VatFileLocation;
}) {
  const result = await inTransaction(async (transaction) => {
    const state = await lockedState(transaction, input.id, input.expectedUpdatedAt);
    if (state.status === "removed") throw new VatRecordError("invalid_state", "Restore this invoice before editing it.");
    const current = (await transaction.execute({
      sql: `SELECT document_type, supplier_name, supplier_vat_number, invoice_number, invoice_date, due_date, currency,
                   net_amount_minor, vat_amount_minor, gross_amount_minor, notes_json FROM vat_invoices WHERE id = ?`,
      args: [input.id],
    })).rows[0] as Row;
    const fields = input.fields;
    const notes = notesAfterReview(jsonArray<string>(current.notes_json), state.status, {
      documentType: fields.documentType,
      netMinor: fields.netMinor,
      vatMinor: fields.vatMinor,
      grossMinor: fields.grossMinor,
    });
    const next: Record<string, string | number | null> = {
      document_type: fields.documentType,
      supplier_name: fields.supplierName,
      supplier_vat_number: fields.supplierVatNumber,
      invoice_number: fields.invoiceNumber,
      invoice_date: fields.invoiceDate,
      due_date: fields.dueDate,
      currency: fields.currency,
      net_amount_minor: fields.netMinor,
      vat_amount_minor: fields.vatMinor,
      gross_amount_minor: fields.grossMinor,
      notes_json: JSON.stringify(notes),
    };
    const changedKeys = Object.keys(next).filter((key) => {
      const before = current[key];
      return (before === null || before === undefined ? null : typeof next[key] === "number" ? Number(before) : String(before)) !== next[key];
    });
    if (!changedKeys.length && !input.file) return { changed: false, updatedAt: state.updatedAt, years: [] as string[] };

    const updatedAt = nextUpdatedAt(state.updatedAt);
    const assignments = Object.keys(next).map((key) => `${key} = ?`);
    const args: Array<string | number | null> = Object.values(next);
    if (input.file) {
      assignments.push("dropbox_path = ?", "file_name = ?", "dropbox_url = ?", "dropbox_account_id = ?");
      args.push(input.file.dropboxPath, input.file.fileName, input.file.dropboxUrl, input.file.dropboxAccountId);
    }
    // Staff checked these details, so the invoice no longer needs review.
    assignments.push("updated_at = ?", "updated_by_id = ?", "updated_by_label = ?", "reviewed_at = ?", "reviewed_by_id = ?", "reviewed_by_label = ?");
    args.push(updatedAt, input.actor.id, input.actor.label, updatedAt, input.actor.id, input.actor.label, input.id);
    await transaction.execute({ sql: `UPDATE vat_invoices SET ${assignments.join(", ")} WHERE id = ?`, args });
    await recordVatEvent(transaction, {
      actor: input.actor,
      action: "invoice.updated",
      invoiceId: input.id,
      summary: `Updated ${fields.supplierName} invoice details`,
      details: { fields: changedKeys.join(", ") || "file", fileMoved: Boolean(input.file) },
    });
    return { changed: true, updatedAt, years: [state.invoiceDate, fields.invoiceDate].filter(Boolean).map((date) => date!.slice(0, 4)) };
  });
  if (result.changed) {
    invalidateActivityLogCache();
    revalidateVat();
  }
  return result;
}

/** Staff keep a flagged invoice: it is approved and joins the accountant's log. */
export async function approveVatInvoice(input: { id: number; expectedUpdatedAt: string; actor: ActivityActor }) {
  const result = await inTransaction(async (transaction) => {
    const state = await lockedState(transaction, input.id, input.expectedUpdatedAt);
    if (state.status !== "saved") throw new VatRecordError("invalid_state", "Only saved invoices are reviewed.");
    const updatedAt = nextUpdatedAt(state.updatedAt);
    await transaction.execute({
      sql: `UPDATE vat_invoices SET reviewed_at = ?, reviewed_by_id = ?, reviewed_by_label = ?, updated_at = ? WHERE id = ?`,
      args: [updatedAt, input.actor.id, input.actor.label, updatedAt, input.id],
    });
    if (state.emailId) {
      // A staff decision about this sender; Jev uses these for future emails.
      await transaction.execute({
        sql: "UPDATE vat_emails SET decided_by = 'owner', decided_by_id = ?, decided_by_label = ? WHERE id = ?",
        args: [input.actor.id, input.actor.label, state.emailId],
      });
    }
    await recordVatEvent(transaction, {
      actor: input.actor,
      action: "invoice.approved",
      invoiceId: input.id,
      summary: `Reviewed and kept ${state.supplierName ?? "invoice"}`,
    });
    return { years: state.invoiceDate ? [state.invoiceDate.slice(0, 4)] : [] };
  });
  invalidateActivityLogCache();
  revalidateVat();
  return result;
}

/** Removal hides a record from working lists but always retains it. */
export async function removeVatInvoice(input: {
  id: number;
  reason: string;
  expectedUpdatedAt: string;
  actor: ActivityActor;
  file?: VatFileLocation;
}) {
  const result = await inTransaction(async (transaction) => {
    const state = await lockedState(transaction, input.id, input.expectedUpdatedAt);
    if (state.status === "removed") throw new VatRecordError("invalid_state", "This invoice is already removed.");
    const now = new Date().toISOString();
    const updatedAt = nextUpdatedAt(state.updatedAt);
    await transaction.execute({
      sql: `UPDATE vat_invoices SET status = 'removed', removed_from_status = ?, removed_reason = ?, removed_at = ?,
              removed_by_id = ?, removed_by_label = ?, updated_at = ?, updated_by_id = ?, updated_by_label = ?
              ${input.file ? ", dropbox_path = ?, file_name = ?, dropbox_url = ?" : ""}
            WHERE id = ?`,
      args: [
        state.status, input.reason, now, input.actor.id, input.actor.label, updatedAt, input.actor.id, input.actor.label,
        ...(input.file ? [input.file.dropboxPath, input.file.fileName, input.file.dropboxUrl] : []),
        input.id,
      ],
    });
    if (state.emailId) {
      // A staff decision about this sender, kept for when inbox sync returns.
      await transaction.execute({
        sql: `UPDATE vat_emails SET status = 'ignored', decided_by = 'owner', decided_by_id = ?, decided_by_label = ?
              ${input.reason === "duplicate" ? ", category = 'duplicate'" : ""} WHERE id = ?`,
        args: [input.actor.id, input.actor.label, state.emailId],
      });
    }
    await recordVatEvent(transaction, {
      actor: input.actor,
      action: "invoice.removed",
      invoiceId: input.id,
      summary: `Removed ${state.supplierName ?? "invoice"} from ${state.status === "saved" ? "Saved" : "To get"}`,
      details: { reason: input.reason, fileMoved: Boolean(input.file) },
    });
    return { years: state.invoiceDate ? [state.invoiceDate.slice(0, 4)] : [] };
  });
  invalidateActivityLogCache();
  revalidateVat();
  return result;
}

export async function restoreVatInvoice(input: { id: number; expectedUpdatedAt: string; actor: ActivityActor; file?: VatFileLocation }) {
  const result = await inTransaction(async (transaction) => {
    const state = await lockedState(transaction, input.id, input.expectedUpdatedAt);
    if (state.status !== "removed" || !state.removedFromStatus) throw new VatRecordError("invalid_state", "Only removed invoices can be restored.");
    const updatedAt = nextUpdatedAt(state.updatedAt);
    await transaction.execute({
      sql: `UPDATE vat_invoices SET status = ?, removed_from_status = NULL, removed_reason = NULL, removed_at = NULL,
              removed_by_id = NULL, removed_by_label = NULL, updated_at = ?, updated_by_id = ?, updated_by_label = ?
              ${input.file ? ", dropbox_path = ?, file_name = ?, dropbox_url = ?" : ""}
            WHERE id = ?`,
      args: [
        state.removedFromStatus, updatedAt, input.actor.id, input.actor.label,
        ...(input.file ? [input.file.dropboxPath, input.file.fileName, input.file.dropboxUrl] : []),
        input.id,
      ],
    });
    if (state.emailId) {
      await transaction.execute({
        sql: "UPDATE vat_emails SET status = 'invoice', decided_by = 'owner', decided_by_id = ?, decided_by_label = ? WHERE id = ?",
        args: [input.actor.id, input.actor.label, state.emailId],
      });
    }
    await recordVatEvent(transaction, {
      actor: input.actor,
      action: "invoice.restored",
      invoiceId: input.id,
      summary: `Restored ${state.supplierName ?? "invoice"} to ${state.removedFromStatus === "saved" ? "Saved" : "To get"}`,
      details: { fileMoved: Boolean(input.file) },
    });
    return { years: state.invoiceDate ? [state.invoiceDate.slice(0, 4)] : [] };
  });
  invalidateActivityLogCache();
  revalidateVat();
  return result;
}

// Uploads ---------------------------------------------------------------------

export type VatUpload = {
  id: string;
  invoiceId: number | null;
  stagingPath: string;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  dropboxAccountId: string;
  status: "pending" | "completed";
};

export async function createVatUpload(input: Omit<VatUpload, "status"> & { actor: ActivityActor }) {
  const db = await getTursoClient();
  await db.execute({
    sql: `INSERT INTO vat_uploads (id, invoice_id, staging_path, original_name, content_type, size_bytes, dropbox_account_id,
            status, created_by_id, created_by_label, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    args: [input.id, input.invoiceId, input.stagingPath, input.originalName, input.contentType, input.sizeBytes, input.dropboxAccountId, input.actor.id, input.actor.label, new Date().toISOString()],
  });
}

export async function getVatUpload(id: string): Promise<VatUpload | null> {
  const db = await getTursoClient();
  const row = (await db.execute({
    sql: "SELECT id, invoice_id, staging_path, original_name, content_type, size_bytes, dropbox_account_id, status FROM vat_uploads WHERE id = ?",
    args: [id],
  })).rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    invoiceId: integer(row.invoice_id),
    stagingPath: String(row.staging_path),
    originalName: String(row.original_name),
    contentType: String(row.content_type),
    sizeBytes: Number(row.size_bytes),
    dropboxAccountId: String(row.dropbox_account_id),
    status: row.status === "completed" ? "completed" : "pending",
  };
}

/**
 * Files an uploaded document as a saved invoice: a new manual record, or the
 * fetched invoice for a To get item (or a replacement document). Matching To
 * get items are retained as removed ("invoice received"); possible duplicates
 * are flagged on both records.
 */
export async function completeVatUpload(input: {
  uploadId: string;
  fields: NormalizedVatFields & { invoiceDate: string };
  extraNotes?: string[];
  file: VatFileLocation;
  actor: ActivityActor;
}) {
  const result = await inTransaction(async (transaction) => {
    const upload = (await transaction.execute({ sql: "SELECT invoice_id, status FROM vat_uploads WHERE id = ?", args: [input.uploadId] })).rows[0];
    if (!upload) throw new VatRecordError("not_found", "That upload is no longer available.");
    if (upload.status !== "pending") throw new VatRecordError("invalid_state", "This upload has already been filed.");
    const targetId = integer(upload.invoice_id);
    const now = new Date().toISOString();
    const fields = input.fields;
    const figures = { documentType: fields.documentType, netMinor: fields.netMinor, vatMinor: fields.vatMinor, grossMinor: fields.grossMinor };
    let previousFile: { path: string; accountId: string | null } | null = null;
    let invoiceId: number;
    const years = new Set([fields.invoiceDate.slice(0, 4)]);

    const values = [
      fields.documentType, fields.supplierName, fields.supplierVatNumber, fields.invoiceNumber, fields.invoiceDate, fields.dueDate,
      fields.currency, fields.netMinor, fields.vatMinor, fields.grossMinor,
    ];
    if (targetId) {
      const state = await getVatInvoiceFilingState(targetId, transaction);
      if (!state || state.status === "removed") throw new VatRecordError("invalid_state", "That invoice is no longer open for upload.");
      const previousNotes = jsonArray<string>((await transaction.execute({ sql: "SELECT notes_json FROM vat_invoices WHERE id = ?", args: [targetId] })).rows[0]?.notes_json);
      if (state.dropboxPath) previousFile = { path: state.dropboxPath, accountId: state.dropboxAccountId };
      if (state.invoiceDate) years.add(state.invoiceDate.slice(0, 4));
      await transaction.execute({
        sql: `UPDATE vat_invoices SET document_type = ?, supplier_name = ?, supplier_vat_number = ?, invoice_number = ?, invoice_date = ?,
                due_date = ?, currency = ?, net_amount_minor = ?, vat_amount_minor = ?, gross_amount_minor = ?, status = 'saved',
                notes_json = ?, dropbox_path = ?, file_name = ?, dropbox_url = ?, dropbox_account_id = ?, updated_at = ?,
                updated_by_id = ?, updated_by_label = ?
              WHERE id = ?`,
        args: [...values, JSON.stringify([...new Set([...notesAfterReview(previousNotes, "saved", figures), ...(input.extraNotes ?? [])])]), input.file.dropboxPath, input.file.fileName,
          input.file.dropboxUrl, input.file.dropboxAccountId, nextUpdatedAt(state.updatedAt), input.actor.id, input.actor.label, targetId],
      });
      invoiceId = targetId;
    } else {
      const inserted = await transaction.execute({
        sql: `INSERT INTO vat_invoices (source, document_type, supplier_name, supplier_vat_number, invoice_number, invoice_date, due_date,
                currency, net_amount_minor, vat_amount_minor, gross_amount_minor, status, notes_json, dropbox_path, file_name, dropbox_url,
                dropbox_account_id, created_at, updated_at, updated_by_id, updated_by_label)
              VALUES ('manual', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'saved', ?, ?, ?, ?, ?, ?, ?, ?, ?)
              RETURNING id`,
        args: [...values, JSON.stringify([...new Set([...notesAfterReview([], "saved", figures), ...(input.extraNotes ?? [])])]), input.file.dropboxPath, input.file.fileName,
          input.file.dropboxUrl, input.file.dropboxAccountId, now, now, input.actor.id, input.actor.label],
      });
      invoiceId = Number(inserted.rows[0].id);
    }

    // Only invoices within a week of this one can match, so read just that window.
    const from = new Date(Date.parse(`${fields.invoiceDate}T00:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10);
    const to = new Date(Date.parse(`${fields.invoiceDate}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
    const candidates = (await transaction.execute({
      sql: `SELECT id, status, supplier_name, invoice_date, gross_amount_minor, invoice_number, notes_json, updated_at
            FROM vat_invoices
            WHERE status IN ('saved', 'to_get') AND invoice_date >= ? AND invoice_date <= ? AND id <> ?`,
      args: [from, to, invoiceId],
    })).rows as Row[];
    const matches = matchSavedInvoice(
      { id: invoiceId, status: "saved", supplierName: fields.supplierName, invoiceDate: fields.invoiceDate, grossMinor: fields.grossMinor, invoiceNumber: fields.invoiceNumber },
      candidates.map((row): VatMatchCandidate => ({
        id: Number(row.id),
        status: row.status as VatMatchCandidate["status"],
        supplierName: text(row.supplier_name),
        invoiceDate: text(row.invoice_date),
        grossMinor: integer(row.gross_amount_minor),
        invoiceNumber: text(row.invoice_number),
      })),
    );
    for (const coveredId of matches.covered) {
      await transaction.execute({
        sql: `UPDATE vat_invoices SET status = 'removed', removed_from_status = 'to_get', removed_reason = 'invoice_received',
                removed_at = ?, removed_by_id = ?, removed_by_label = ?, updated_at = ?, updated_by_id = ?, updated_by_label = ?
              WHERE id = ? AND status = 'to_get'`,
        args: [now, input.actor.id, input.actor.label, now, input.actor.id, input.actor.label, coveredId],
      });
      await recordVatEvent(transaction, {
        actor: input.actor, action: "invoice.removed", invoiceId: coveredId,
        summary: `Cleared from To get: invoice received (#${invoiceId})`, details: { reason: "invoice_received", invoiceId },
      });
    }
    const flagged = matches.duplicates.length ? [invoiceId, ...matches.duplicates] : [];
    for (const flaggedId of flagged) {
      const notes = flaggedId === invoiceId
        ? jsonArray<string>((await transaction.execute({ sql: "SELECT notes_json FROM vat_invoices WHERE id = ?", args: [invoiceId] })).rows[0]?.notes_json)
        : jsonArray<string>(candidates.find((row) => Number(row.id) === flaggedId)?.notes_json);
      if (notes.includes("duplicate")) continue;
      await transaction.execute({ sql: "UPDATE vat_invoices SET notes_json = ? WHERE id = ?", args: [JSON.stringify([...notes, "duplicate"]), flaggedId] });
    }

    await transaction.execute({
      sql: "UPDATE vat_uploads SET status = 'completed', completed_at = ?, result_invoice_id = ? WHERE id = ?",
      args: [now, invoiceId, input.uploadId],
    });
    await recordVatEvent(transaction, {
      actor: input.actor,
      action: targetId ? "invoice.document_uploaded" : "invoice.created",
      invoiceId,
      summary: targetId ? `Uploaded the document for ${fields.supplierName}` : `Added ${fields.supplierName} invoice by upload`,
      // The replaced document's location stays in history even when it can't be moved (earlier app's files).
      details: { possibleDuplicates: matches.duplicates.length, clearedToGet: matches.covered.length, replacedDocument: previousFile?.path ?? null },
    });
    return { invoiceId, previousFile, years: [...years], clearedToGet: matches.covered.length, possibleDuplicates: matches.duplicates.length };
  });
  invalidateActivityLogCache();
  revalidateVat();
  return result;
}

/** Points a record at the retained copy of a replaced document. */
export async function recordVatRetainedFile(invoiceId: number, retainedPath: string, actor: ActivityActor) {
  const db = await getTursoClient();
  await recordVatEvent(db, {
    actor,
    action: "invoice.document_replaced",
    invoiceId,
    summary: "Kept the replaced document in the removed files folder",
    details: { retainedPath },
  });
}

// Accountant's log ---------------------------------------------------------------

export async function getVatLogRows(year: string): Promise<VatLogRow[]> {
  const db = await getTursoClient();
  const currentYear = String(new Date().getUTCFullYear());
  const result = await db.execute({
    sql: `SELECT invoice_date, supplier_name, invoice_number, currency, net_amount_minor, vat_amount_minor, gross_amount_minor,
                 status, notes_json, portal_url, dropbox_url
          FROM vat_invoices
          WHERE status IN ('saved', 'to_get') AND ((invoice_date >= ? AND invoice_date < ?) OR (invoice_date IS NULL AND ? = ?))
            -- Only approved invoices reach the accountant: flagged ones wait for review.
            AND NOT (status = 'saved' AND reviewed_at IS NULL
              AND EXISTS (SELECT 1 FROM json_each(notes_json) WHERE json_each.value IN ('duplicate', 'unsure')))
          ORDER BY invoice_date, id`,
    args: [`${year}-01-01`, `${Number(year) + 1}-01-01`, year, currentYear],
  });
  return result.rows.map((row) => ({
    invoiceDate: text(row.invoice_date),
    supplierName: text(row.supplier_name),
    invoiceNumber: text(row.invoice_number),
    currency: text(row.currency),
    netMinor: integer(row.net_amount_minor),
    vatMinor: integer(row.vat_amount_minor),
    grossMinor: integer(row.gross_amount_minor),
    status: row.status === "saved" ? "saved" : "to_get",
    notes: jsonArray<string>(row.notes_json),
    portalUrl: text(row.portal_url),
    dropboxUrl: text(row.dropbox_url),
  }));
}

// Connections --------------------------------------------------------------------

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export async function createVatOAuthState(provider: "dropbox" | "microsoft", userId: string) {
  const db = await getTursoClient();
  const state = randomBytes(24).toString("base64url");
  const now = new Date();
  await db.batch([
    { sql: "DELETE FROM vat_oauth_states WHERE expires_at < ?", args: [now.toISOString()] },
    {
      sql: "INSERT INTO vat_oauth_states (state_hash, provider, user_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
      args: [hashVatOAuthState(state), provider, userId, new Date(now.getTime() + OAUTH_STATE_TTL_MS).toISOString(), now.toISOString()],
    },
  ], "write");
  return { state, maxAgeSeconds: OAUTH_STATE_TTL_MS / 1000 };
}

/** One-use state, valid only for the staff member who started the flow. */
export async function consumeVatOAuthState(provider: "dropbox" | "microsoft", state: string, userId: string) {
  const db = await getTursoClient();
  const result = await db.execute({
    sql: "DELETE FROM vat_oauth_states WHERE state_hash = ? AND provider = ? AND user_id = ? AND expires_at >= ? RETURNING state_hash",
    args: [hashVatOAuthState(state), provider, userId, new Date().toISOString()],
  });
  return result.rows.length === 1;
}

export async function saveVatDropboxConnection(input: { accountId: string; email: string | null; refreshToken: string; accessToken: string; expiresIn: number; actor: ActivityActor }) {
  const now = new Date();
  await inTransaction(async (transaction) => {
    await transaction.execute({
      sql: `INSERT INTO vat_connections (provider, account_id, account_email, refresh_token, access_token, expires_at, last_error,
              connected_by_id, connected_by_label, connected_at, updated_at)
            VALUES ('dropbox', ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
            ON CONFLICT(provider) DO UPDATE SET account_id = excluded.account_id, account_email = excluded.account_email,
              refresh_token = excluded.refresh_token, access_token = excluded.access_token, expires_at = excluded.expires_at,
              last_error = NULL, connected_by_id = excluded.connected_by_id, connected_by_label = excluded.connected_by_label,
              connected_at = excluded.connected_at, updated_at = excluded.updated_at`,
      args: [input.accountId, input.email, encryptVatToken(input.refreshToken), encryptVatToken(input.accessToken),
        new Date(now.getTime() + input.expiresIn * 1000).toISOString(), input.actor.id, input.actor.label, now.toISOString(), now.toISOString()],
    });
    await recordVatEvent(transaction, { actor: input.actor, action: "dropbox.connected", summary: `Connected Dropbox${input.email ? ` (${input.email})` : ""} for VAT filing` });
  });
  invalidateActivityLogCache();
  revalidateVat();
}

export async function disconnectVatDropbox(actor: ActivityActor) {
  const removed = await inTransaction(async (transaction) => {
    const result = await transaction.execute("DELETE FROM vat_connections WHERE provider = 'dropbox' RETURNING account_email");
    if (!result.rows.length) return false;
    await recordVatEvent(transaction, { actor, action: "dropbox.disconnected", summary: "Disconnected the VAT Dropbox account" });
    return true;
  });
  if (removed) {
    invalidateActivityLogCache();
    revalidateVat();
  }
  return removed;
}

/** Decrypted Dropbox credentials for server-side calls only. */
export async function getVatDropboxSecrets() {
  const db = await getTursoClient();
  const row = (await db.execute("SELECT account_id, refresh_token, access_token, expires_at FROM vat_connections WHERE provider = 'dropbox'")).rows[0];
  if (!row) return null;
  return {
    accountId: String(row.account_id),
    refreshToken: decryptVatToken(String(row.refresh_token)),
    accessToken: row.access_token ? decryptVatToken(String(row.access_token)) : null,
    expiresAt: text(row.expires_at),
  };
}

export async function updateVatDropboxAccessToken(accountId: string, accessToken: string, expiresIn: number) {
  const db = await getTursoClient();
  const now = Date.now();
  await db.execute({
    sql: "UPDATE vat_connections SET access_token = ?, expires_at = ?, last_error = NULL, updated_at = ? WHERE provider = 'dropbox' AND account_id = ?",
    args: [encryptVatToken(accessToken), new Date(now + expiresIn * 1000).toISOString(), new Date(now).toISOString(), accountId],
  });
}

export async function markVatDropboxError(accountId: string, message: string) {
  const db = await getTursoClient();
  await db.execute({
    sql: "UPDATE vat_connections SET last_error = ?, updated_at = ? WHERE provider = 'dropbox' AND account_id = ? AND COALESCE(last_error, '') <> ?",
    args: [message.slice(0, 300), new Date().toISOString(), accountId, message.slice(0, 300)],
  });
}

/** Stores an inbox authorization. Connecting never reads or processes mail. */
export async function saveVatMailbox(input: { email: string; refreshToken: string; accessToken: string; expiresIn: number; actor: ActivityActor }) {
  const now = new Date();
  await inTransaction(async (transaction) => {
    await transaction.execute({
      sql: `INSERT INTO vat_mail_accounts (provider, account_email, refresh_token, access_token, expires_at, last_error,
              connected_by_id, connected_by_label, connected_at, disconnected_at, created_at, updated_at)
            VALUES ('microsoft', ?, ?, ?, ?, NULL, ?, ?, ?, NULL, ?, ?)
            ON CONFLICT(provider, account_email) DO UPDATE SET refresh_token = excluded.refresh_token,
              access_token = excluded.access_token, expires_at = excluded.expires_at, last_error = NULL,
              connected_by_id = excluded.connected_by_id, connected_by_label = excluded.connected_by_label,
              connected_at = excluded.connected_at, disconnected_at = NULL, updated_at = excluded.updated_at`,
      args: [input.email, encryptVatToken(input.refreshToken), encryptVatToken(input.accessToken),
        new Date(now.getTime() + input.expiresIn * 1000).toISOString(), input.actor.id, input.actor.label, now.toISOString(), now.toISOString(), now.toISOString()],
    });
    await recordVatEvent(transaction, { actor: input.actor, action: "mailbox.connected", summary: `Connected inbox ${input.email} (sync is not enabled yet)` });
  });
  invalidateActivityLogCache();
  revalidateVat();
}

/** Decrypted inbox credentials for server-side mail reads only. */
export async function getVatMailboxSecrets(id: number) {
  const db = await getTursoClient();
  const row = (await db.execute({
    sql: "SELECT account_email, refresh_token, access_token, expires_at FROM vat_mail_accounts WHERE id = ? AND refresh_token IS NOT NULL",
    args: [id],
  })).rows[0];
  if (!row) return null;
  return {
    email: String(row.account_email),
    refreshToken: decryptVatToken(String(row.refresh_token)),
    accessToken: row.access_token ? decryptVatToken(String(row.access_token)) : null,
    expiresAt: text(row.expires_at),
  };
}

export async function updateVatMailboxTokens(id: number, tokens: { accessToken: string; refreshToken: string; expiresIn: number }) {
  const db = await getTursoClient();
  const now = Date.now();
  await db.execute({
    sql: "UPDATE vat_mail_accounts SET access_token = ?, refresh_token = ?, expires_at = ?, last_error = NULL, updated_at = ? WHERE id = ?",
    args: [encryptVatToken(tokens.accessToken), encryptVatToken(tokens.refreshToken), new Date(now + tokens.expiresIn * 1000).toISOString(), new Date(now).toISOString(), id],
  });
}

export async function markVatMailboxError(id: number, message: string | null) {
  const db = await getTursoClient();
  const now = new Date().toISOString();
  await db.execute({
    sql: `UPDATE vat_mail_accounts SET last_error = ?, last_synced_at = CASE WHEN ? IS NULL THEN ? ELSE last_synced_at END, updated_at = ?
          WHERE id = ?`,
    args: [message?.slice(0, 300) ?? null, message, now, now, id],
  });
}

/** Forgets an inbox's authorization; its emails and invoices stay. */
export async function disconnectVatMailbox(id: number, actor: ActivityActor) {
  const result = await inTransaction(async (transaction) => {
    const row = (await transaction.execute({
      sql: `UPDATE vat_mail_accounts SET refresh_token = NULL, access_token = NULL, expires_at = NULL, disconnected_at = ?, updated_at = ?
            WHERE id = ? AND refresh_token IS NOT NULL RETURNING account_email`,
      args: [new Date().toISOString(), new Date().toISOString(), id],
    })).rows[0];
    if (!row) return false;
    await recordVatEvent(transaction, { actor, action: "mailbox.disconnected", summary: `Disconnected inbox ${String(row.account_email)}` });
    return true;
  });
  if (result) {
    invalidateActivityLogCache();
    revalidateVat();
  }
  return result;
}
