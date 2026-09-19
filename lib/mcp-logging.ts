import "server-only";

import { createHash, createHmac, randomUUID } from "node:crypto";

/**
 * Connector logs are intentionally a small security-event stream, not an audit
 * database. Keep this payload allow-listed: never add prompts, query values,
 * tokens, codes, provider responses, or returned rows.
 */
export type McpLogEvent = {
  event: string;
  success: boolean;
  reasonCode?: string;
  requestId?: string;
  clientId?: string | null;
  userId?: string | null;
  dataset?: string;
  registryVersion?: string;
  toolName?: string;
  statusCode?: number;
  rowCount?: number;
  durationMs?: number;
  truncated?: boolean;
};

function logKey() {
  const configured = process.env.MCP_OAUTH_SECRET?.trim();
  return configured || createHash("sha256").update(`serenity-hue-mcp:${process.cwd()}:development`).digest("hex");
}

function identifier(value: string | null | undefined) {
  if (!value) return undefined;
  return createHmac("sha256", logKey()).update(value).digest("hex").slice(0, 24);
}

export function mcpRequestId(request?: Request) {
  const supplied = request?.headers.get("x-request-id")?.trim();
  return supplied && /^[A-Za-z0-9._:-]{1,120}$/.test(supplied) ? supplied : randomUUID();
}

export function logMcpEvent(input: McpLogEvent) {
  const payload = {
    timestamp: new Date().toISOString(),
    service: "serenity-hue-remote-mcp",
    event: input.event,
    success: input.success,
    reasonCode: input.reasonCode,
    requestId: input.requestId,
    clientIdHash: identifier(input.clientId),
    userIdHash: identifier(input.userId),
    dataset: input.dataset,
    registryVersion: input.registryVersion,
    toolName: input.toolName,
    statusCode: input.statusCode,
    rowCount: input.rowCount,
    durationMs: input.durationMs,
    truncated: input.truncated,
  };
  console.info(JSON.stringify(Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined))));
}
