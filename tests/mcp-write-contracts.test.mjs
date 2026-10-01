import assert from "node:assert/strict";
import test from "node:test";
import { MCP_STAFF_WRITE_TOOLS, parseAssistantWriteInput } from "../lib/mcp-write-contracts.ts";

test("MCP names every current staff business write without a general database escape hatch", () => {
  const names = MCP_STAFF_WRITE_TOOLS.map((tool) => tool.name);
  assert.deepEqual(names, [
    "set_physical_variant_stock", "set_physical_variant_stocks",
    "rename_physical_product", "add_physical_variant", "update_physical_variant",
    "archive_physical_variant", "archive_physical_product",
    "create_packaging_material", "update_packaging_material", "archive_packaging_material",
    "set_channel_listing_mapping", "clear_channel_listing_mapping",
    "set_channel_product_link", "clear_channel_product_link",
    "create_lab_ingredient", "import_lab_ingredients", "update_lab_ingredient", "archive_lab_ingredient",
    "create_lab_formula", "set_lab_formula_packaging", "create_lab_batch", "record_lab_batch_packaging", "set_lab_batch_notes",
    "link_parcel2go_shipment", "invite_employee", "run_direct_channel_sync",
    "refresh_tiktok_inventory", "refresh_tiktok_ads_report",
    "start_tiktok_shop_connection", "start_tiktok_ads_connection",
  ]);
  for (const tool of MCP_STAFF_WRITE_TOOLS) {
    assert.match(tool.scope, /^assistant:write:/);
    assert.equal(tool.name.includes("sql"), false);
    assert.equal(tool.name.includes("code"), false);
  }
});

test("physical count command requires a current count and a retry key", () => {
  const valid = parseAssistantWriteInput("set_physical_variant_stock", {
    variantId: "variant-123", quantity: 12, expectedQuantity: 10, expectedQuantityKnown: true,
    idempotencyKey: "count-2026-09-30-variant-123", reason: "Shelf count",
  });
  assert.equal(valid.quantity, 12);
  assert.throws(() => parseAssistantWriteInput("set_physical_variant_stock", {
    variantId: "variant-123", quantity: 12, idempotencyKey: "count-2026-09-30-variant-123", reason: "Shelf count",
  }));
  assert.throws(() => parseAssistantWriteInput("set_physical_variant_stock", {
    variantId: "variant-123", quantity: -1, expectedQuantity: 10, expectedQuantityKnown: true,
    idempotencyKey: "count-2026-09-30-variant-123", reason: "Shelf count",
  }));
  assert.throws(() => parseAssistantWriteInput("set_physical_variant_stock", {
    variantId: "variant-123", quantity: 12, expectedQuantity: 10, expectedQuantityKnown: true,
    idempotencyKey: "count-2026-09-30-variant-123", reason: "Shelf count", sql: "UPDATE inventory SET quantity=12",
  }));
  assert.throws(() => parseAssistantWriteInput("set_physical_variant_stock", {
    variantId: "variant-123", quantity: 12, expectedQuantity: 10,
    idempotencyKey: "count-2026-09-30-variant-123", reason: "Shelf count",
  }));
});

test("batch creation requires the formula fill snapshot as well as the ingredient snapshot", () => {
  const input = {
    formulaId: "formula-123", batchNumber: "batch-123", targetGrams: 100,
    expectedFormulaRevision: "2026-09-30T00:00:00.000Z",
    expectedIngredients: [{ ingredientId: "ingredient-123", quantityGrams: 1000, quantityKnown: true }],
    idempotencyKey: "batch-123",
  };
  assert.throws(() => parseAssistantWriteInput("create_lab_batch", input));
  const parsed = parseAssistantWriteInput("create_lab_batch", {
    ...input, expectedFillQuantity: 10, expectedFillUnit: "g",
  });
  assert.equal(parsed.expectedFillQuantity, 10);
});
