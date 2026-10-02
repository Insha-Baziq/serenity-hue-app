import "server-only";

import { getVatApiKey } from "@/lib/vat-api-keys";

// Outside services the Get invoices run depends on. When one refuses (out of
// credits, key rejected, storage full) nothing is decided about the email: the
// run pauses and staff are told what to top up.

export type VatService = "jev" | "llama" | "dropbox" | "outlook";

export const VAT_SERVICE_NAMES: Record<VatService, string> = {
  jev: "OpenRouter (Jev)",
  llama: "LlamaCloud (LlamaExtract)",
  dropbox: "Dropbox",
  outlook: "Outlook",
};

export class VatServiceBlockedError extends Error {
  constructor(readonly service: VatService, readonly detail: string) {
    super(`${VAT_SERVICE_NAMES[service]}: ${detail}`);
    this.name = "VatServiceBlockedError";
  }
}

// Checked by name, not instanceof: dev reloads can load a module twice.
export const isVatServiceBlocked = (error: unknown): error is VatServiceBlockedError =>
  (error as { name?: string } | null)?.name === "VatServiceBlockedError";

/** The active key: saved in the app (Connections → API keys), else the server environment. */
export async function vatApiKey(service: "jev" | "llama") {
  const value = await getVatApiKey(service);
  if (!value) throw new VatServiceBlockedError(service, "no API key is set. Add one in Connections → API keys");
  return value;
}

export async function hasVatPipelineKeys() {
  return Boolean(await getVatApiKey("jev")) && Boolean(await getVatApiKey("llama"));
}

/** Caps calls in flight to one service across concurrent work. */
export function vatLimiter(max: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const run = async <T>(work: () => Promise<T>) => {
    try {
      return await work();
    } finally {
      const next = queue.shift();
      if (next) next();
      else active -= 1;
    }
  };
  return async <T>(work: () => Promise<T>): Promise<T> => {
    if (active < max) {
      active += 1;
      return run(work);
    }
    await new Promise<void>((resolve) => queue.push(resolve));
    return run(work);
  };
}
