import "server-only";

import LlamaCloud, { toFile } from "@llamaindex/llama-cloud";
import type { ExtractConfiguration } from "@llamaindex/llama-cloud/resources/extract";
import { z } from "zod";
import { vatApiKey, vatLimiter, VatServiceBlockedError } from "@/lib/vat-services";

// LlamaExtract (structured invoice fields) and LlamaParse (cheap text read),
// ported from the VAT Automation app.

export const VatInvoiceSchema = z.object({
  documentType: z.enum(["invoice", "receipt", "credit_note", "proforma", "import_vat"]).describe(
    "Type of document. credit_note for refunds/credits; receipt for paid-in-full receipts; import_vat for courier or customs "
      + "'duty/VAT' invoices (DHL, FedEx, UPS, Parcelforce, Royal Mail) charging import VAT and duty on a shipment from abroad.",
  ),
  supplierName: z.string().nullable().describe(
    "The business the goods or services were bought from (the shop, restaurant, brand or company named as the seller), not the "
      + "customer, and not an ordering platform, marketplace software or payment service that only delivered the email or took the "
      + "payment (e.g. 'Powered by …', Stripe, Link, PayPal).",
  ),
  supplierVatNumber: z.string().nullable().describe("The seller's VAT registration number exactly as printed, e.g. GB123456789. Null if not shown."),
  invoiceNumber: z.string().nullable().describe("Invoice, receipt, order or credit note number exactly as printed, without extra reference codes in brackets"),
  invoiceDate: z.string().nullable().describe("Invoice date / tax point in YYYY-MM-DD format"),
  dueDate: z.string().nullable().describe("Payment due date in YYYY-MM-DD format, null if not shown"),
  currency: z.string().nullable().describe("ISO currency code of the amounts as printed (£ = GBP, $ = USD, € = EUR, Rs/₨ = PKR). Null if no currency is shown."),
  netAmount: z.number().nullable().describe(
    "Total excluding VAT, as a plain number, so that net + VAT = total. Null if the document doesn't show VAT separately "
      + "(don't use a subtotal before delivery or tax). For import_vat documents: all charges except the import VAT line (duty, fees).",
  ),
  vatAmount: z.number().nullable().describe(
    "Total VAT (or sales tax) the buyer pays, as a plain number. Null if the document doesn't state any VAT or tax; 0 only if it "
      + "explicitly shows zero VAT or zero-rated. On import_vat documents the import VAT is often a charge LINE "
      + "(e.g. 'Vat', 'Import VAT') in the net column while the VAT column shows 0 - use that line's amount here.",
  ),
  grossAmount: z.number().nullable().describe("Total including VAT (the amount paid or payable), as a plain number. Null if no total is shown; 0 only if it says free."),
  vatBreakdown: z.array(z.object({ rate: z.number().describe("VAT rate percent, e.g. 20"), net: z.number(), vat: z.number() }))
    .describe("VAT analysis by rate if shown on the document; empty array otherwise"),
  originalInvoiceNumber: z.string().nullable().describe("For credit notes only: the invoice number being credited"),
});
export type VatExtractedInvoice = z.infer<typeof VatInvoiceSchema>;

export const VatBillNoticeSchema = z.object({
  supplierName: z.string().describe("Company that says the bill is ready"),
  billDate: z.string().nullable().describe("Date of the bill or statement in YYYY-MM-DD, null if not stated"),
  amountDue: z.number().nullable().describe("Amount due if stated in the email, as a plain number"),
  portalUrl: z.string().nullable().describe("URL of the link to view or download the bill, if present"),
});
export type VatBillNotice = z.infer<typeof VatBillNoticeSchema>;

const SYSTEM_PROMPT = "These are purchase documents received by Serenity Hue, a UK online retailer. Extract values exactly as printed. "
  + "Amounts are plain numbers without currency symbols or thousands separators. Dates must be YYYY-MM-DD (UK documents use day/month/year order).";

// Kept below the Get invoices step budget so a slow job never outlives its function.
const JOB_TIMEOUT_MS = 150_000;
const llamaLimit = vatLimiter(4);

class JobTimeout extends Error {}

async function waitFor<T extends { status: string }>(get: () => Promise<T>) {
  const start = Date.now();
  for (;;) {
    const job = await get();
    if (["COMPLETED", "FAILED", "CANCELLED"].includes(job.status)) return job;
    if (Date.now() - start > JOB_TIMEOUT_MS) throw new JobTimeout("LlamaCloud job timed out");
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

function fieldConfidence(meta: Record<string, unknown> | null | undefined) {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(meta ?? {})) {
    const confidence = (value as { confidence?: unknown } | null)?.confidence;
    if (typeof confidence === "number") out[key] = confidence;
  }
  return out;
}

/** Out of credits or a rejected key pauses the run instead of filing guesses. */
function asBlocked(error: unknown): unknown {
  if (error instanceof VatServiceBlockedError) return error;
  const status = (error as { status?: number } | null)?.status;
  const message = (error as Error | null)?.message ?? "";
  if (status === 402 || /maximum number of credits|out of credits/i.test(message)) return new VatServiceBlockedError("llama", "out of credits");
  if (status === 401 || status === 403) return new VatServiceBlockedError("llama", "the API key was rejected");
  return error;
}

const PLACEHOLDERS = new Set(["", "null", "none", "n/a", "na", "unknown", "-"]);

function fillMissing(schema: z.ZodType, result: unknown) {
  const object = { ...((result && typeof result === "object" && !Array.isArray(result) ? result : {}) as Record<string, unknown>) };
  const shape = (schema as unknown as z.ZodObject).shape ?? {};
  for (const [key, field] of Object.entries(shape)) {
    const value = object[key];
    if (typeof value === "string" && PLACEHOLDERS.has(value.trim().toLowerCase())) object[key] = null;
    if (object[key] !== undefined) continue;
    object[key] = field instanceof z.ZodArray ? [] : null;
  }
  return object;
}

async function extract<T extends z.ZodType>(schema: T, content: Buffer, filename: string, tier: "cost_effective" | "agentic") {
  return llamaLimit(async () => {
    try {
      const client = new LlamaCloud({ apiKey: await vatApiKey("llama") });
      const file = await client.files.create({ file: await toFile(content, filename), purpose: "extract" });
      const created = await client.extract.create({
        file_input: file.id,
        configuration: {
          data_schema: z.toJSONSchema(schema) as ExtractConfiguration["data_schema"],
          extraction_target: "per_doc",
          tier,
          confidence_scores: true,
          system_prompt: SYSTEM_PROMPT,
          max_pages: 10,
        },
      });
      const job = await waitFor(() => client.extract.get(created.id, { expand: ["extract_metadata"] }));
      if (job.status !== "COMPLETED") throw new Error(`LlamaExtract ${job.status}: ${job.error_message ?? "unknown error"}`);
      const parsed = schema.safeParse(fillMissing(schema, job.extract_result));
      if (!parsed.success) throw new Error("Extraction returned unexpected data");
      return { data: parsed.data as z.infer<T>, confidence: fieldConfidence(job.extract_metadata?.field_metadata?.document_metadata) };
    } catch (error) {
      throw asBlocked(error);
    }
  });
}

export const extractVatInvoice = (content: Buffer, filename: string) => extract(VatInvoiceSchema, content, filename, "agentic");
export const extractVatBillNotice = (text: string) => extract(VatBillNoticeSchema, Buffer.from(text, "utf8"), "email.txt", "cost_effective");

/** Cheap text pass so Jev can read an attachment when unsure. */
export async function parseVatText(content: Buffer, filename: string): Promise<string> {
  return llamaLimit(async () => {
    try {
      const client = new LlamaCloud({ apiKey: await vatApiKey("llama") });
      const created = await client.parsing.create({ tier: "fast", version: "latest", upload_file: await toFile(content, filename) });
      const result = await waitFor(async () => {
        const job = await client.parsing.get(created.id, { expand: ["text"] });
        return Object.assign(job, { status: job.job.status });
      });
      if (result.status !== "COMPLETED") throw new Error(`LlamaParse ${result.status}`);
      return result.text_full ?? result.text?.pages.map((page) => page.text).join("\n\n") ?? "";
    } catch (error) {
      throw asBlocked(error);
    }
  });
}
