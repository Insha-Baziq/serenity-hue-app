import assert from "node:assert/strict";
import test from "node:test";
import { assertAssistantExpectedValue } from "../lib/mcp-write-preconditions.ts";

test("an assistant absolute write refuses to overwrite a newer value", () => {
  assert.doesNotThrow(() => assertAssistantExpectedValue(10, 10, "physical count"));
  assert.throws(() => assertAssistantExpectedValue(11, 10, "physical count"), /MCP_STALE_STATE/);
  assert.throws(() => assertAssistantExpectedValue("new title", "old title", "product title"), /MCP_STALE_STATE/);
  assert.doesNotThrow(() => assertAssistantExpectedValue(null, null, "unlinked product"));
});
