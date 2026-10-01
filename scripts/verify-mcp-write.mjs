import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, relative, basename } from "node:path";
import { createClient } from "@libsql/client";

const root = process.cwd();
const temporary = await mkdtemp(join(tmpdir(), "serenity-mcp-write-"));
const database = join(temporary, "verification.db").replaceAll("\\", "/");
const port = 31017;
const origin = `http://127.0.0.1:${port}`;
const resource = `${origin}/api/mcp`;
const secret = randomBytes(32).toString("hex");
const owner = "verification-owner";
const clientId = "verification-claude";
const writeToken = randomBytes(32).toString("base64url");
const readToken = randomBytes(32).toString("base64url");
const db = createClient({ url: `file:${database}` });
let server;

function tokenHash(token) { return createHmac("sha256", secret).update(token).digest("hex"); }
async function mcp(token, method, params, id = 1) {
  const response = await fetch(resource, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const body = await response.text();
  assert.equal(response.status, 200, body);
  return JSON.parse(body);
}

try {
  await db.executeMultiple(await readFile(join(root, "database", "schema.sql"), "utf8"));
  const now = new Date().toISOString();
  await db.execute({ sql: `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, 'Verification owner', 'owner@example.test', 1, ?, ?)`, args: [owner, now, now] });
  await db.execute({ sql: `INSERT INTO "account" (id, accountId, providerId, userId, createdAt, updatedAt) VALUES ('verification-account', ?, 'credential', ?, ?, ?)`, args: [owner, owner, now, now] });
  await db.execute({ sql: `INSERT INTO mcp_oauth_clients (client_id, client_name, redirect_uris_json) VALUES (?, 'Verification Claude', '[]')`, args: [clientId] });
  for (const [token, scope] of [[writeToken, "assistant:read assistant:write:inventory assistant:write:packaging assistant:write:mappings assistant:write:labs assistant:write:shipments assistant:write:team"], [readToken, "assistant:read"]]) {
    await db.execute({ sql: `INSERT INTO mcp_oauth_tokens (token_hash, token_kind, client_id, user_id, scope, resource, audience, token_family_id, expires_at) VALUES (?, 'access', ?, ?, ?, ?, ?, ?, ?)`, args: [tokenHash(token), clientId, owner, scope, resource, resource, randomBytes(8).toString("hex"), new Date(Date.now() + 60 * 60 * 1000).toISOString()] });
  }
  await db.execute({ sql: `INSERT INTO physical_inventory_items (id, title, quantity, quantity_known, created_at, updated_at) VALUES ('verification-item', 'Verification product', 5, 1, ?, ?)`, args: [now, now] });
  await db.execute({ sql: `INSERT INTO physical_inventory_variants (id, physical_item_id, title, quantity, quantity_known, created_at, updated_at) VALUES ('verification-variant', 'verification-item', 'Default', 5, 1, ?, ?)`, args: [now, now] });
  await db.execute({ sql: `INSERT INTO physical_channel_listings (id, channel, external_product_id, title, listing_kind, created_at, updated_at) VALUES ('verification-listing', 'shopify', 'verification-external', 'Verification listing', 'individual', ?, ?)`, args: [now, now] });
  await db.execute({ sql: `INSERT INTO orders (id, source, source_order_id, order_number, source_created_at) VALUES ('verification-order', 'shopify', 'verification-source-order', 'TEST-1', ?)`, args: [now] });
  await db.execute({ sql: `INSERT INTO shipments (id, provider, external_order_line_id) VALUES ('verification-shipment', 'parcel2go', 'verification-shipment-line')`, args: [] });

  const env = {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: "1", TURSO_DATABASE_URL: `file:${database}`, TURSO_AUTH_TOKEN: "local-verification-token", TURSO_AUTO_MIGRATE: "false",
    MCP_ENABLED: "true", MCP_WRITE_ENABLED: "true", MCP_ALLOWED_USER_ID: owner,
    MCP_WRITE_ALLOWED_USER_IDS: owner, MCP_WRITE_ALLOWED_CLIENT_IDS: clientId,
    MCP_READ_DATABASE_URL: `file:${database}`, MCP_READ_DATABASE_ENFORCED: "true",
    MCP_OAUTH_SECRET: secret, MCP_ISSUER_URL: origin, MCP_RESOURCE_URL: resource, BETTER_AUTH_URL: origin, APP_URL: origin,
  };
  server = spawn(process.execPath, [join(root, "node_modules", "next", "dist", "bin", "next"), "dev", "--port", String(port)], { cwd: root, env, stdio: "ignore", windowsHide: true });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Next dev exited with ${server.exitCode}`);
    try { const response = await fetch(`${origin}/login`); if (response.ok) { ready = true; break; } } catch { /* still booting */ }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert.ok(ready, "Next dev did not start");

  const readList = await mcp(readToken, "tools/list", {}, 1);
  assert.equal(readList.result.tools.some((tool) => tool.name === "set_physical_variant_stock"), false);
  const denied = await mcp(readToken, "tools/call", { name: "set_physical_variant_stock", arguments: { variantId: "verification-variant" } }, 11);
  assert.equal(denied.result.isError, true);
  const writeList = await mcp(writeToken, "tools/list", {}, 2);
  assert.equal(writeList.result.tools.some((tool) => tool.name === "set_physical_variant_stock"), true);

  const args = { variantId: "verification-variant", quantity: 7, expectedQuantity: 5, expectedQuantityKnown: true, reason: "Verification shelf count", idempotencyKey: "verification-stock-1" };
  const first = await mcp(writeToken, "tools/call", { name: "set_physical_variant_stock", arguments: args }, 3);
  assert.equal(first.result.isError, undefined, JSON.stringify(first));
  assert.equal(first.result.structuredContent.replayed, false);
  const replay = await mcp(writeToken, "tools/call", { name: "set_physical_variant_stock", arguments: args }, 4);
  assert.equal(replay.result.structuredContent.replayed, true);
  const stale = await mcp(writeToken, "tools/call", { name: "set_physical_variant_stock", arguments: { ...args, quantity: 8, idempotencyKey: "verification-stock-2" } }, 5);
  assert.equal(stale.result.isError, true);
  assert.match(JSON.stringify(stale), /MCP_STALE_STATE/);
  const row = (await db.execute("SELECT quantity FROM physical_inventory_variants WHERE id = 'verification-variant'")).rows[0];
  assert.equal(Number(row.quantity), 7);
  const ledger = await db.execute("SELECT COUNT(*) AS count FROM physical_inventory_ledger WHERE physical_item_id = 'verification-item'");
  assert.equal(Number(ledger.rows[0].count), 1);
  const activity = await db.execute("SELECT details_json FROM application_activity_log WHERE event_name = 'inventory.physical.updated' ORDER BY occurred_at DESC LIMIT 1");
  assert.ok(activity.rows.length > 0, "Assistant activity must be recorded");
  assert.match(String(activity.rows[0].details_json), /assistantClientId/);
  const packaging = await mcp(writeToken, "tools/call", { name: "create_packaging_material", arguments: { title: "Verification pouch", quantity: 10, idempotencyKey: "verification-packaging-create" } }, 13);
  assert.equal(packaging.result.isError, undefined, JSON.stringify(packaging));
  const packagingId = packaging.result.structuredContent.id;
  const updatedPackaging = await mcp(writeToken, "tools/call", { name: "update_packaging_material", arguments: { id: packagingId, title: "Verification pouch", quantity: 12, expectedTitle: "Verification pouch", expectedQuantity: 10, idempotencyKey: "verification-packaging-update" } }, 14);
  assert.equal(updatedPackaging.result.isError, undefined, JSON.stringify(updatedPackaging));
  assert.equal(Number((await db.execute({ sql: "SELECT quantity FROM packaging_materials WHERE id = ?", args: [packagingId] })).rows[0].quantity), 12);

  const ingredient = await mcp(writeToken, "tools/call", { name: "create_lab_ingredient", arguments: { title: "Verification clay 2026", quantityGrams: 1000, idempotencyKey: "verification-ingredient-create" } }, 15);
  assert.equal(ingredient.result.isError, undefined, JSON.stringify(ingredient));
  const ingredientId = ingredient.result.structuredContent.created[0].id;
  const formula = await mcp(writeToken, "tools/call", { name: "create_lab_formula", arguments: { title: "Verification formula 2026", lines: [{ ingredient: "Verification clay 2026", calculation: "fixed", percentage: 100 }], idempotencyKey: "verification-formula-create" } }, 16);
  assert.equal(formula.result.isError, undefined, JSON.stringify(formula));
  const formulaId = formula.result.structuredContent.formulaId;
  const fill = await mcp(writeToken, "tools/call", { name: "set_lab_formula_packaging", arguments: { formulaId, fillQuantity: 10, fillUnit: "g", expectedFillQuantity: null, expectedFillUnit: null, idempotencyKey: "verification-formula-fill" } }, 17);
  assert.equal(fill.result.isError, undefined, JSON.stringify(fill));
  const formulaRevision = (await db.execute({ sql: "SELECT updated_at FROM lab_formulas WHERE id = ?", args: [formulaId] })).rows[0].updated_at;
  const staleFill = await mcp(writeToken, "tools/call", { name: "create_lab_batch", arguments: { formulaId, batchNumber: "verification-stale-fill", targetGrams: 100, expectedFormulaRevision: String(formulaRevision), expectedFillQuantity: 9, expectedFillUnit: "g", expectedIngredients: [{ ingredientId, quantityGrams: 1000, quantityKnown: true }], idempotencyKey: "verification-batch-stale-fill" } }, 171);
  assert.equal(staleFill.result.isError, true);
  assert.match(JSON.stringify(staleFill), /MCP_STALE_STATE/);
  const batch = await mcp(writeToken, "tools/call", { name: "create_lab_batch", arguments: { formulaId, batchNumber: "verification-batch-2026", targetGrams: 100, outputQuantity: 100, outputUnit: "g", expectedFormulaRevision: String(formulaRevision), expectedFillQuantity: 10, expectedFillUnit: "g", expectedIngredients: [{ ingredientId, quantityGrams: 1000, quantityKnown: true }], idempotencyKey: "verification-batch-create" } }, 18);
  assert.equal(batch.result.isError, undefined, JSON.stringify(batch));
  assert.equal(batch.result.structuredContent.deductions[0].status, "deducted");
  const batchId = batch.result.structuredContent.id;
  const packaged = await mcp(writeToken, "tools/call", { name: "record_lab_batch_packaging", arguments: { batchId, addedQuantity: 50, expectedPackagedQuantity: 0, idempotencyKey: "verification-batch-packaging" } }, 19);
  assert.equal(packaged.result.isError, undefined, JSON.stringify(packaged));
  assert.equal(Number((await db.execute({ sql: "SELECT quantity_grams FROM lab_ingredients WHERE id = ?", args: [ingredientId] })).rows[0].quantity_grams), 900);
  assert.equal(Number((await db.execute({ sql: "SELECT packaged_quantity FROM lab_batch_allocations WHERE batch_id = ?", args: [batchId] })).rows[0].packaged_quantity), 50);
  const batchUpdatedAt = String((await db.execute({ sql: "SELECT updated_at FROM lab_batches WHERE id = ?", args: [batchId] })).rows[0].updated_at);
  const notes = await mcp(writeToken, "tools/call", { name: "set_lab_batch_notes", arguments: { batchId, notes: "First observation\n\nCheck fill again tomorrow.", expectedUpdatedAt: batchUpdatedAt, idempotencyKey: "verification-batch-notes" } }, 191);
  assert.equal(notes.result.isError, undefined, JSON.stringify(notes));
  assert.equal(notes.result.structuredContent.notes, "First observation\n\nCheck fill again tomorrow.");
  assert.notEqual(notes.result.structuredContent.updatedAt, batchUpdatedAt);
  const staleNotes = await mcp(writeToken, "tools/call", { name: "set_lab_batch_notes", arguments: { batchId, notes: "Stale replacement", expectedUpdatedAt: batchUpdatedAt, idempotencyKey: "verification-batch-notes-stale" } }, 192);
  assert.equal(staleNotes.result.isError, true);
  assert.equal(String((await db.execute({ sql: "SELECT notes FROM lab_batches WHERE id = ?", args: [batchId] })).rows[0].notes), "First observation\n\nCheck fill again tomorrow.");

  const mapping = await mcp(writeToken, "tools/call", { name: "set_channel_listing_mapping", arguments: { mappings: [{ listingId: "verification-listing", components: [{ physicalVariantId: "verification-variant", quantityPerSale: 1 }], expectedListingRevision: now }], listingKind: "individual", idempotencyKey: "verification-listing-map" } }, 20);
  assert.equal(mapping.result.isError, undefined, JSON.stringify(mapping));
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS count FROM physical_listing_components WHERE listing_id = 'verification-listing'")).rows[0].count), 1);
  const shipment = await mcp(writeToken, "tools/call", { name: "link_parcel2go_shipment", arguments: { orderId: "verification-order", shipmentId: "verification-shipment", expectedShipmentOrderId: null, idempotencyKey: "verification-shipment-link" } }, 21);
  assert.equal(shipment.result.isError, undefined, JSON.stringify(shipment));
  assert.equal(String((await db.execute("SELECT order_id FROM shipments WHERE id = 'verification-shipment'")).rows[0].order_id), "verification-order");
  const invitation = await mcp(writeToken, "tools/call", { name: "invite_employee", arguments: { name: "Verification employee", email: "employee@example.test", idempotencyKey: "verification-invite-1" } }, 12);
  assert.equal(invitation.result.isError, undefined, JSON.stringify(invitation));
  const setupUrl = invitation.result.structuredContent.setupUrl;
  assert.equal((await fetch(setupUrl)).status, 200);
  const inviteToken = new URL(setupUrl).pathname.split("/").pop();
  const storedInvitation = await db.execute({ sql: "SELECT token_hash FROM employee_invitations WHERE user_id = ?", args: [invitation.result.structuredContent.employeeId] });
  assert.equal(String(storedInvitation.rows[0].token_hash), createHash("sha256").update(inviteToken).digest("hex"));
  const savedResult = await db.execute({ sql: "SELECT result_json FROM mcp_write_operations WHERE idempotency_key = 'verification-invite-1'", args: [] });
  assert.doesNotMatch(String(savedResult.rows[0].result_json), new RegExp(inviteToken));
  const inviteReplay = await mcp(writeToken, "tools/call", { name: "invite_employee", arguments: { name: "Verification employee", email: "employee@example.test", idempotencyKey: "verification-invite-1" } }, 22);
  assert.equal(inviteReplay.result.structuredContent.setupUrl, undefined);
  const reissued = await mcp(writeToken, "tools/call", { name: "invite_employee", arguments: { name: "Verification employee", email: "employee@example.test", idempotencyKey: "verification-invite-2" } }, 23);
  assert.equal(reissued.result.isError, undefined, JSON.stringify(reissued));
  const newToken = new URL(reissued.result.structuredContent.setupUrl).pathname.split("/").pop();
  assert.notEqual(newToken, inviteToken);
  const oldLink = await fetch(`${origin}/api/employees/accept-invite`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: inviteToken, password: "VerificationPassword2026!", confirmation: "VerificationPassword2026!" }) });
  assert.equal(oldLink.status, 410);
  const accepted = await fetch(`${origin}/api/employees/accept-invite`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: newToken, password: "VerificationPassword2026!", confirmation: "VerificationPassword2026!" }) });
  assert.equal(accepted.status, 200, await accepted.text());
  const repeated = await fetch(`${origin}/api/employees/accept-invite`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: newToken, password: "VerificationPassword2026!", confirmation: "VerificationPassword2026!" }) });
  assert.equal(repeated.status, 410);
  const credential = await db.execute({ sql: `SELECT password FROM "account" WHERE userId = ?`, args: [invitation.result.structuredContent.employeeId] });
  assert.equal(credential.rows.length, 1);
  assert.notEqual(String(credential.rows[0].password), "VerificationPassword2026!");
  await db.execute({ sql: "UPDATE mcp_oauth_tokens SET revoked_at = ? WHERE token_hash = ?", args: [new Date().toISOString(), tokenHash(writeToken)] });
  const revoked = await fetch(resource, { method: "POST", headers: { authorization: `Bearer ${writeToken}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 6, method: "tools/list", params: {} }) });
  assert.equal(revoked.status, 401);
  process.stdout.write("MCP write verification passed: scope isolation, inventory, packaging, Labs, mappings, shipment, invitation, replay, stale rejection, activity, revocation.\n");
} finally {
  if (server && server.exitCode === null) { server.kill(); await once(server, "exit"); }
  await db.close();
  const resolvedTemporary = resolve(temporary);
  const relativeToTemp = relative(resolve(tmpdir()), resolvedTemporary);
  if (!relativeToTemp.startsWith("..") && !relativeToTemp.includes("..") && basename(resolvedTemporary).startsWith("serenity-mcp-write-")) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try { await rm(resolvedTemporary, { recursive: true, force: true }); break; }
      catch (error) {
        if (attempt === 7 || !["EBUSY", "EPERM"].includes(error?.code)) {
          process.stderr.write(`Verification database cleanup skipped: ${error?.code ?? "unknown"}\n`);
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }
}
