"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { vatRequest } from "@/lib/vat-client";
import type { VatConnectionState } from "@/lib/vat-types";
import styles from "./vat-workspace.module.css";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connections: VatConnectionState;
  syncStartDate: string | null;
  onChanged: () => void;
};

// A full-page navigation: the authorize route redirects to the provider sign-in.
function startConnection(provider: "dropbox" | "outlook") {
  window.location.assign(new URL(`/api/vat/connections/${provider}/authorize`, window.location.origin).toString());
}

type ApiKey = VatConnectionState["apiKeys"][number];

/** Shows only the key's last four characters; a new key is tested before it replaces the old one. */
function ApiKeyRow({ apiKey, onChanged }: { apiKey: ApiKey; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      await vatRequest("/api/vat/api-keys", { method: "PUT", body: { service: apiKey.service, key: value } });
      setValue("");
      setEditing(false);
      setMessage({ error: false, text: "Key checked and saved." });
      onChanged();
    } catch (requestError) {
      setMessage({ error: true, text: (requestError as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setMessage(null);
    try {
      await vatRequest(`/api/vat/api-keys?service=${apiKey.service}`, { method: "DELETE" });
      onChanged();
    } catch (requestError) {
      setMessage({ error: true, text: (requestError as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return <div className={styles.connectionRow} style={{ flexDirection: "column", alignItems: "stretch" }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
      <div>
        <span className={styles.strong}>{apiKey.name}</span>
        <span className={styles.muted}>{apiKey.last4 ? `Key ending ${apiKey.last4}` : "No key"}</span>
      </div>
      {!editing && <span className={styles.actions}>
        <Button variant="outline" size="compact" onClick={() => { setEditing(true); setMessage(null); }}>{apiKey.last4 ? "Change" : "Add key"}</Button>
        {apiKey.source === "app" && <Button variant="ghost" size="compact" disabled={busy} onClick={remove}>Remove</Button>}
      </span>}
    </div>
    {editing && <div className={styles.actions}>
      <Input className={styles.input} type="password" autoComplete="off" value={value} onChange={(event) => setValue(event.target.value)} placeholder={`New ${apiKey.name} key`} aria-label={`New ${apiKey.name} key`} style={{ flex: "1 1 220px" }} />
      <Button variant="primary" size="compact" disabled={busy || value.trim().length < 10} onClick={save}>{busy ? "Checking…" : "Test and save"}</Button>
      <Button variant="ghost" size="compact" disabled={busy} onClick={() => { setEditing(false); setValue(""); }}>Cancel</Button>
    </div>}
    {message && <span className={message.error ? styles.formError : styles.muted} role={message.error ? "alert" : "status"}>{message.text}</span>}
  </div>;
}

export function VatConnectionsSheet({ open, onOpenChange, connections, onChanged }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const { dropbox } = connections;

  async function disconnect(url: string) {
    setBusy(true);
    setError(null);
    try {
      await vatRequest(url, { method: "DELETE" });
      setConfirm(null);
      onChanged();
    } catch (requestError) {
      setError((requestError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function disconnectControl(key: string, url: string) {
    return confirm === key
      ? <span className={styles.actions}><Button variant="primary" size="compact" disabled={busy} onClick={() => disconnect(url)}>Disconnect</Button><Button variant="ghost" size="compact" onClick={() => setConfirm(null)}>Cancel</Button></span>
      : <Button variant="ghost" size="compact" onClick={() => setConfirm(key)}>Disconnect</Button>;
  }

  return <Sheet open={open} onOpenChange={onOpenChange}>
    <SheetContent className={styles.sheet}>
      <div className={styles.sheetHeader}>
        <SheetTitle asChild><h2>Connections</h2></SheetTitle>
        <SheetDescription className="sr-only">Shared Dropbox and inbox connections</SheetDescription>
      </div>
      <div className={styles.sheetBody}>
        <section className={styles.section}>
          <h3>Dropbox</h3>
          <div className={styles.connectionRow}>
            <div>
              <span className={styles.strong}>{dropbox.connected ? dropbox.accountEmail ?? "Connected" : "Not connected"}</span>
              {dropbox.lastError && <span className={styles.formError}>{dropbox.lastError}</span>}
            </div>
            {dropbox.connected
              ? disconnectControl("dropbox", "/api/vat/connections/dropbox")
              : <Button variant="primary" size="compact" disabled={!dropbox.configured} onClick={() => startConnection("dropbox")}>Connect</Button>}
          </div>
        </section>

        <section className={styles.section}>
          <h3>Inboxes</h3>
          {connections.mailboxes.map((mailbox) => <div className={styles.connectionRow} key={mailbox.id}>
            <div>
              <span className={styles.strong}>{mailbox.email}</span>
              <span className={styles.muted}>{mailbox.connected ? "Connected" : "Not connected"}</span>
            </div>
            {mailbox.connected
              ? disconnectControl(`mailbox-${mailbox.id}`, `/api/vat/mailboxes/${mailbox.id}`)
              : mailbox.provider === "microsoft" && <Button variant="outline" size="compact" disabled={!connections.outlook.configured} onClick={() => startConnection("outlook")}>Connect</Button>}
          </div>)}
          <div>
            <Button variant="outline" size="compact" disabled={!connections.outlook.configured} onClick={() => startConnection("outlook")}>Add Outlook inbox</Button>
          </div>
        </section>
        <section className={styles.section}>
          <h3>API keys</h3>
          {connections.apiKeys.map((key) => <ApiKeyRow key={key.service} apiKey={key} onChanged={onChanged} />)}
        </section>
        {error && <p className={styles.formError} role="alert">{error}</p>}
      </div>
    </SheetContent>
  </Sheet>;
}
