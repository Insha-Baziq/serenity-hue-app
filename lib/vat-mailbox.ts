import "server-only";

import { convert } from "html-to-text";
import { refreshVatOutlookToken } from "@/lib/vat-outlook";
import { getVatMailboxSecrets, markVatMailboxError, updateVatMailboxTokens } from "@/lib/vat-repository";
import type { VatAttachment } from "@/lib/vat-routing";
import { VatServiceBlockedError } from "@/lib/vat-services";

// Read-only Outlook access through Microsoft Graph, used only by an explicit
// Get invoices run. Message ids are immutable ids stored as "ms:<id>".

export const VAT_OUTLOOK_PREFIX = "ms:";
const GRAPH = "https://graph.microsoft.com/v1.0";
// Folders whose mail isn't received mail.
const SKIPPED_FOLDERS = ["sentitems", "drafts", "outbox", "deleteditems", "junkemail"];

export type VatParsedEmail = {
  id: string;
  threadId: string | null;
  fromName: string | null;
  fromEmail: string | null;
  subject: string | null;
  receivedAt: Date;
  bodyText: string;
  attachments: VatAttachment[];
};

export type VatMailbox = {
  accountId: number;
  accountEmail: string;
  listIdsSince(since: Date): Promise<string[]>;
  getEmail(id: string): Promise<VatParsedEmail>;
  downloadAttachment(emailId: string, attachmentId: string): Promise<Buffer>;
};

export async function openVatMailbox(accountId: number): Promise<VatMailbox> {
  const secrets = await getVatMailboxSecrets(accountId);
  if (!secrets) throw new VatServiceBlockedError("outlook", "an inbox is no longer connected. Reconnect it in Connections");
  let token = secrets.accessToken;
  let expiresAt = secrets.expiresAt ? Date.parse(secrets.expiresAt) : 0;
  let refreshing: Promise<string> | null = null;

  async function accessToken() {
    if (token && expiresAt > Date.now() + 60_000) return token;
    refreshing ??= (async () => {
      const refreshed = await refreshVatOutlookToken(secrets!.refreshToken);
      if (!refreshed) {
        await markVatMailboxError(accountId, "Access was removed or expired. Reconnect this inbox.");
        throw new VatServiceBlockedError("outlook", `${secrets!.email} needs reconnecting`);
      }
      await updateVatMailboxTokens(accountId, refreshed);
      token = refreshed.accessToken;
      expiresAt = Date.now() + refreshed.expiresIn * 1000;
      return token;
    })().finally(() => { refreshing = null; });
    return refreshing;
  }

  /** Graph request with backoff on throttling (429/503, honouring Retry-After). */
  async function graph(pathOrUrl: string): Promise<Response> {
    const url = pathOrUrl.startsWith("https://") ? pathOrUrl : `${GRAPH}${pathOrUrl}`;
    for (let attempt = 0; ; attempt += 1) {
      let response: Response | null = null;
      let networkError: Error | null = null;
      try {
        response = await fetch(url, {
          headers: { Authorization: `Bearer ${await accessToken()}`, Prefer: 'IdType="ImmutableId"' },
          cache: "no-store",
        });
      } catch (error) {
        if (error instanceof VatServiceBlockedError) throw error;
        networkError = error as Error;
      }
      if (response?.ok) return response;
      if (response?.status === 401) {
        token = null;
        if (attempt < 1) continue;
      }
      const retryable = networkError || response!.status === 429 || response!.status >= 500;
      if (!retryable || attempt >= 4) {
        if (networkError) throw networkError;
        throw new Error(`Outlook request failed (${response!.status})`);
      }
      const retryAfter = Number(response?.headers.get("Retry-After"));
      await new Promise((resolve) => setTimeout(resolve, retryAfter > 0 ? Math.min(retryAfter, 20) * 1000 : Math.min(20_000, 2_000 * 2 ** attempt)));
    }
  }

  const graphJson = async <T>(path: string) => await (await graph(path)).json() as T;
  async function graphAll<T>(path: string) {
    const out: T[] = [];
    let next: string | undefined = path;
    while (next) {
      const page: { value: T[]; "@odata.nextLink"?: string } = await graphJson(next);
      out.push(...page.value);
      next = page["@odata.nextLink"];
    }
    return out;
  }
  const graphId = (emailId: string) => encodeURIComponent(emailId.slice(VAT_OUTLOOK_PREFIX.length));

  return {
    accountId,
    accountEmail: secrets.email,
    async listIdsSince(since) {
      const skipped = new Set<string>();
      for (const name of SKIPPED_FOLDERS) {
        try {
          skipped.add((await graphJson<{ id: string }>(`/me/mailFolders/${name}?$select=id`)).id);
        } catch {
          // Not every mailbox has every folder; nothing to skip then.
        }
      }
      // A day earlier than asked so a timezone difference never drops an email. Ids only: no reading yet.
      const from = new Date(since.getTime() - 86_400_000).toISOString();
      const rows = await graphAll<{ id: string; parentFolderId: string; isDraft: boolean }>(
        `/me/messages?$filter=${encodeURIComponent(`receivedDateTime ge ${from}`)}&$orderby=receivedDateTime desc&$select=id,parentFolderId,isDraft&$top=500`,
      );
      return rows.filter((row) => !row.isDraft && !skipped.has(row.parentFolderId)).map((row) => VAT_OUTLOOK_PREFIX + row.id);
    },
    async getEmail(id) {
      const message = await graphJson<{
        conversationId?: string;
        subject?: string | null;
        receivedDateTime: string;
        from?: { emailAddress?: { name?: string; address?: string } };
        body?: { contentType: "html" | "text"; content: string };
      }>(`/me/messages/${graphId(id)}?$select=conversationId,subject,receivedDateTime,from,body`);
      // Only real files can be the invoice; attached emails and cloud links have no document to read.
      const attachments = (await graphAll<{ "@odata.type": string; id: string; name?: string; contentType?: string | null; size?: number; isInline?: boolean }>(
        `/me/messages/${graphId(id)}/attachments?$select=id,name,contentType,size,isInline`,
      ))
        .filter((attachment) => attachment["@odata.type"] === "#microsoft.graph.fileAttachment")
        .map((attachment): VatAttachment => ({
          attachmentId: attachment.id,
          filename: attachment.name ?? "attachment",
          mimeType: (attachment.contentType ?? "application/octet-stream").toLowerCase(),
          size: attachment.size ?? 0,
          inline: Boolean(attachment.isInline),
        }));
      const html = message.body?.contentType === "html" ? message.body.content : "";
      const plain = message.body?.contentType === "text" ? message.body.content : "";
      const bodyText = (html ? convert(html, { wordwrap: false, selectors: [{ selector: "img", format: "skip" }] }) : plain)
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      return {
        id,
        threadId: message.conversationId ?? null,
        fromName: message.from?.emailAddress?.name?.trim() || null,
        fromEmail: message.from?.emailAddress?.address?.trim().toLowerCase() || null,
        subject: message.subject ?? null,
        receivedAt: new Date(message.receivedDateTime),
        bodyText: bodyText || plain.trim(),
        attachments,
      };
    },
    async downloadAttachment(emailId, attachmentId) {
      const response = await graph(`/me/messages/${graphId(emailId)}/attachments/${encodeURIComponent(attachmentId)}/$value`);
      return Buffer.from(await response.arrayBuffer());
    },
  };
}
