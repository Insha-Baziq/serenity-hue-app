import "server-only";

import { getVatDropboxAccess, sweepRemovedVatFiles, refreshVatInvoiceLogs, VatSetupRequiredError } from "@/lib/vat-filing";
import { moveVatDropboxFile } from "@/lib/vat-dropbox";
import { openVatMailbox, type VatMailbox } from "@/lib/vat-mailbox";
import { processVatEmail } from "@/lib/vat-pipeline";
import { markVatMailboxError } from "@/lib/vat-repository";
import { planVatDuplicates } from "@/lib/vat-routing";
import { isIsoDate, VAT_REMOVED_FOLDER, VatInputError } from "@/lib/vat-rules";
import {
  addVatRunCounts,
  connectedVatMailboxIds,
  createVatRun,
  enqueueVatRunItems,
  filterUnhandledVatEmails,
  flagVatPossibleDuplicates,
  getVatDuplicateCandidates,
  getVatRun,
  markVatInvoiceDuplicate,
  nextVatRunItems,
  recordVatRunEvent,
  releaseVatRunLease,
  setVatRunItemState,
  setVatRunStatus,
  takeVatRunLease,
} from "@/lib/vat-run-store";
import { hasVatPipelineKeys, isVatServiceBlocked } from "@/lib/vat-services";
import { clearVatApiKeyCache } from "@/lib/vat-api-keys";
import type { ActivityActor } from "@/lib/types";

// Get invoices runs are driven by the browser in short steps so each fits in
// one Vercel Function invocation. Nothing runs in the background or on a
// schedule; closing the page just leaves the run to be continued later.

const LEASE_MS = 290_000;
// Stop taking new emails after this long; in-flight extraction may take ~150s more.
const STEP_BUDGET_MS = 100_000;
// Same as the original app: 3 per inbox, all inboxes side by side.
const WORKERS_PER_INBOX = 3;

export async function startVatRun(startDate: string, actor: ActivityActor) {
  if (!isIsoDate(startDate)) throw new VatInputError("Choose a valid start date.");
  if (startDate > new Date().toISOString().slice(0, 10)) throw new VatInputError("The start date can't be in the future.");
  if (startDate < "2020-01-01") throw new VatInputError("Choose a start date from 2020 onwards.");
  if (!(await hasVatPipelineKeys())) throw new VatInputError("Add the OpenRouter and LlamaCloud API keys in Connections first.");
  await getVatDropboxAccess();
  if (!(await connectedVatMailboxIds()).length) throw new VatInputError("Connect at least one Outlook inbox first.");
  return createVatRun(startDate, actor);
}

export async function resumeVatRun(runId: string) {
  const run = await getVatRun(runId);
  if (!run || run.status !== "paused") throw new VatInputError("This run isn't paused.");
  await setVatRunStatus(runId, run.total > 0 || run.processed > 0 ? "processing" : "listing");
}

export async function cancelVatRun(runId: string) {
  const run = await getVatRun(runId);
  if (run && ["listing", "processing", "paused"].includes(run.status)) await setVatRunStatus(runId, "cancelled");
}

/** Advances a run by one step. Returns the run, or null if another tab is working on it. */
export async function stepVatRun(runId: string, actor: ActivityActor) {
  if (!(await takeVatRunLease(runId, LEASE_MS))) return { busy: true, run: await getVatRun(runId) };
  // A key replaced in Connections applies from this step on, on every server instance.
  clearVatApiKeyCache();
  try {
    const run = await getVatRun(runId);
    if (!run) throw new VatInputError("That run no longer exists.");
    if (run.status === "listing") await listRun(runId, run.startDate);
    else if (run.status === "processing") await processRun(runId, run.startDate, actor);
    return { busy: false, run: await getVatRun(runId) };
  } catch (error) {
    if (isVatServiceBlocked(error)) {
      await setVatRunStatus(runId, "paused", { pauseService: error.service, pauseDetail: error.detail });
      return { busy: false, run: await getVatRun(runId) };
    }
    if (error instanceof VatSetupRequiredError) {
      await setVatRunStatus(runId, "paused", { pauseService: "dropbox", pauseDetail: error.message });
      return { busy: false, run: await getVatRun(runId) };
    }
    throw error;
  } finally {
    await releaseVatRunLease(runId);
  }
}

/**
 * Lists email ids only (no reading, no AI cost) in every inbox at once and
 * queues those never handled before, interleaved across inboxes so each step
 * works on all of them side by side.
 */
async function listRun(runId: string, startDate: string) {
  let lastError: string | null = null;
  const perInbox = await Promise.all((await connectedVatMailboxIds()).map(async (accountId) => {
    try {
      const mailbox = await openVatMailbox(accountId);
      // Mailboxes list newest first; work oldest first.
      const ids = (await filterUnhandledVatEmails(await mailbox.listIdsSince(startDate))).reverse();
      await markVatMailboxError(accountId, null);
      return ids.map((emailId) => ({ emailId, accountId }));
    } catch (error) {
      // One inbox failing must not stop the others; Connections shows it needs attention.
      lastError = isVatServiceBlocked(error) ? error.message : `Inbox ${accountId}: ${(error as Error).message}`;
      if (!isVatServiceBlocked(error)) await markVatMailboxError(accountId, (error as Error).message);
      return [];
    }
  }));
  const items: Array<{ emailId: string; accountId: number }> = [];
  for (let index = 0; perInbox.some((list) => index < list.length); index += 1) {
    for (const list of perInbox) if (index < list.length) items.push(list[index]);
  }
  await enqueueVatRunItems(runId, items);
  if (lastError) await addVatRunCounts(runId, { lastError });
}

/**
 * As in the original app: every inbox is worked through at the same time with
 * its own workers (Outlook limits concurrent requests per mailbox), while Jev
 * and LlamaExtract keep their shared caps.
 */
async function processRun(runId: string, startDate: string, actor: ActivityActor) {
  const started = Date.now();
  const dropbox = await getVatDropboxAccess();
  const inboxCount = Math.max(1, (await connectedVatMailboxIds()).length);
  const queue = await nextVatRunItems(runId, inboxCount * WORKERS_PER_INBOX * 30);
  if (!queue.length) return finishRun(runId, startDate, actor);

  const counts = { processed: 0, failed: 0, invoices: 0, toGet: 0, lastError: null as string | null };
  let blocked: unknown = null;
  const byInbox = new Map<number, string[]>();
  for (const item of queue) byInbox.set(item.accountId, [...(byInbox.get(item.accountId) ?? []), item.emailId]);

  await Promise.all([...byInbox].map(async ([accountId, emailIds]) => {
    let mailbox: VatMailbox;
    try {
      mailbox = await openVatMailbox(accountId);
    } catch (error) {
      if (isVatServiceBlocked(error)) blocked ??= error;
      else counts.lastError = (error as Error).message.slice(0, 300);
      return;
    }
    let next = 0;
    const worker = async () => {
      while (!blocked && next < emailIds.length && Date.now() - started < STEP_BUDGET_MS) {
        const emailId = emailIds[next++];
        try {
          const outcome = await processVatEmail(mailbox, emailId, dropbox, actor);
          if (outcome === "saved") counts.invoices += 1;
          if (outcome === "to_get") counts.toGet += 1;
          counts.processed += 1;
          await setVatRunItemState(runId, emailId, "done");
        } catch (error) {
          if (isVatServiceBlocked(error)) {
            // Nothing was decided for this email; it stays queued for after the top-up.
            blocked ??= error;
            continue;
          }
          counts.processed += 1;
          counts.failed += 1;
          counts.lastError = (error as Error).message.slice(0, 300);
          await setVatRunItemState(runId, emailId, "failed");
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(WORKERS_PER_INBOX, emailIds.length) }, worker));
  }));
  await addVatRunCounts(runId, counts);
  // Clean up duplicates as the run goes, so the lists stay tidy before it finishes.
  if (counts.invoices + counts.toGet > 0) await resolveRunDuplicates(startDate, actor);
  if (blocked) throw blocked;
}
/**
 * The duplicate rules over everything since a week before the start date.
 * Runs after every step (not only at the end) and never overrules staff:
 * invoices already kept in review are not removed or re-flagged.
 */
async function resolveRunDuplicates(startDate: string, actor: ActivityActor) {
  const from = new Date(Date.parse(`${startDate}T00:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10);
  const rows = await getVatDuplicateCandidates(from);
  const reviewed = new Set(rows.filter((row) => row.reviewed).map((row) => row.candidate.id));
  const plan = planVatDuplicates(rows.map((row) => row.candidate));
  const removals = plan.removals.filter((removal) => !reviewed.has(removal.id));
  const dropbox = removals.length ? await getVatDropboxAccess() : null;
  for (const removal of removals) {
    const row = rows.find((item) => item.candidate.id === removal.id)!;
    let movedPath: string | null = null;
    // Moved out first so a failed record update can't leave it half-filed; deleted once the removal is saved.
    if (dropbox && row.dropboxPath && row.dropboxAccountId === dropbox.accountId) {
      movedPath = await moveVatDropboxFile(dropbox.token, row.dropboxPath, `${VAT_REMOVED_FOLDER}/${row.dropboxPath.split("/").pop()}`);
    }
    await markVatInvoiceDuplicate({ ...removal, movedPath, actor });
  }
  await flagVatPossibleDuplicates(plan.flagged.filter((id) => !reviewed.has(id)));
  if (dropbox) await sweepRemovedVatFiles(dropbox);
  return removals.length;
}

async function finishRun(runId: string, startDate: string, actor: ActivityActor) {
  const run = await getVatRun(runId);
  const removed = await resolveRunDuplicates(startDate, actor);
  const years = new Set<string>();
  for (let year = Number(startDate.slice(0, 4)); year <= new Date().getUTCFullYear(); year += 1) years.add(String(year));
  await refreshVatInvoiceLogs([...years]);
  await setVatRunStatus(runId, "completed");
  if (run) {
    await recordVatRunEvent(actor, `Got invoices from ${startDate}: ${run.processed} emails checked, ${run.invoices} invoices filed, ${run.toGet} to get`, {
      startDate, processed: run.processed, invoices: run.invoices, toGet: run.toGet, failed: run.failed, duplicatesRemoved: removed,
    });
  }
}
