import "server-only";

import { randomUUID } from "node:crypto";
import { isVatDropboxConfigured } from "@/lib/vat-config";
import {
  createVatTemporaryUploadLink,
  getVatDropboxFile,
  moveVatDropboxFile,
  refreshVatDropboxToken,
  VatDropboxError,
  vatDropboxSharedLink,
  writeVatDropboxFile,
} from "@/lib/vat-dropbox";
import {
  completeVatUpload,
  createVatUpload,
  getVatDropboxSecrets,
  getVatInvoiceFilingState,
  getVatLogRows,
  getVatUpload,
  markVatDropboxError,
  recordVatRetainedFile,
  removeVatInvoice,
  restoreVatInvoice,
  updateVatDropboxAccessToken,
  updateVatInvoiceDetails,
  VatRecordError,
  type VatFileLocation,
  type VatInvoiceFilingState,
} from "@/lib/vat-repository";
import {
  buildVatInvoiceLogCsv,
  normalizeVatInvoiceFields,
  VAT_DROPBOX_ROOT,
  VAT_REMOVED_FOLDER,
  VAT_REMOVED_REASON_LABELS,
  VAT_UPLOAD_MAX_BYTES,
  VAT_UPLOAD_STAGING_FOLDER,
  VAT_UPLOAD_TYPES,
  vatFileExtension,
  vatFolderFor,
  vatInvoiceFileName,
  VatInputError,
  withEstimatedVat,
} from "@/lib/vat-rules";
import type { ActivityActor } from "@/lib/types";
import type { VatInvoiceFieldsInput } from "@/lib/vat-types";

// Coordinates Dropbox filing with VAT records. A file move happens first and
// its new location is committed with the record; if the record cannot be
// saved, the move is reversed. Nothing reports success unless both happened.

export class VatSetupRequiredError extends Error {
  constructor(readonly code: "dropbox_not_configured" | "dropbox_not_connected", message: string) {
    super(message);
    this.name = "VatSetupRequiredError";
  }
}

type DropboxAccess = { token: string; accountId: string };

export async function getVatDropboxAccess(): Promise<DropboxAccess> {
  if (!isVatDropboxConfigured()) {
    throw new VatSetupRequiredError("dropbox_not_configured", "Dropbox isn't set up for the VAT workspace yet. Add the VAT Dropbox settings, then connect Dropbox.");
  }
  const secrets = await getVatDropboxSecrets();
  if (!secrets) throw new VatSetupRequiredError("dropbox_not_connected", "Connect the business Dropbox before filing documents.");
  if (secrets.accessToken && secrets.expiresAt && Date.parse(secrets.expiresAt) > Date.now() + 60_000) {
    return { token: secrets.accessToken, accountId: secrets.accountId };
  }
  try {
    const refreshed = await refreshVatDropboxToken(secrets.refreshToken);
    await updateVatDropboxAccessToken(secrets.accountId, refreshed.accessToken, refreshed.expiresIn);
    return { token: refreshed.accessToken, accountId: secrets.accountId };
  } catch (error) {
    if (error instanceof VatDropboxError && error.code === "auth") await markVatDropboxError(secrets.accountId, error.message);
    throw error;
  }
}

async function optionalDropboxAccess() {
  try {
    return await getVatDropboxAccess();
  } catch (error) {
    if (error instanceof VatSetupRequiredError) return null;
    throw error;
  }
}

function fileName(path: string) {
  return path.split("/").pop() ?? path;
}

async function locate(access: DropboxAccess, path: string): Promise<VatFileLocation> {
  return { dropboxPath: path, fileName: fileName(path), dropboxUrl: await vatDropboxSharedLink(access.token, path), dropboxAccountId: access.accountId };
}

/**
 * Files filed by this workspace live in a known Dropbox account. Files from the
 * earlier standalone app (no account recorded), or from a since-replaced
 * account, are left exactly where they are.
 */
async function accessForFile(state: VatInvoiceFilingState) {
  if (!state.dropboxPath || !state.dropboxAccountId) return null;
  const access = await getVatDropboxAccess();
  return access.accountId === state.dropboxAccountId ? access : null;
}

async function withMoveRollback<T>(access: DropboxAccess, moved: { from: string; to: string } | null, work: () => Promise<T>) {
  try {
    return await work();
  } catch (error) {
    if (moved) await moveVatDropboxFile(access.token, moved.to, moved.from).catch(() => undefined);
    throw error;
  }
}

function assertCurrent(state: VatInvoiceFilingState | null, expectedUpdatedAt: string): VatInvoiceFilingState {
  if (!state) throw new VatRecordError("not_found", "That invoice is no longer available.");
  if (state.updatedAt !== expectedUpdatedAt) throw new VatRecordError("stale", "This invoice changed since you opened it. Reload before saving.");
  return state;
}

export async function saveVatInvoiceDetails(input: { id: number; details: VatInvoiceFieldsInput; expectedUpdatedAt: string; actor: ActivityActor }) {
  const state = assertCurrent(await getVatInvoiceFilingState(input.id), input.expectedUpdatedAt);
  const fields = normalizeVatInvoiceFields(input.details, { requireDate: state.status === "saved" });
  const access = await accessForFile(state);
  let moved: { from: string; to: string } | null = null;
  let file: VatFileLocation | undefined;
  if (access && state.dropboxPath && fields.invoiceDate) {
    const target = `${vatFolderFor(fields.invoiceDate)}/${vatInvoiceFileName({ ...fields, invoiceDate: fields.invoiceDate }, vatFileExtension(state.dropboxPath))}`;
    if (target.toLowerCase() !== state.dropboxPath.toLowerCase()) {
      const to = await moveVatDropboxFile(access.token, state.dropboxPath, target);
      moved = { from: state.dropboxPath, to };
      file = await withMoveRollback(access, moved, () => locate(access, to));
    }
  }
  const result = access
    ? await withMoveRollback(access, moved, () => updateVatInvoiceDetails({ ...input, fields, file }))
    : await updateVatInvoiceDetails({ ...input, fields });
  return {
    ...result,
    fileUnchanged: Boolean(state.dropboxPath) && !access,
    logWarning: result.changed ? await refreshVatInvoiceLogs(result.years) : null,
  };
}

export async function removeVatInvoiceRecord(input: { id: number; reason: string; expectedUpdatedAt: string; actor: ActivityActor }) {
  if (!(input.reason in VAT_REMOVED_REASON_LABELS) || input.reason === "invoice_received") throw new VatInputError("Choose why this invoice is being removed.");
  const state = assertCurrent(await getVatInvoiceFilingState(input.id), input.expectedUpdatedAt);
  const access = await accessForFile(state);
  let moved: { from: string; to: string } | null = null;
  let file: VatFileLocation | undefined;
  if (access && state.dropboxPath && !state.dropboxPath.toLowerCase().startsWith(`${VAT_REMOVED_FOLDER.toLowerCase()}/`)) {
    // Never deleted: the document moves to the removed folder and stays recoverable.
    const to = await moveVatDropboxFile(access.token, state.dropboxPath, `${VAT_REMOVED_FOLDER}/${fileName(state.dropboxPath)}`);
    moved = { from: state.dropboxPath, to };
    file = await withMoveRollback(access, moved, () => locate(access, to));
  }
  const result = access
    ? await withMoveRollback(access, moved, () => removeVatInvoice({ ...input, file }))
    : await removeVatInvoice(input);
  return { fileUnchanged: Boolean(state.dropboxPath) && !access, logWarning: await refreshVatInvoiceLogs(result.years) };
}

export async function restoreVatInvoiceRecord(input: { id: number; expectedUpdatedAt: string; actor: ActivityActor }) {
  const state = assertCurrent(await getVatInvoiceFilingState(input.id), input.expectedUpdatedAt);
  const access = await accessForFile(state);
  let moved: { from: string; to: string } | null = null;
  let file: VatFileLocation | undefined;
  if (access && state.dropboxPath && state.invoiceDate && state.dropboxPath.toLowerCase().startsWith(`${VAT_REMOVED_FOLDER.toLowerCase()}/`)) {
    const to = await moveVatDropboxFile(access.token, state.dropboxPath, `${vatFolderFor(state.invoiceDate)}/${fileName(state.dropboxPath)}`);
    moved = { from: state.dropboxPath, to };
    file = await withMoveRollback(access, moved, () => locate(access, to));
  }
  const result = access
    ? await withMoveRollback(access, moved, () => restoreVatInvoice({ ...input, file }))
    : await restoreVatInvoice(input);
  return { fileUnchanged: Boolean(state.dropboxPath) && !access, logWarning: await refreshVatInvoiceLogs(result.years) };
}

/** Step 1 of an upload: a single-use Dropbox link the browser sends the file to. */
export async function prepareVatUpload(input: { fileName: string; contentType: string; size: number; invoiceId: number | null; actor: ActivityActor }) {
  const extension = VAT_UPLOAD_TYPES[input.contentType];
  if (!extension) throw new VatInputError("Upload a PDF or a photo (JPG, PNG, WebP or HEIC).");
  if (!Number.isSafeInteger(input.size) || input.size <= 0) throw new VatInputError("The file is empty.");
  if (input.size > VAT_UPLOAD_MAX_BYTES) throw new VatInputError("The file is larger than 20 MB.");
  const originalName = input.fileName.trim().slice(0, 200) || `upload.${extension}`;
  if (input.invoiceId !== null) {
    const state = await getVatInvoiceFilingState(input.invoiceId);
    if (!state || state.status === "removed") throw new VatRecordError("not_found", "That invoice is no longer open for upload.");
  }
  const access = await getVatDropboxAccess();
  const id = randomUUID();
  const stagingPath = `${VAT_UPLOAD_STAGING_FOLDER}/${id}.${extension}`;
  const uploadUrl = await createVatTemporaryUploadLink(access.token, stagingPath);
  await createVatUpload({
    id,
    invoiceId: input.invoiceId,
    stagingPath,
    originalName,
    contentType: input.contentType,
    sizeBytes: input.size,
    dropboxAccountId: access.accountId,
    actor: input.actor,
  });
  return { uploadId: id, uploadUrl };
}

/** Step 2: verify the uploaded file, file it in its month folder, and save the record. */
export async function completeVatUploadFiling(input: { uploadId: string; details: VatInvoiceFieldsInput; actor: ActivityActor }) {
  const upload = await getVatUpload(input.uploadId);
  if (!upload) throw new VatRecordError("not_found", "That upload is no longer available.");
  if (upload.status !== "pending") throw new VatRecordError("invalid_state", "This upload has already been filed.");
  const fields = normalizeVatInvoiceFields(input.details, { requireDate: true });
  const invoiceDate = fields.invoiceDate!;
  const access = await getVatDropboxAccess();
  if (access.accountId !== upload.dropboxAccountId) throw new VatInputError("Dropbox was reconnected to another account. Upload the file again.");
  const staged = await getVatDropboxFile(access.token, upload.stagingPath);
  if (!staged) throw new VatInputError("The file hasn't reached Dropbox yet. Upload it again.");
  if (staged.size !== upload.sizeBytes) throw new VatInputError("The file in Dropbox doesn't match the one selected. Upload it again.");

  const target = `${vatFolderFor(invoiceDate)}/${vatInvoiceFileName({ ...fields, invoiceDate }, vatFileExtension(upload.stagingPath))}`;
  const to = await moveVatDropboxFile(access.token, upload.stagingPath, target);
  const moved = { from: upload.stagingPath, to };
  const file = await withMoveRollback(access, moved, () => locate(access, to));
  // Same rule as email invoices: a GBP total with no VAT shown includes 20% VAT.
  const estimate = withEstimatedVat(fields, []);
  const result = await withMoveRollback(access, moved, () => completeVatUpload({
    uploadId: upload.id,
    fields: { ...fields, ...estimate.figures, invoiceDate },
    extraNotes: estimate.notes,
    file,
    actor: input.actor,
  }));

  let retainWarning: string | null = null;
  const previous = result.previousFile;
  if (previous && previous.path !== to) {
    if (previous.accountId === access.accountId) {
      // The replaced document is kept, never deleted.
      try {
        const retained = await moveVatDropboxFile(access.token, previous.path, `${VAT_REMOVED_FOLDER}/${fileName(previous.path)}`);
        await recordVatRetainedFile(result.invoiceId, retained, input.actor);
      } catch {
        retainWarning = "The new document is filed, but the replaced file could not be moved to the removed folder. It is still in its month folder.";
      }
    }
  }
  return {
    invoiceId: result.invoiceId,
    clearedToGet: result.clearedToGet,
    possibleDuplicates: result.possibleDuplicates,
    logWarning: retainWarning ?? await refreshVatInvoiceLogs(result.years),
  };
}

/**
 * Rewrites /Invoices/<year>/invoice_log.csv for the affected years. The log is
 * a convenience copy: a failure is reported to staff but never undoes the
 * record change that triggered it.
 */
export async function refreshVatInvoiceLogs(years: string[]) {
  const unique = [...new Set(years.filter((year) => /^\d{4}$/.test(year)))];
  if (!unique.length) return null;
  try {
    const access = await optionalDropboxAccess();
    if (!access) return null;
    for (const year of unique) {
      await writeVatDropboxFile(access.token, `${VAT_DROPBOX_ROOT}/${year}/invoice_log.csv`, buildVatInvoiceLogCsv(await getVatLogRows(year)));
    }
    return null;
  } catch {
    return "Saved, but the invoice log in Dropbox could not be updated. Download the CSV from the VAT page instead.";
  }
}
