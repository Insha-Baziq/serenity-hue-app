import "server-only";

import { vatDropboxCredentials, vatDropboxRedirectUri } from "@/lib/vat-config";

// Dropbox API edge for VAT filing. The shared account uses App-folder access,
// so every path here is inside that app's folder. Callers pass a fresh access
// token from the VAT repository; this module never stores credentials.

const API = "https://api.dropboxapi.com";
const CONTENT = "https://content.dropboxapi.com";

export class VatDropboxError extends Error {
  constructor(readonly code: "auth" | "not_found" | "conflict" | "insufficient_space" | "unavailable", message: string) {
    super(message);
    this.name = "VatDropboxError";
  }
}

function credentials() {
  const value = vatDropboxCredentials();
  if (!value) throw new VatDropboxError("unavailable", "Dropbox is not configured for the VAT workspace.");
  return value;
}

function basicAuth() {
  const { appKey, appSecret } = credentials();
  return `Basic ${Buffer.from(`${appKey}:${appSecret}`).toString("base64")}`;
}

export function vatDropboxAuthorizationUrl(state: string) {
  const url = new URL("https://www.dropbox.com/oauth2/authorize");
  url.searchParams.set("client_id", credentials().appKey);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("token_access_type", "offline");
  url.searchParams.set("redirect_uri", vatDropboxRedirectUri());
  url.searchParams.set("state", state);
  return url.toString();
}

type TokenResponse = { access_token: string; refresh_token?: string; expires_in: number; account_id?: string };

async function tokenRequest(body: Record<string, string>) {
  const response = await fetch(`${API}/oauth2/token`, {
    method: "POST",
    headers: { Authorization: basicAuth(), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    cache: "no-store",
  });
  if (response.status === 400 || response.status === 401) {
    throw new VatDropboxError("auth", "Dropbox refused the connection. Reconnect Dropbox.");
  }
  if (!response.ok) throw new VatDropboxError("unavailable", `Dropbox sign-in is unavailable (${response.status}).`);
  return await response.json() as TokenResponse;
}

export async function exchangeVatDropboxCode(code: string) {
  const tokens = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: vatDropboxRedirectUri() });
  if (!tokens.refresh_token || !tokens.account_id) {
    throw new VatDropboxError("auth", "Dropbox did not grant offline access. Connect Dropbox again.");
  }
  return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresIn: tokens.expires_in, accountId: tokens.account_id };
}

export async function refreshVatDropboxToken(refreshToken: string) {
  const tokens = await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
  return { accessToken: tokens.access_token, expiresIn: tokens.expires_in };
}

/** Dropbox-API-Arg must be ASCII: escape anything outside it. */
function apiArg(value: unknown) {
  return JSON.stringify(value).replace(/[\u007f-￿]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

function classify(status: number, text: string, fallback: string) {
  if (status === 401) return new VatDropboxError("auth", "Dropbox access expired or was removed. Reconnect Dropbox.");
  if (/insufficient_space/.test(text)) return new VatDropboxError("insufficient_space", "The connected Dropbox is full.");
  if (/not_found/.test(text)) return new VatDropboxError("not_found", "That file is not in the connected Dropbox.");
  if (/conflict|shared_link_already_exists/.test(text)) return new VatDropboxError("conflict", "A file with that name already exists in Dropbox.");
  return new VatDropboxError("unavailable", fallback);
}

async function rpc<T>(token: string, endpoint: string, body: unknown): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(`${API}/2/${endpoint}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      // Endpoints without arguments still take a JSON body: the literal "null".
      body: JSON.stringify(body),
      cache: "no-store",
    });
    // Busy (rate limited) or a brief server error: wait as told, then retry a few times.
    if ((response.status === 429 || response.status >= 500) && attempt < 3) {
      const wait = Number(response.headers.get("Retry-After")) * 1000 || 1_000 * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, Math.min(wait, 8_000)));
      continue;
    }
    const text = await response.text();
    if (!response.ok) throw classify(response.status, text, `Dropbox ${endpoint} failed (${response.status}).`);
    return (text ? JSON.parse(text) : {}) as T;
  }
}

export async function getVatDropboxAccount(token: string) {
  const account = await rpc<{ account_id: string; email?: string }>(token, "users/get_current_account", null);
  return { accountId: account.account_id, email: account.email ?? null };
}

/**
 * A single-use link the browser can POST the file body to directly (valid up to
 * four hours, files up to 150 MB), so uploads never pass through a function.
 */
export async function createVatTemporaryUploadLink(token: string, path: string) {
  const result = await rpc<{ link: string }>(token, "files/get_temporary_upload_link", {
    commit_info: { path, mode: "add", autorename: false, mute: true },
    duration: 3600,
  });
  return result.link;
}

export async function getVatDropboxFile(token: string, path: string) {
  try {
    const metadata = await rpc<{ ".tag": string; path_display: string; size?: number }>(token, "files/get_metadata", { path });
    return metadata[".tag"] === "file" ? { path: metadata.path_display, size: metadata.size ?? 0 } : null;
  } catch (error) {
    if (error instanceof VatDropboxError && error.code === "not_found") return null;
    throw error;
  }
}

export async function moveVatDropboxFile(token: string, fromPath: string, toPath: string) {
  const result = await rpc<{ metadata: { path_display: string } }>(token, "files/move_v2", {
    from_path: fromPath,
    to_path: toPath,
    autorename: true,
  });
  return result.metadata.path_display;
}

/** Deletes a file in Dropbox. A file that is already gone counts as deleted. */
export async function deleteVatDropboxFile(token: string, path: string) {
  try {
    await rpc(token, "files/delete_v2", { path });
  } catch (error) {
    if (!(error instanceof VatDropboxError && error.code === "not_found")) throw error;
  }
}

export async function vatDropboxSharedLink(token: string, path: string) {
  try {
    const result = await rpc<{ url: string }>(token, "sharing/create_shared_link_with_settings", { path });
    return result.url;
  } catch (error) {
    if (!(error instanceof VatDropboxError) || error.code !== "conflict") throw error;
    const existing = await rpc<{ links: Array<{ url: string }> }>(token, "sharing/list_shared_links", { path, direct_only: true });
    if (!existing.links[0]) throw error;
    return existing.links[0].url;
  }
}

/** Files a document fetched from an inbox (server to Dropbox, no browser payload limit). */
export async function uploadVatDropboxDocument(token: string, path: string, content: Buffer) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(`${CONTENT}/2/files/upload`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
        "Dropbox-API-Arg": apiArg({ path, mode: "add", autorename: true, mute: true }),
      },
      body: new Uint8Array(content),
      cache: "no-store",
    });
    if ((response.status === 429 || response.status >= 500) && attempt < 4) {
      const wait = Number(response.headers.get("Retry-After")) * 1000 || 1_000 * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, Math.min(wait, 8_000)));
      continue;
    }
    if (!response.ok) throw classify(response.status, await response.text(), "Dropbox upload failed.");
    return (await response.json() as { path_display: string }).path_display;
  }
}

/** Server-side write of a small generated file (the accountant's CSV log). */
export async function writeVatDropboxFile(token: string, path: string, content: string) {
  const response = await fetch(`${CONTENT}/2/files/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
      "Dropbox-API-Arg": apiArg({ path, mode: "overwrite", autorename: false, mute: true }),
    },
    body: Buffer.from(content, "utf8"),
    cache: "no-store",
  });
  if (!response.ok) throw classify(response.status, await response.text(), "Dropbox upload failed.");
}
