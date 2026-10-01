import assert from "node:assert/strict";
import test from "node:test";
import { parseMcpOAuthScopes } from "../lib/mcp-oauth-scopes.ts";

test("write grants require an enabled, explicit OAuth request and retain only requested scopes", () => {
  assert.deepEqual(parseMcpOAuthScopes("assistant:write:inventory offline_access", { allowPii: false, allowWrite: true }),
    ["assistant:read", "assistant:write:inventory", "offline_access"]);
  assert.deepEqual(parseMcpOAuthScopes(null, { allowPii: false, allowWrite: true }), ["assistant:read"]);
  assert.throws(() => parseMcpOAuthScopes("assistant:write:inventory", { allowPii: false, allowWrite: false }));
  assert.throws(() => parseMcpOAuthScopes("assistant:write:sql", { allowPii: false, allowWrite: true }));
  assert.throws(() => parseMcpOAuthScopes("assistant:pii", { allowPii: false, allowWrite: true }));
});
