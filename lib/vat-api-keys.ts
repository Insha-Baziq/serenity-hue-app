import "server-only";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getTursoClient } from "@/lib/turso";
import { insertActivityEvent, invalidateActivityLogCache } from "@/lib/repository";
import { decryptVatToken, encryptVatToken } from "@/lib/vat-config";
import { VatInputError } from "@/lib/vat-rules";
import type { ActivityActor } from "@/lib/types";

// Staff-managed API keys for the Get invoices services. A key saved here wins
// over the server environment value, so the business can rotate keys without
// a developer. Keys are encrypted at rest and never sent back to the browser.

export type VatKeyService = "jev" | "llama";
export const VAT_KEY_SERVICES: VatKeyService[] = ["jev", "llama"];
const ENV_NAMES: Record<VatKeyService, string> = { jev: "VAT_OPENROUTER_API_KEY", llama: "VAT_LLAMA_CLOUD_API_KEY" };
const NAMES: Record<VatKeyService, string> = { jev: "OpenRouter", llama: "LlamaCloud (US)" };
const CACHE_MS = 60_000;

const cache = new Map<VatKeyService, { value: string | null; at: number }>();

export type VatApiKeyStatus = {
  service: VatKeyService;
  name: string;
  source: "app" | "server" | "missing";
  last4: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
};

/** The key to use now: the app-saved key, else the server environment value. */
export async function getVatApiKey(service: VatKeyService) {
  const cached = cache.get(service);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value ?? process.env[ENV_NAMES[service]]?.trim() ?? null;
  const db = await getTursoClient();
  const row = (await db.execute({ sql: "SELECT encrypted_key FROM vat_api_keys WHERE service = ?", args: [service] })).rows[0];
  const value = row ? decryptVatToken(String(row.encrypted_key)) : null;
  cache.set(service, { value, at: Date.now() });
  return value ?? process.env[ENV_NAMES[service]]?.trim() ?? null;
}

export async function getVatApiKeyStatuses(): Promise<VatApiKeyStatus[]> {
  const db = await getTursoClient();
  const rows = (await db.execute("SELECT service, last4, updated_by_label, updated_at FROM vat_api_keys")).rows;
  return VAT_KEY_SERVICES.map((service) => {
    const row = rows.find((item) => item.service === service);
    const server = process.env[ENV_NAMES[service]]?.trim();
    return {
      service,
      name: NAMES[service],
      source: row ? "app" : server ? "server" : "missing",
      last4: row ? String(row.last4) : server ? server.slice(-4) : null,
      updatedBy: row ? String(row.updated_by_label ?? "") || null : null,
      updatedAt: row ? String(row.updated_at) : null,
    };
  });
}

/** Proves the key works for its account before anything is saved. */
async function verify(service: VatKeyService, key: string) {
  const options = { headers: { Authorization: `Bearer ${key}` }, cache: "no-store" as const, signal: AbortSignal.timeout(10_000) };
  let response: Response;
  try {
    response = await fetch(service === "jev" ? "https://openrouter.ai/api/v1/key" : "https://api.cloud.llamaindex.ai/api/v1/organizations", options);
    // A project-scoped LlamaCloud key may not list organizations but can still extract.
    if (service === "llama" && response.status === 403) response = await fetch("https://api.cloud.llamaindex.ai/api/v1/projects", options);
  } catch {
    throw new VatInputError(`Couldn't reach ${NAMES[service]} to check the key. Try again. The current key is unchanged.`);
  }
  if (response.status === 401) throw new VatInputError(`${NAMES[service]} rejected this key. Check you copied the whole key${service === "llama" ? " and that it is from a US-region LlamaCloud account (cloud.llamaindex.ai, not the EU site)" : ""}. The current key is unchanged.`);
  if (response.status === 403) throw new VatInputError(`${NAMES[service]} says this key has no access. Check its account permissions. The current key is unchanged.`);
  if (!response.ok) throw new VatInputError(`${NAMES[service]} couldn't check this key (${response.status}). Try again later. The current key is unchanged.`);
}

async function record(transaction: { execute: (statement: { sql: string; args: Array<string | null> }) => Promise<unknown> }, actor: ActivityActor, action: string, summary: string) {
  const now = new Date().toISOString();
  await transaction.execute({
    sql: `INSERT INTO vat_events (id, occurred_at, actor_id, actor_label, action, invoice_id, summary, details_json)
          VALUES (?, ?, ?, ?, ?, NULL, ?, '{}')`,
    args: [randomUUID(), now, actor.id, actor.label, action, summary],
  });
  await insertActivityEvent(transaction as never, { actor, source: "manual", eventName: `vat.${action}`, entityType: "vat_api_key", summary, outcome: "succeeded", occurredAt: now });
}

export async function saveVatApiKey(service: VatKeyService, rawKey: string, actor: ActivityActor) {
  const key = rawKey.trim();
  if (!/^[A-Za-z0-9_-]{10,512}$/.test(key)) throw new VatInputError("That doesn't look like an API key. Paste the whole key.");
  await verify(service, key);
  const db = await getTursoClient();
  const transaction = await db.transaction("write");
  const now = new Date().toISOString();
  try {
    await transaction.execute({
      sql: `INSERT INTO vat_api_keys (service, encrypted_key, last4, updated_by_id, updated_by_label, updated_at) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(service) DO UPDATE SET encrypted_key = excluded.encrypted_key, last4 = excluded.last4,
              updated_by_id = excluded.updated_by_id, updated_by_label = excluded.updated_by_label, updated_at = excluded.updated_at`,
      args: [service, encryptVatToken(key), key.slice(-4), actor.id, actor.label, now],
    });
    await record(transaction, actor, "api_key.replaced", `Replaced the ${NAMES[service]} API key (ending ${key.slice(-4)})`);
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  } finally {
    transaction.close();
  }
  cache.delete(service);
  invalidateActivityLogCache();
  revalidatePath("/vat");
}

/** Forgets the app-saved key; the server environment key (if any) applies again. */
export async function removeVatApiKey(service: VatKeyService, actor: ActivityActor) {
  const db = await getTursoClient();
  const transaction = await db.transaction("write");
  try {
    const removed = await transaction.execute({ sql: "DELETE FROM vat_api_keys WHERE service = ? RETURNING service", args: [service] });
    if (!removed.rows.length) {
      await transaction.rollback();
      return false;
    }
    await record(transaction, actor, "api_key.removed", `Removed the app-saved ${NAMES[service]} API key`);
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  } finally {
    transaction.close();
  }
  cache.delete(service);
  invalidateActivityLogCache();
  revalidatePath("/vat");
  return true;
}
