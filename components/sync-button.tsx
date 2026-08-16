"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

type SyncResponse = { ok: boolean; message: string; completedAt?: string };

export function SyncButton({ variant = "outline" }: { variant?: "outline" | "primary" }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function sync() {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/sync", { method: "POST" });
      const data = (await response.json()) as SyncResponse;
      setMessage(data.message);
      if (data.ok) router.refresh();
    } catch {
      setMessage("Couldn't reach the sync service. Try again shortly.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="sync-control">
      <Button variant={variant} disabled={pending} onClick={sync} aria-live="polite">
        <RefreshCw size={17} className={pending ? "spin" : ""} aria-hidden="true" />
        {pending ? "Syncing…" : "Sync now"}
      </Button>
      {message && <p className="sync-message" role="status">{message}</p>}
    </div>
  );
}
