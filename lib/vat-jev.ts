import "server-only";

import { vatApiKey, vatLimiter, VatServiceBlockedError } from "@/lib/vat-services";
import { VAT_CATEGORIES, VAT_PAYMENT_STATUSES, type VatAttachment, type VatCategory, type VatJevResult, type VatPaymentStatus } from "@/lib/vat-routing";

const JEV_URL = "https://openrouter.ai/api/alpha/decisions";
export const VAT_JEV_MODEL = "typesafe/jev-1.13";
const MAX_BODY_CHARS = 12_000;
const jevLimit = vatLimiter(8);

type ChoiceAnswer = { type: "choice"; choice: string; confidence: number; probabilities?: Record<string, number> };

export type VatJevInput = {
  fromName: string | null;
  fromEmail: string | null;
  subject: string | null;
  receivedAt: Date;
  bodyText: string;
  attachments: VatAttachment[];
  attachmentText?: string;
  ownerHistory?: string;
};

async function postWithRetry(body: string) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetch(JEV_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${await vatApiKey("jev")}`, "Content-Type": "application/json" },
        body,
        cache: "no-store",
      });
      if ((response.status === 429 || response.status >= 500) && attempt < 4) throw new Error(`Jev HTTP ${response.status}`);
      return response;
    } catch (error) {
      if (error instanceof VatServiceBlockedError || attempt >= 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2_000 * 2 ** attempt));
    }
  }
}

export async function classifyVatEmail(input: VatJevInput): Promise<VatJevResult> {
  const state: Record<string, string> = {
    context: "Inbox of the owner of Serenity Hue, a UK online shop selling on Shopify and TikTok Shop. We are finding every receipt or invoice for things the owner bought, so they can be checked for VAT.",
    from: [input.fromName, input.fromEmail && `<${input.fromEmail}>`].filter(Boolean).join(" "),
    subject: input.subject ?? "",
    date: input.receivedAt.toISOString().slice(0, 10),
    attachments: input.attachments.length
      ? input.attachments.map((attachment, index) => `[${index}] ${attachment.filename} (${attachment.mimeType}, ${Math.round(attachment.size / 1024)} KB)`).join("\n")
      : "none",
    body: input.bodyText.slice(0, MAX_BODY_CHARS),
  };
  if (input.attachmentText) state.attachment_text = input.attachmentText.slice(0, 8_000);
  if (input.ownerHistory) state.owner_history_for_this_sender = input.ownerHistory;

  const questions: Record<string, unknown> = {
    category: { type: "choice", instructions: "Is this email a receipt, invoice or bill for something the inbox owner paid for, and if so in what form?", criteria: VAT_CATEGORIES },
    payment_status: { type: "choice", instructions: "What does this email say about paying for something the inbox owner bought?", criteria: VAT_PAYMENT_STATUSES },
  };
  if (input.attachments.length) {
    const criteria: Record<string, string> = { none: "None of the attachments is an invoice, receipt, bill or credit note." };
    input.attachments.forEach((attachment, index) => { criteria[`att_${index}`] = `Attachment [${index}] "${attachment.filename}" is the invoice, receipt, bill or credit note document.`; });
    questions.invoice_attachment = { type: "choice", instructions: "Which attachment is the supplier invoice / receipt / credit note document?", criteria };
  }

  const response = await jevLimit(() => postWithRetry(JSON.stringify({ model: VAT_JEV_MODEL, state, questions })));
  if (response.status === 402) throw new VatServiceBlockedError("jev", "out of credits");
  if (response.status === 401 || response.status === 403) throw new VatServiceBlockedError("jev", "the API key was rejected");
  if (!response.ok) throw new Error(`Jev request failed (${response.status})`);
  const json = await response.json() as { answers: Record<string, ChoiceAnswer> };

  const category = json.answers.category;
  const payment = json.answers.payment_status;
  const attachment = json.answers.invoice_attachment;
  return {
    category: (category.choice in VAT_CATEGORIES ? category.choice : "not_invoice") as VatCategory,
    probability: category.probabilities?.[category.choice] ?? category.confidence,
    attachmentIndex: attachment?.choice.startsWith("att_") ? Number(attachment.choice.slice(4)) : null,
    payment: {
      status: (payment && payment.choice in VAT_PAYMENT_STATUSES ? payment.choice : "no_purchase") as VatPaymentStatus,
      probability: payment ? payment.probabilities?.[payment.choice] ?? payment.confidence : 0,
    },
    raw: json.answers,
  };
}
