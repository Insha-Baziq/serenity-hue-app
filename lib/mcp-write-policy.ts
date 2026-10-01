import { MCP_STAFF_WRITE_TOOLS, type AssistantWriteToolName } from "./mcp-write-contracts.ts";

export type AssistantWritePrincipal = {
  userId: string;
  clientId: string;
  scopes: readonly string[];
};

export type AssistantWritePolicy = {
  writesEnabled: boolean;
  accountActive: boolean;
  allowedUserIds: readonly string[];
  allowedClientIds: readonly string[];
};

export type AssistantWriteDecision =
  | { allowed: true }
  | { allowed: false; reason: "writes_disabled" | "account_inactive" | "user_not_allowed" | "client_not_allowed" | "scope_required" };

export function authorizeAssistantWrite(
  principal: AssistantWritePrincipal,
  toolName: AssistantWriteToolName,
  policy: AssistantWritePolicy,
): AssistantWriteDecision {
  if (!policy.writesEnabled) return { allowed: false, reason: "writes_disabled" };
  if (!policy.accountActive) return { allowed: false, reason: "account_inactive" };
  if (!policy.allowedUserIds.includes(principal.userId)) return { allowed: false, reason: "user_not_allowed" };
  if (!policy.allowedClientIds.includes(principal.clientId)) return { allowed: false, reason: "client_not_allowed" };
  const tool = MCP_STAFF_WRITE_TOOLS.find((entry) => entry.name === toolName);
  if (!tool || !principal.scopes.includes(tool.scope)) return { allowed: false, reason: "scope_required" };
  return { allowed: true };
}
