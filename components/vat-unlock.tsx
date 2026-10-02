"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import styles from "./vat-workspace.module.css";

/** The VAT password prompt shown before the workspace. */
export function VatUnlock() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const response = await fetch("/api/vat/unlock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
    const json = await response.json().catch(() => ({})) as { message?: string };
    setBusy(false);
    if (!response.ok) {
      setError(json.message ?? "Couldn't unlock. Try again.");
      setPassword("");
      return;
    }
    router.refresh();
  }

  return <section className="workspace workspace--vat">
    <header className={styles.header}><div><h1>VAT</h1></div></header>
    <form className={styles.panel} style={{ maxWidth: 420, padding: 24, display: "grid", gap: 14 }} onSubmit={submit}>
      <label className={styles.field} htmlFor="vat-password">VAT password
        <Input id="vat-password" className={styles.input} type="password" autoFocus autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
      </label>
      {error && <p className={styles.formError} role="alert">{error}</p>}
      <div><Button variant="primary" type="submit" disabled={busy || !password}>{busy ? "Checking…" : "Unlock"}</Button></div>
    </form>
  </section>;
}
