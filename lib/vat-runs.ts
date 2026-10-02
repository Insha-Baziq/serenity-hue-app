import "server-only";

import { getVatDropboxAccess, refreshVatInvoiceLogs, VatSetupRequiredError } from "@/lib/vat-filing";
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
import type { ActivityActor } from "@/lib/types";

// Get invoices runs are driven by the browser in short steps so each fits in
// one Vercel Function invocation. Nothing runs in the background or on a
// schedule; closing the page just leaves the run to be continued later.

const LEASE_MS = 290_000;
// Stop taking new emails after this long; in-flight extraction may take ~150s more.
const STEP_BUDGET_MS = 100_000;
const WORKERS = 6;

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

/** Lists email ids only (no reading, no AI cost) and queues those never handled before. */
async function listRun(runId: string, startDate: string) {
  const since = new Date(`${startDate}T00:00:00Z`);
  const items: Array<{ emailId: string; accountId: number }> = [];
  let lastError: string | null = null;
  for (const accountId of await connectedVatMailboxIds()) {
    let mailbox: VatMailbox;
    try {
      mailbox = await openVatMailbox(accountId);
      // Mailboxes list newest first; work oldest first.
      const ids = (await filterUnhandledVatEmails(await mailbox.listIdsSince(since))).reverse();
      items.push(...ids.map((emailId) => ({ emailId, accountId })));
      await markVatMailboxError(accountId, null);
    } catch (error) {
      if (isVatServiceBlocked(error)) {
        lastError = error.message;
        continue;
      }
      // One inbox failing must not stop the others; Connections shows it needs attention.
      lastError = `Inbox ${accountId}: ${(error as Error).message}`;
      await markVatMailboxError(accountId, (error as Error).message);
    }
  }
  await enqueueVatRunItems(runId, items);
  if (lastError) await addVatRunCounts(runId, { lastError });
}

async function processRun(runId: string, startDate: string, actor: ActivityActor) {
  const started = Date.now();
  const dropbox = await getVatDropboxAccess();
  const queue = await nextVatRunItems(runId, WORKERS * 40);
  if (!queue.length) return finishRun(runId, startDate, actor);

  const mailboxes = new Map<number, Promise<VatMailbox>>();
  const mailboxFor = (accountId: number) => {
    if (!mailboxes.has(accountId)) mailboxes.set(accountId, openVatMailbox(accountId));
    return mailboxes.get(accountId)!;
  };
  const counts = { processed: 0, failed: 0, invoices: 0, toGet: 0, lastError: null as string | null };
  let blocked: unknown = null;
  let next = 0;

  const worker = async () => {
    while (!blocked && next < queue.length && Date.now() - started < STEP_BUDGET_MS) {
      const item = queue[next++];
      try {
        const outcome = await processVatEmail(await mailboxFor(item.accountId), item.emailId, dropbox, actor);
        if (outcome === "saved") counts.invoices += 1;
        if (outcome === "to_get") counts.toGet += 1;
        counts.processed += 1;
        await setVatRunItemState(runId, item.emailId, "done");
      } catch (error) {
        if (isVatServiceBlocked(error)) {
          // Nothing was decided for this email; it stays queued for after the top-up.
          blocked ??= error;
          continue;
        }
        counts.processed += 1;
        counts.failed += 1;
        counts.lastError = (error as Error).message.slice(0, 300);
        await setVatRunItemState(runId, item.emailId, "failed");
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(WORKERS, queue.length) }, worker));
  await addVatRunCounts(runId, counts);
  if (blocked) throw blocked;
}

async function finishRun(runId: string, startDate: string, actor: ActivityActor) {
  const run = await getVatRun(runId);
  const from = new Date(Date.parse(`${startDate}T00:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10);
  const rows = await getVatDuplicateCandidates(from);
  const plan = planVatDuplicates(rows.map((row) => row.candidate));
  const dropbox = plan.removals.length ? await getVatDropboxAccess() : null;
  for (const removal of plan.removals) {
    const row = rows.find((item) => item.candidate.id === removal.id)!;
    let movedPath: string | null = null;
    // The duplicate's document is kept in the removed folder, never deleted.
    if (dropbox && row.dropboxPath && row.dropboxAccountId === dropbox.accountId) {
      movedPath = await moveVatDropboxFile(dropbox.token, row.dropboxPath, `${VAT_REMOVED_FOLDER}/${row.dropboxPath.split("/").pop()}`);
    }
    await markVatInvoiceDuplicate({ ...removal, movedPath, actor });
  }
  await flagVatPossibleDuplicates(plan.flagged);
  const years = new Set<string>();
  for (let year = Number(startDate.slice(0, 4)); year <= new Date().getUTCFullYear(); year += 1) years.add(String(year));
  await refreshVatInvoiceLogs([...years]);
  await setVatRunStatus(runId, "completed");
  if (run) {
    await recordVatRunEvent(actor, `Got invoices from ${startDate}: ${run.processed} emails checked, ${run.invoices} invoices filed, ${run.toGet} to get`, {
      startDate, processed: run.processed, invoices: run.invoices, toGet: run.toGet, failed: run.failed, duplicatesRemoved: plan.removals.length,
    });
  }
}
