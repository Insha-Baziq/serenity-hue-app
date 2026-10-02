// Browser-side helper for the authenticated VAT API. Messages come from the
// server's safe error mapping, so they can be shown to staff as-is.

export class VatRequestError extends Error {
  constructor(message: string, readonly code: string | null, readonly status: number) {
    super(message);
    this.name = "VatRequestError";
  }
}

export async function vatRequest<T = Record<string, unknown>>(url: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(url, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });
  const json = await response.json().catch(() => ({})) as { ok?: boolean; message?: string; code?: string };
  if (!response.ok || json.ok === false) {
    throw new VatRequestError(json.message ?? "The request could not be completed.", json.code ?? null, response.status);
  }
  return json as T;
}

/** Shape staff edit in forms: money as decimal text, dates as YYYY-MM-DD. */
export type VatInvoiceForm = {
  documentType: string;
  supplierName: string;
  supplierVatNumber: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  currency: string;
  netAmount: string;
  vatAmount: string;
  grossAmount: string;
};
