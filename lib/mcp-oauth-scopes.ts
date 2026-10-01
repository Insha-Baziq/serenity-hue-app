import { MCP_WRITE_SCOPES } from "./mcp-write-contracts.ts";

export const MCP_BASE_SCOPES = ["assistant:read", "assistant:pii", "offline_access"] as const;
export const MCP_OAUTH_SCOPES = [...MCP_BASE_SCOPES, ...MCP_WRITE_SCOPES] as const;
export type McpOAuthScope = typeof MCP_OAUTH_SCOPES[number];

export function parseMcpOAuthScopes(
  value: string | null | undefined,
  policy: { allowPii: boolean; allowWrite: boolean },
): McpOAuthScope[] {
  const scopes = [...new Set((value ?? "assistant:read").split(/[\s,]+/).filter(Boolean))];
  if (!scopes.includes("assistant:read")) scopes.unshift("assistant:read");
  for (const scope of scopes) {
    if (!(MCP_OAUTH_SCOPES as readonly string[]).includes(scope)) throw new Error("Unsupported OAuth scope.");
    if (scope === "assistant:pii" && !policy.allowPii) throw new Error("The PII scope is not enabled.");
    if (scope.startsWith("assistant:write:") && !policy.allowWrite) throw new Error("MCP writes are not enabled.");
  }
  return scopes as McpOAuthScope[];
}
