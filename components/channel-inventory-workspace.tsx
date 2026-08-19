"use client";

import { Minus, Plus, RefreshCw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { ProductArt } from "@/components/product-art";
import { Input } from "@/components/ui/input";
import { relativeTime } from "@/lib/format";
import type { ChannelInventoryRow, ChannelInventorySnapshot, InventoryChannel, InventoryLedgerEntry } from "@/lib/types";

const CHANNELS: { id: InventoryChannel; name: string; sub: string }[] = [
  { id: "master", name: "Master", sub: "Real physical stock" },
  { id: "shopify", name: "Shopify", sub: "Store allocation" },
  { id: "tiktok", name: "TikTok Shop", sub: "Scarcity level" },
];

function ChannelLogo({ channel, size = 42 }: { channel: InventoryChannel; size?: number }) {
  if (channel === "shopify") {
    return (
      <span className="ci-logo ci-logo--shopify" style={{ width: size, height: size }} aria-hidden="true">
        <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24"><path d="M15.3 5.2c-.1 0-.9.2-1 .3-.1-.4-.3-.9-.7-1.3-.5-.6-1.2-.7-1.6-.5-.9-.9-1.9-.6-2.8.2-1 .8-1.6 2.3-1.8 3.3-.7.2-1.3.4-1.4.4-.4.1-.4.1-.5.5-.1.3-1 7.9-1 7.9L15 18l3.6-.8S15.7 5.4 15.6 5.3c-.1-.1-.2-.1-.3-.1Z" fill="#fff" /><path d="m12.3 9.2-.4 1.4s-.5-.3-1.2-.2c-1 .1-1 .7-1 .8.1.9 2.4 1.1 2.5 3.1.1 1.6-.8 2.6-2.2 2.7-1.7.1-2.6-.9-2.6-.9l.4-1.5s.9.7 1.7.6c.5 0 .7-.4.6-.7-.1-1.1-2-1.1-2.1-2.9-.1-1.5 1-3.1 3.2-3.2.9-.1 1.4.2 1.4.2Z" fill="#5e8e3e" /></svg>
      </span>
    );
  }
  if (channel === "tiktok") {
    return (
      <span className="ci-logo ci-logo--tiktok" style={{ width: size, height: size }} aria-hidden="true">
        <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24"><path d="M16.6 3.7h-3v13.1a2.3 2.3 0 1 1-2.3-2.3c.2 0 .5 0 .7.1v-3a5.3 5.3 0 1 0 4.6 5.2V9.4a6.7 6.7 0 0 0 3.9 1.2V7.6a3.9 3.9 0 0 1-3.9-3.9Z" fill="#25f4ee" transform="translate(-1 .5)" /><path d="M17.6 2.6h-3v13.1a2.3 2.3 0 1 1-2.3-2.3c.2 0 .5 0 .7.1v-3a5.3 5.3 0 1 0 4.6 5.2V8.3a6.7 6.7 0 0 0 3.9 1.2V6.5a3.9 3.9 0 0 1-3.9-3.9Z" fill="#fe2c55" transform="translate(1 -.3)" /><path d="M17.1 3.1h-3v13.1a2.3 2.3 0 1 1-2.3-2.3c.2 0 .5 0 .7.1v-3a5.3 5.3 0 1 0 4.6 5.2V8.8a6.7 6.7 0 0 0 3.9 1.2V7a3.9 3.9 0 0 1-3.9-3.9Z" fill="#fff" /></svg>
      </span>
    );
  }
  return <span className="ci-logo ci-logo--master" style={{ width: size, height: size }} aria-hidden="true">SH</span>;
}

function buildOptimisticEntry(item: string, before: number | null, after: number): InventoryLedgerEntry {
  return {
    id: `local-${Date.now()}`, item, inventory: "master", changeType: "manual_edit",
    actor: "You", isSystem: false, quantityBefore: before, quantityAfter: after, quantityDelta: after - (before ?? 0),
    reference: "recount", createdAt: new Date().toISOString(),
  };
}

type Status = { cls: "ok" | "low" | "risk" | "unset"; label: string };

function statusFor(row: ChannelInventoryRow): Status {
  if (row.master === null) return { cls: "unset", label: "Set master" };
  if (row.master < row.shopify + (row.tiktok ?? 0)) return { cls: "risk", label: "Oversell risk" };
  if (row.tiktok !== null && row.tiktok <= 3) return { cls: "low", label: "TikTok selling out" };
  return { cls: "ok", label: "Scarcity OK" };
}

export function ChannelInventoryWorkspace({ initial }: { initial: ChannelInventorySnapshot }) {
  const [channel, setChannel] = useState<InventoryChannel>("master");
  const [rows, setRows] = useState(initial.rows);
  const [ledger, setLedger] = useState(initial.ledger);
  const [query, setQuery] = useState("");
  const [savingId, setSavingId] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState("");

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return rows;
    return rows.filter((row) => [row.product, row.variant, row.sku].join(" ").toLowerCase().includes(text));
  }, [query, rows]);

  async function commitMaster(row: ChannelInventoryRow, next: number) {
    const quantity = Math.max(0, next);
    const before = row.master;
    setRows((current) => current.map((item) => item.variantId === row.variantId ? { ...item, master: quantity } : item));
    setSavingId(row.variantId);
    try {
      const response = await fetch("/api/inventory/master", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ variantId: row.variantId, quantity }),
      });
      if (!response.ok) throw new Error("save failed");
      const label = `${row.product}${row.variant && row.variant !== "Default Title" ? ` — ${row.variant}` : ""}`;
      setLedger((current) => [buildOptimisticEntry(label, before, quantity), ...current].slice(0, 12));
    } catch {
      setRows((current) => current.map((item) => item.variantId === row.variantId ? { ...item, master: before } : item));
      setNotice("Could not save — check your connection and try again.");
    } finally {
      setSavingId("");
    }
  }

  async function refreshTikTok() {
    setRefreshing(true);
    setNotice("");
    try {
      const response = await fetch("/api/inventory/refresh-tiktok", { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.message || "refresh failed");
      setNotice(`Fetched ${data.skus} TikTok SKUs · ${data.matched} matched to products. Reload to see updated levels.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "TikTok refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  const isMaster = channel === "master";
  const channelMeta = {
    master: { kicker: "Master inventory", live: "Physical count · maintained in-app" },
    shopify: { kicker: "Shopify allocation", live: initial.sync.lastSyncedAt ? `Fetched from Shopify · synced ${relativeTime(initial.sync.lastSyncedAt)}` : "Fetched from Shopify" },
    tiktok: { kicker: "TikTok scarcity level", live: initial.tiktokSyncedAt ? `Fetched from TikTok · synced ${relativeTime(initial.tiktokSyncedAt)}` : "Not yet fetched from TikTok" },
  }[channel];

  return (
    <section className="workspace workspace--inventory ci-workspace" data-channel={channel}>
      <header className="workspace-header">
        <div>
          <p className="workspace-kicker ci-kicker">{channelMeta.kicker}</p>
          <h1>Stock control — <span className="ci-title-swap">{CHANNELS.find((c) => c.id === channel)!.name}</span></h1>
          <div className="live-caption"><span className="live-dot" aria-hidden="true" />{channelMeta.live}</div>
        </div>
      </header>

      <div className="ci-switch" role="tablist" aria-label="Choose inventory">
        {CHANNELS.map((c) => (
          <button key={c.id} type="button" role="tab" aria-selected={channel === c.id} className="ci-chan" data-channel={c.id} onClick={() => { setChannel(c.id); setNotice(""); }}>
            <ChannelLogo channel={c.id} />
            <span className="ci-chan__label"><span className="ci-chan__top">{c.name}</span><span className="ci-chan__sub">{c.sub}</span></span>
          </button>
        ))}
      </div>

      <div className={`ci-banner${isMaster ? " ci-banner--master" : ""}`}>
        <ChannelLogo channel={channel} size={34} />
        <p>
          {isMaster
            ? <><b>Master physical count.</b> <span>Editing this reflects a real recount — it never pushes to a sales channel.</span></>
            : <><b>{CHANNELS.find((c) => c.id === channel)!.name}</b> display level. <span>Read-only for now — direct editing &amp; push ships in Phase&nbsp;2.</span></>}
        </p>
        {channel === "tiktok" && (
          <button type="button" className="ci-refresh" onClick={refreshTikTok} disabled={refreshing}>
            <RefreshCw size={15} className={refreshing ? "spin" : ""} />{refreshing ? "Fetching…" : "Refresh from TikTok"}
          </button>
        )}
      </div>

      {notice && <div className="ci-notice">{notice}</div>}

      <div className="orders-table-frame inventory-table-frame">
        <div className="inventory-toolbar">
          <label className="search-field search-field--inventory"><Search size={18} strokeWidth={1.8} aria-hidden="true" /><span className="sr-only">Search products or SKUs</span><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search product or SKU" /></label>
          <span className="ci-count">{filtered.length} {filtered.length === 1 ? "item" : "items"}</span>
        </div>
        <div className="inventory-scroll">
          <table className="inventory-table ci-table">
            <thead>
              <tr>
                <th>Product</th>
                <th className={`ci-qty${channel === "master" ? " ci-qty--active" : ""}`}><span className="ci-colhead ci-colhead--master"><span className="ci-mk">SH</span>Master</span></th>
                <th className={`ci-qty${channel === "shopify" ? " ci-qty--active" : ""}`}><span className="ci-colhead ci-colhead--shopify"><span className="ci-mk"><ChannelLogo channel="shopify" size={15} /></span>Shopify</span></th>
                <th className={`ci-qty${channel === "tiktok" ? " ci-qty--active" : ""}`}><span className="ci-colhead ci-colhead--tiktok"><span className="ci-mk"><ChannelLogo channel="tiktok" size={15} /></span>TikTok</span></th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const status = statusFor(row);
                return (
                  <tr key={row.variantId}>
                    <td className="inventory-product ci-product"><ProductArt tone={row.imageTone} size="small" /><span><strong>{row.product}</strong><small>{row.variant && row.variant !== "Default Title" ? row.variant : row.sku || "—"}</small></span></td>
                    <QtyCell active={channel === "master"} editable value={row.master} saving={savingId === row.variantId} onCommit={(next) => commitMaster(row, next)} isMaster />
                    <QtyCell active={channel === "shopify"} value={row.shopify} />
                    <QtyCell active={channel === "tiktok"} value={row.tiktok} />
                    <td><span className={`ci-chip ci-chip--${status.cls}`}><i />{status.label}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && <div className="table-empty">No products match that search.</div>}
      </div>

      <section className="ci-logwrap">
        <h2>Change history</h2>
        <p className="ci-logwrap__sub">Every change on every inventory — who, when, and exactly what moved. Nothing is ever overwritten.</p>
        <div className="ci-log">
          {ledger.length === 0 && <div className="table-empty">No inventory changes recorded yet.</div>}
          {ledger.map((entry) => <LedgerRow key={entry.id} entry={entry} />)}
        </div>
      </section>
    </section>
  );
}

function QtyCell({ active, value, editable, saving, isMaster, onCommit }: { active: boolean; value: number | null; editable?: boolean; saving?: boolean; isMaster?: boolean; onCommit?: (next: number) => void }) {
  if (active && editable && onCommit) {
    return (
      <td className="ci-qty ci-qty--active">
        <span className="ci-stepper">
          <button type="button" aria-label="Decrease" onClick={() => onCommit(Math.max(0, (value ?? 0) - 1))}><Minus size={14} /></button>
          <input key={value ?? 0} inputMode="numeric" defaultValue={value ?? 0} disabled={saving} onBlur={(event) => { const next = Number(event.target.value.replace(/\D/g, "")) || 0; if (next !== (value ?? 0)) onCommit(next); }} />
          <button type="button" aria-label="Increase" onClick={() => onCommit((value ?? 0) + 1)}><Plus size={14} /></button>
        </span>
      </td>
    );
  }

  const display = value === null ? "—" : value;
  return <td className={`ci-qty${active ? " ci-qty--active" : ""}`}><span className={`ci-num${isMaster ? " ci-num--master" : active ? "" : " ci-num--dim"}`}>{display}</span></td>;
}

function LedgerRow({ entry }: { entry: InventoryLedgerEntry }) {
  const badge = entry.inventory === "shopify" ? "s" : entry.inventory === "tiktok" ? "t" : "m";
  const badgeLabel = entry.inventory === "shopify" ? "Shopify" : entry.inventory === "tiktok" ? "TikTok" : "Master";
  const up = entry.quantityDelta >= 0;
  const reason = entry.changeType === "manual_edit" ? "recount" : entry.changeType === "sale" ? "sale" : entry.changeType.replace("_", " ");
  return (
    <div className="ci-logrow">
      <span className="ci-when">{relativeTime(entry.createdAt)}</span>
      <span className="ci-who"><span className={`ci-av ci-av--${entry.isSystem ? "sys" : "staff"}`}>{entry.isSystem ? "⚙" : (entry.actor[0] || "?").toUpperCase()}</span><span>{entry.actor}<small>{entry.isSystem ? "System" : "Staff"}</small></span></span>
      <span className="ci-what"><span className={`ci-badge ci-badge--${badge}`}>{badgeLabel}</span> {entry.item} <span className="ci-fromto">{entry.quantityBefore ?? "—"} → {entry.quantityAfter ?? "—"}</span> <span className="ci-reason">{reason}</span></span>
      <span className={`ci-delta ci-delta--${up ? "up" : "down"}`}>{up ? "+" : "−"}{Math.abs(entry.quantityDelta)}</span>
    </div>
  );
}
