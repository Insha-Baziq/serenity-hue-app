import assert from "node:assert/strict";
import test from "node:test";
import { authorizeAssistantWrite } from "../lib/mcp-write-policy.ts";

const principal = {
  userId: "owner-1", clientId: "claude-client-1",
  scopes: ["assistant:read", "assistant:write:inventory"],
};
const policy = {
  writesEnabled: true, accountActive: true,
  allowedUserIds: ["owner-1"], allowedClientIds: ["claude-client-1"],
};

test("a current, scoped owner and approved client can invoke only their granted write area", () => {
  assert.deepEqual(authorizeAssistantWrite(principal, "set_physical_variant_stock", policy), { allowed: true });
  assert.deepEqual(authorizeAssistantWrite(principal, "create_lab_batch", policy), { allowed: false, reason: "scope_required" });
});

test("read-only, revoked, disabled, or removed connections cannot write", () => {
  assert.deepEqual(authorizeAssistantWrite({ ...principal, scopes: ["assistant:read"] }, "set_physical_variant_stock", policy), { allowed: false, reason: "scope_required" });
  assert.deepEqual(authorizeAssistantWrite(principal, "set_physical_variant_stock", { ...policy, allowedClientIds: [] }), { allowed: false, reason: "client_not_allowed" });
  assert.deepEqual(authorizeAssistantWrite(principal, "set_physical_variant_stock", { ...policy, allowedUserIds: [] }), { allowed: false, reason: "user_not_allowed" });
  assert.deepEqual(authorizeAssistantWrite(principal, "set_physical_variant_stock", { ...policy, accountActive: false }), { allowed: false, reason: "account_inactive" });
  assert.deepEqual(authorizeAssistantWrite(principal, "set_physical_variant_stock", { ...policy, writesEnabled: false }), { allowed: false, reason: "writes_disabled" });
});
