"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { vatRequest } from "@/lib/vat-client";

export type VatRunView = {
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

type Overview = { activeRun: VatRunView | null; suggestedStartDate: string };
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Drives a Get invoices run from the VAT page (not a dialog), so the dialog can
 * be closed while it works. An unfinished run carries on when the page opens.
 */
export function useVatRun(onProgress: () => void) {
  const [run, setRun] = useState<VatRunView | null>(null);
  const [suggestedStartDate, setSuggestedStartDate] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(false);
  const progress = useRef(onProgress);
  useEffect(() => { progress.current = onProgress; }, [onProgress]);

  const drive = useCallback(async (current: VatRunView) => {
    if (active.current) return;
    active.current = true;
    setWorking(true);
    setError(null);
    let latest = current;
    try {
      while (active.current && (latest.status === "listing" || latest.status === "processing")) {
        const result = await vatRequest<{ busy: boolean; run: VatRunView }>(`/api/vat/runs/${latest.id}/step`, { body: {} });
        latest = result.run;
        setRun(latest);
        progress.current();
        if (result.busy) await wait(4_000);
      }
    } catch (requestError) {
      setError((requestError as Error).message);
    } finally {
      active.current = false;
      setWorking(false);
    }
  }, []);

  const refreshOverview = useCallback(async () => {
    const overview = await vatRequest<Overview>("/api/vat/runs");
    setSuggestedStartDate(overview.suggestedStartDate);
    setRun((current) => current && active.current ? current : overview.activeRun);
    return overview;
  }, []);

  useEffect(() => {
    let cancelled = false;
    vatRequest<Overview>("/api/vat/runs")
      .then((overview) => {
        if (cancelled) return;
        setSuggestedStartDate(overview.suggestedStartDate);
        setRun(overview.activeRun);
        // An unfinished run carries on when the VAT page opens (unless it is paused).
        if (overview.activeRun && overview.activeRun.status !== "paused") void drive(overview.activeRun);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      active.current = false;
    };
  }, [drive]);

  return {
    run,
    working,
    error,
    suggestedStartDate,
    refreshOverview,
    async start(startDate: string) {
      setError(null);
      try {
        const result = await vatRequest<{ run: VatRunView }>("/api/vat/runs", { body: { startDate } });
        setRun(result.run);
        void drive(result.run);
      } catch (requestError) {
        setError((requestError as Error).message);
      }
    },
    async resume() {
      if (!run) return;
      setError(null);
      try {
        const result = await vatRequest<{ run: VatRunView }>(`/api/vat/runs/${run.id}/resume`, { body: {} });
        setRun(result.run);
        void drive(result.run);
      } catch (requestError) {
        setError((requestError as Error).message);
      }
    },
    continueRun() {
      if (run) void drive(run);
    },
    pause() {
      active.current = false;
    },
    clear() {
      setRun(null);
    },
  };
}

export type VatRunController = ReturnType<typeof useVatRun>;
