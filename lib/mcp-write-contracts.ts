import { z } from "zod";

const id = z.string().trim().min(1).max(180);
const title = z.string().trim().min(2).max(180);
const quantity = z.number().int().nonnegative().safe();
const grams = z.number().finite().nonnegative().max(1_000_000_000);
const positiveGrams = grams.refine((value) => value > 0);
const note = z.string().trim().min(2).max(400);
const revision = z.string().trim().min(1).max(80);
const idempotencyKey = z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/);
const retry = { idempotencyKey };
const channel = z.enum(["shopify", "tiktok"]);
const fillUnit = z.enum(["g", "ml"]);
const expectedTitle = z.string().trim().min(1).max(180);

const stockRow = z.object({ variantId: id, quantity, expectedQuantity: quantity, expectedQuantityKnown: z.boolean() }).strict();
const mappingComponent = z.object({ physicalVariantId: id, quantityPerSale: z.number().int().positive().max(10_000) }).strict();
const listingMapping = z.object({ listingId: id, components: z.array(mappingComponent).max(12), expectedListingRevision: revision }).strict();
const formulaLine = z.object({
  ingredient: title,
  calculation: z.enum(["fixed", "remainder", "manual"]),
  percentage: z.number().positive().max(100).optional(),
  phase: z.string().trim().max(40).optional(),
  note: z.string().trim().max(500).optional(),
}).strict();
const ingredientSnapshot = z.object({ ingredientId: id, quantityGrams: grams, quantityKnown: z.boolean() }).strict();

export const MCP_WRITE_SCOPES = [
  "assistant:write:inventory", "assistant:write:packaging", "assistant:write:mappings",
  "assistant:write:labs", "assistant:write:shipments", "assistant:write:team",
  "assistant:write:integrations", "assistant:write:connections",
] as const;

export type AssistantWriteScope = typeof MCP_WRITE_SCOPES[number];

const tools = {
  set_physical_variant_stock: {
    scope: "assistant:write:inventory",
    schema: z.object({ variantId: id, quantity, expectedQuantity: quantity, expectedQuantityKnown: z.boolean(), reason: note, ...retry }).strict(),
  },
  set_physical_variant_stocks: {
    scope: "assistant:write:inventory",
    schema: z.object({ adjustments: z.array(stockRow).min(1).max(50), reason: note, ...retry }).strict()
      .refine((value) => new Set(value.adjustments.map((row) => row.variantId)).size === value.adjustments.length,
        "Each physical variant may appear only once"),
  },
  rename_physical_product: {
    scope: "assistant:write:inventory",
    schema: z.object({ itemId: id, title, expectedTitle, ...retry }).strict(),
  },
  add_physical_variant: {
    scope: "assistant:write:inventory",
    schema: z.object({ itemId: id, title, sku: z.string().trim().max(120).nullable().optional(), expectedProductRevision: revision, ...retry }).strict(),
  },
  update_physical_variant: {
    scope: "assistant:write:inventory",
    schema: z.object({ variantId: id, title, sku: z.string().trim().max(120).nullable().optional(), expectedVariantRevision: revision, ...retry }).strict(),
  },
  archive_physical_variant: {
    scope: "assistant:write:inventory",
    schema: z.object({ variantId: id, expectedVariantRevision: revision, ...retry }).strict(),
  },
  archive_physical_product: {
    scope: "assistant:write:inventory",
    schema: z.object({ itemId: id, expectedProductRevision: revision, ...retry }).strict(),
  },
  create_packaging_material: {
    scope: "assistant:write:packaging",
    schema: z.object({ title, quantity, ...retry }).strict(),
  },
  update_packaging_material: {
    scope: "assistant:write:packaging",
    schema: z.object({ id, title, quantity, expectedTitle, expectedQuantity: quantity, ...retry }).strict(),
  },
  archive_packaging_material: {
    scope: "assistant:write:packaging",
    schema: z.object({ id, expectedTitle, ...retry }).strict(),
  },
  set_channel_listing_mapping: {
    scope: "assistant:write:mappings",
    schema: z.object({ mappings: z.array(listingMapping).min(1).max(50), listingKind: z.enum(["individual", "bundle"]).optional(), ...retry }).strict()
      .refine((value) => new Set(value.mappings.map((row) => row.listingId)).size === value.mappings.length,
        "Each listing may appear only once"),
  },
  clear_channel_listing_mapping: {
    scope: "assistant:write:mappings",
    schema: z.object({ listingId: id, expectedListingRevision: revision, ...retry }).strict(),
  },
  set_channel_product_link: {
    scope: "assistant:write:mappings",
    schema: z.object({ channel, externalProductId: id, physicalItemId: id, expectedPhysicalItemId: id.nullable(), ...retry }).strict(),
  },
  clear_channel_product_link: {
    scope: "assistant:write:mappings",
    schema: z.object({ channel, externalProductId: id, expectedPhysicalItemId: id, ...retry }).strict(),
  },
  create_lab_ingredient: {
    scope: "assistant:write:labs",
    schema: z.object({ title, quantityGrams: grams.optional(), reorderPointGrams: grams.optional(), ...retry }).strict(),
  },
  import_lab_ingredients: {
    scope: "assistant:write:labs",
    schema: z.object({ csv: z.string().min(1).max(40_000), ...retry }).strict(),
  },
  update_lab_ingredient: {
    scope: "assistant:write:labs",
    schema: z.object({ id, quantityGrams: grams, reorderPointGrams: grams.optional(), expectedQuantityGrams: grams, ...retry }).strict(),
  },
  archive_lab_ingredient: {
    scope: "assistant:write:labs",
    schema: z.object({ id, expectedTitle, ...retry }).strict(),
  },
  create_lab_formula: {
    scope: "assistant:write:labs",
    schema: z.object({ title, subtitle: z.string().trim().max(200).optional(), notes: z.string().trim().max(1400).optional(), lines: z.array(formulaLine).min(1).max(100), ...retry }).strict(),
  },
  set_lab_formula_packaging: {
    scope: "assistant:write:labs",
    schema: z.object({ formulaId: id, fillQuantity: positiveGrams, fillUnit, expectedFillQuantity: grams.nullable(), expectedFillUnit: fillUnit.nullable(), ...retry }).strict(),
  },
  create_lab_batch: {
    scope: "assistant:write:labs",
    schema: z.object({ formulaId: id, batchNumber: z.string().trim().min(1).max(80), targetGrams: positiveGrams, outputQuantity: positiveGrams.optional(), outputUnit: fillUnit.optional(), expectedFormulaRevision: revision, expectedFillQuantity: grams.nullable(), expectedFillUnit: fillUnit.nullable(), expectedIngredients: z.array(ingredientSnapshot).min(1).max(100), ...retry }).strict()
      .refine((value) => new Set(value.expectedIngredients.map((row) => row.ingredientId)).size === value.expectedIngredients.length,
        "Each ingredient may appear only once"),
  },
  record_lab_batch_packaging: {
    scope: "assistant:write:labs",
    schema: z.object({ batchId: id, addedQuantity: positiveGrams, expectedPackagedQuantity: grams, ...retry }).strict(),
  },
  set_lab_batch_notes: {
    scope: "assistant:write:labs",
    schema: z.object({ batchId: id, notes: z.string().max(4_000), expectedUpdatedAt: revision, ...retry }).strict(),
  },
  link_parcel2go_shipment: {
    scope: "assistant:write:shipments",
    schema: z.object({ orderId: id, shipmentId: id, expectedShipmentOrderId: id.nullable(), ...retry }).strict(),
  },
  invite_employee: {
    scope: "assistant:write:team",
    schema: z.object({ name: title, email: z.email().max(254), ...retry }).strict(),
  },
  run_direct_channel_sync: {
    scope: "assistant:write:integrations",
    schema: z.object({ ...retry }).strict(),
  },
  refresh_tiktok_inventory: {
    scope: "assistant:write:integrations",
    schema: z.object({ ...retry }).strict(),
  },
  refresh_tiktok_ads_report: {
    scope: "assistant:write:integrations",
    schema: z.object({ ...retry }).strict(),
  },
  start_tiktok_shop_connection: {
    scope: "assistant:write:connections",
    schema: z.object({ ...retry }).strict(),
  },
  start_tiktok_ads_connection: {
    scope: "assistant:write:connections",
    schema: z.object({ ...retry }).strict(),
  },
} as const satisfies Record<string, { scope: AssistantWriteScope; schema: z.ZodType }>;

export type AssistantWriteToolName = keyof typeof tools;

export const MCP_STAFF_WRITE_TOOLS = Object.entries(tools).map(([name, definition]) => ({
  name: name as AssistantWriteToolName,
  scope: definition.scope,
  schema: definition.schema,
}));

export function parseAssistantWriteInput<N extends AssistantWriteToolName>(name: N, input: unknown): z.output<(typeof tools)[N]["schema"]> {
  const definition = tools[name];
  if (!definition) throw new Error("Unknown staff write command");
  return definition.schema.parse(input) as z.output<(typeof tools)[N]["schema"]>;
}
