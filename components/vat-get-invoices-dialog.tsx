"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { vatRequest } from "@/lib/vat-client";
import styles from "./vat-workspace.module.css";

type Run = {
  id: string;
  startDate: string;
  status: "listing" | "processing" | "paused" | "completed" | "cancelled";
  total: number;
  processed: number;
  failed: number;
  invoices: number;
  toGet: number;
  pauseService: string | null;
  pauseDetail: string | null;
  lastError: string | null;
};

type Overview = { activeRun: Run | null; suggestedStartDate: string; latestEmailAt: string | null };
type Props = { open: boolean; onOpenChange: (open: boolean) => void; onProgress: () => void };

const SERVICE_NAMES: Record<string, string> = { jev: "OpenRouter (Jev)", llama: "LlamaCloud", dropbox: "Dropbox", outlook: "Outlook" };
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function VatGetInvoicesDialog({ open, onOpenChange, onProgress }: Props) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [startDate, setStartDate] = useState("");
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const active = useRef(false);

  useEffect(() => {
    if (!open) {
      active.current = false;
      return;
    }
    let cancelled = false;
    vatRequest<Overview>("/api/vat/runs")
      .then((result) => {
        if (cancelled) return;
        setOverview(result);
        setStartDate(result.suggestedStartDate);
        setRun(result.activeRun);
        setError(null);
      })
      .catch((requestError: Error) => { if (!cancelled) setError(requestError.message); });
    return () => { cancelled = true; };
  }, [open]);

  /** Advances the run step by step while this window stays open. */
  async function drive(current: Run) {
    active.current = true;
    setWorking(true);
    let latest = current;
    try {
      while (active.current && (latest.status === "listing" || latest.status === "processing")) {
        const result = await vatRequest<{ busy: boolean; run: Run }>(`/api/vat/runs/${latest.id}/step`, { body: {} });
        latest = result.run;
        setRun(latest);
        onProgress();
        if (result.busy) await wait(4_000);
      }
    } catch (requestError) {
      setError((requestError as Error).message);
    } finally {
      active.current = false;
      setWorking(false);
    }
  }

  async function start() {
    setError(null);
    try {
      const result = await vatRequest<{ run: Run }>("/api/vat/runs", { body: { startDate } });
      setRun(result.run);
      await drive(result.run);
    } catch (requestError) {
      setError((requestError as Error).message);
    }
  }

  async function resume() {
    if (!run) return;
    setError(null);
    try {
      const result = await vatRequest<{ run: Run }>(`/api/vat/runs/${run.id}/resume`, { body: {} });
      setRun(result.run);
      await drive(result.run);
    } catch (requestError) {
      setError((requestError as Error).message);
    }
  }

  function close(next: boolean) {
    if (!next) active.current = false;
    onOpenChange(next);
  }

  const unfinished = run && ["listing", "processing", "paused"].includes(run.status);
  const percent = run && run.total ? Math.round((run.processed / run.total) * 100) : 0;

  return <Dialog open={open} onOpenChange={close}>
    <DialogContent className={styles.dialog}>
      <div className={styles.sheetHeader}>
        <DialogTitle asChild><h2>Get invoices</h2></DialogTitle>
        <DialogDescription className="sr-only">Find invoices in the connected inboxes</DialogDescription>
      </div>
      <div className={styles.sheetBody}>
        {!overview && !error && <p className={styles.formHint}>Loading…</p>}

        {overview && !run && <>
          <label className={styles.field} htmlFor="vat-run-start">Start date
            <Input id="vat-run-start" className={styles.input} type="date" value={startDate} max={new Date().toISOString().slice(0, 10)} onChange={(event) => setStartDate(event.target.value)} />
          </label>
          <p className={styles.formHint}>Emails already checked are skipped.</p>
          <div className={styles.actions}><Button variant="primary" onClick={start} disabled={!startDate}>Get invoices</Button></div>
        </>}

        {run && <>
          <p className={styles.progress} role="status">
            {run.status === "listing" && `Finding emails since ${run.startDate}…`}
            {run.status === "processing" && `Checking emails: ${run.processed} of ${run.total} (${percent}%)`}
            {run.status === "paused" && `Paused at ${run.processed} of ${run.total}`}
            {run.status === "completed" && `Done: ${run.processed} new emails checked`}
            {run.status === "cancelled" && "Stopped"}
          </p>
          {run.total > 0 && <progress max={run.total} value={run.processed} style={{ width: "100%" }} aria-label="Progress" />}
          <dl className={styles.facts}>
            <dt>Invoices filed</dt><dd>{run.invoices}</dd>
            <dt>To get</dt><dd>{run.toGet}</dd>
            {run.failed > 0 && <><dt>Couldn&apos;t process</dt><dd>{run.failed}</dd></>}
          </dl>
          {run.status === "paused" && <p className={styles.formError} role="alert">
            {SERVICE_NAMES[run.pauseService ?? ""] ?? "A service"}: {run.pauseDetail}. Fix it, then resume.
          </p>}
          {working && <p className={styles.formHint}>Keep this window open while it runs.</p>}
          <div className={styles.actions}>
            {run.status === "paused" && <Button variant="primary" onClick={resume}>Resume</Button>}
            {unfinished && run.status !== "paused" && !working && <Button variant="primary" onClick={() => drive(run)}>Continue</Button>}
            {working && <Button variant="outline" onClick={() => { active.current = false; }}>Pause</Button>}
            {!working && unfinished && <Button variant="ghost" onClick={() => setRun(null)}>Start over from a date</Button>}
            {!working && !unfinished && <Button variant="outline" onClick={() => close(false)}>Close</Button>}
          </div>
        </>}
        {error && <p className={styles.formError} role="alert">{error}</p>}
      </div>
    </DialogContent>
  </Dialog>;
}
