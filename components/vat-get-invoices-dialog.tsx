"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { VatRunController } from "@/components/use-vat-run";
import styles from "./vat-workspace.module.css";

type Props = { open: boolean; onOpenChange: (open: boolean) => void; controller: VatRunController };

const SERVICE_NAMES: Record<string, string> = { jev: "OpenRouter (Jev)", llama: "LlamaCloud", dropbox: "Dropbox", outlook: "Outlook" };

/** Choose a start date and watch progress. The run keeps going after this closes. */
export function VatGetInvoicesDialog({ open, onOpenChange, controller }: Props) {
  const { run, working, error } = controller;
  const [startDate, setStartDate] = useState<string | null>(null);
  const [startingOver, setStartingOver] = useState(false);
  const date = startDate ?? controller.suggestedStartDate ?? "";
  const unfinished = run && ["listing", "processing", "paused"].includes(run.status);
  const choosing = !run || startingOver || !unfinished;
  const percent = run && run.total ? Math.round((run.processed / run.total) * 100) : 0;

  return <Dialog open={open} onOpenChange={(next) => { if (!next) setStartingOver(false); onOpenChange(next); }}>
    <DialogContent className={styles.dialog}>
      <div className={styles.sheetHeader}>
        <DialogTitle asChild><h2>Get invoices</h2></DialogTitle>
        <DialogDescription className="sr-only">Find invoices in the connected inboxes</DialogDescription>
      </div>
      <div className={styles.sheetBody}>
        {run && !choosing && <>
          <p className={styles.progress} role="status">
            {run.status === "listing" && `Finding emails since ${run.startDate}…`}
            {run.status === "processing" && `Checking emails: ${run.processed} of ${run.total} (${percent}%)`}
            {run.status === "paused" && `Paused at ${run.processed} of ${run.total}`}
          </p>
          {run.total > 0 && <progress max={run.total} value={run.processed} style={{ width: "100%" }} aria-label="Progress" />}
          <dl className={styles.facts}>
            <dt>Invoices filed</dt><dd>{run.invoices}</dd>
            <dt>To get</dt><dd>{run.toGet}</dd>
            {run.failed > 0 && <><dt>Couldn&apos;t process</dt><dd>{run.failed}</dd></>}
          </dl>
          {run.status === "paused" && <p className={styles.formError} role="alert">{SERVICE_NAMES[run.pauseService ?? ""] ?? "A service"}: {run.pauseDetail}. Fix it, then resume.</p>}
          {working && <p className={styles.formHint}>You can close this; it keeps running while the VAT page is open.</p>}
          <div className={styles.actions}>
            {run.status === "paused" && <Button variant="primary" onClick={() => void controller.resume()}>Resume</Button>}
            {run.status !== "paused" && !working && <Button variant="primary" onClick={controller.continueRun}>Continue</Button>}
            {working && <Button variant="outline" onClick={controller.pause}>Pause</Button>}
            {!working && <Button variant="ghost" onClick={() => setStartingOver(true)}>Start over from a date</Button>}
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
          </div>
        </>}

        {choosing && <>
          {run?.status === "completed" && !startingOver && <p className={styles.progress} role="status">Last run: {run.processed} emails checked, {run.invoices} invoices filed, {run.toGet} to get.</p>}
          <label className={styles.field} htmlFor="vat-run-start">Start date
            <Input id="vat-run-start" className={styles.input} type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={(event) => setStartDate(event.target.value)} />
          </label>
          <p className={styles.formHint}>Emails already checked are skipped.</p>
          <div className={styles.actions}>
            <Button variant="primary" disabled={!date || working} onClick={() => { setStartingOver(false); void controller.start(date); }}>Get invoices</Button>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
          </div>
        </>}
        {error && <p className={styles.formError} role="alert">{error}</p>}
      </div>
    </DialogContent>
  </Dialog>;
}
