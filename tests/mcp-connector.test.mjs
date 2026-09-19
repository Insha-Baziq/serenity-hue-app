import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ASSISTANT_DATASET_IDS, DATASET_REGISTRY, assistantQueryRequestSchema, publicDatasetCatalog } from "../lib/mcp-contracts.ts";

test("MCP registry contains the approved business domains and no authentication datasets", () => {
  assert.deepEqual(ASSISTANT_DATASET_IDS, [
    "sales", "orders", "order_items", "customers", "shipments", "employees", "inventory", "physical_inventory",
    "channel_inventory", "channel_listings", "inventory_history", "packaging", "labs", "affiliate_reporting", "ads_reporting", "alerts", "sync_status",
  ]);
  const catalog = JSON.stringify(publicDatasetCatalog(false));
  for (const forbidden of ["password", "refresh_token", "access_token", "database_credentials", "environment_variables", "sync_leases", "raw_provider_json"]) {
    assert.equal(catalog.includes(forbidden), false, `forbidden field leaked into the registry: ${forbidden}`);
  }
  assert.ok(DATASET_REGISTRY.orders.fields.shipping_address_json);
  assert.equal(DATASET_REGISTRY.orders.fields.shipping_address_json.sensitivity, "pii");
  for (const definition of Object.values(DATASET_REGISTRY)) assert.equal(definition.fields.id.sortable, true, `${definition.id} must expose id as a safe sort key`);
});

test("query contract rejects SQL-shaped top-level input while keeping values data-only", () => {
  assert.throws(() => assistantQueryRequestSchema.parse({ dataset: "orders", sql: "SELECT * FROM orders" }));
  const parsed = assistantQueryRequestSchema.parse({
    dataset: "orders",
    filters: [{ field: "order_number", operator: "contains", value: "' OR 1=1 --" }],
    pageSize: 50,
  });
  assert.equal(parsed.filters[0].value, "' OR 1=1 --");
});

test("MCP implementation has no import path into the mutation-heavy repository", async () => {
  const source = await readFile(new URL("../lib/assistant-read-repository.ts", import.meta.url), "utf8");
  const server = await readFile(new URL("../lib/mcp-server.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /@\/lib\/repository|ensureLabsData|ensurePhysicalChannelListings|takeSyncLease|storeTikTok/i);
  assert.doesNotMatch(server, /@\/lib\/repository|takeSyncLease|storeTikTok/i);
  assert.doesNotMatch(
    source,
    /\b(?:INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|ALTER\s+(?:TABLE|DATABASE)|CREATE\s+(?:TABLE|INDEX|TRIGGER)|DROP\s+(?:TABLE|INDEX)|PRAGMA\b|ATTACH\s+DATABASE)/i,
  );
});

test("MCP authentication supports explicit all-authenticated-user mode without weakening the fail-closed policy", async () => {
  const source = await readFile(new URL("../lib/mcp-auth.ts", import.meta.url), "utf8");
  assert.match(source, /MCP_ALLOW_ALL_AUTHENTICATED_USERS/);
  assert.match(source, /Configure either MCP_ALLOWED_USER_ID or MCP_ALLOW_ALL_AUTHENTICATED_USERS/);
  assert.match(source, /if \(allowedUserId && session\.user\.id !== allowedUserId\) return null/);
  assert.match(source, /config\.allowedUserId && String\(row\.user_id\) !== config\.allowedUserId/);
});

test("MCP consent avoids CSP-blocked external form redirects", async () => {
  const source = await readFile(new URL("../app/api/mcp/oauth/authorize/route.ts", import.meta.url), "utf8");
  assert.match(source, /function authorizationRedirectPage\(target: string\)/);
  assert.match(source, /window\.location\.replace/);
  assert.match(source, /script-src 'nonce-/);
  assert.match(source, /return authorizationRedirectPage\(deniedRedirect/);
  assert.match(source, /return authorizationRedirectPage\(safeExternalRedirect/);
  assert.doesNotMatch(source, /return redirectNoStore\(deniedRedirect/);
  assert.doesNotMatch(source, /return redirectNoStore\(safeExternalRedirect/);
});
