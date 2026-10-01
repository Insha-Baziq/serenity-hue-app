import "server-only";

import { getCanonicalAppUrl } from "@/lib/auth";
import { mcpWriteAllowedClientIds, mcpWriteAllowedUserIds, mcpWriteEnabled } from "@/lib/mcp-auth";
import { MCP_STAFF_WRITE_TOOLS, parseAssistantWriteInput, type AssistantWriteToolName } from "@/lib/mcp-write-contracts";
import { authorizeAssistantWrite, type AssistantWritePrincipal } from "@/lib/mcp-write-policy";
import { executeMcpWriteOnce } from "@/lib/mcp-write-operation";
import { enforceMcpWriteRateLimit } from "@/lib/mcp-rate-limit";
import { getTursoClient } from "@/lib/turso";
import { parseLabIngredientCsv } from "@/lib/lab-ingredient-csv";
import { randomUUID } from "node:crypto";
import type { ActivityActor } from "@/lib/types";
import {
  addPhysicalInventoryVariant, applyPhysicalInventoryAdjustments, createLabBatch,
  createLabFormula, createLabIngredients, createPackagingMaterial,
  deleteLabIngredient, deletePackagingMaterial, deletePhysicalInventoryVariant,
  deletePhysicalProduct, ensurePhysicalChannelListings, getPhysicalChannelListings,
  inviteEmployee, linkParcel2GoShipment, recordActivityEvent, savePhysicalChannelProductLink,
  savePhysicalListingMappings, updateLabBatchPackaging, updateLabFormulaPackaging,
  updateLabBatchNotes, updateLabIngredient, updatePackagingMaterial, updatePhysicalInventoryVariant,
  updatePhysicalProduct,
} from "@/lib/repository";
import { syncDirectChannels } from "@/lib/sync";
import { storeTikTokInventory } from "@/lib/tiktok-inventory";
import { refreshTikTokAdsReporting } from "@/lib/tiktok-ads-import";

type WriteArguments = Record<string, unknown> & { idempotencyKey: string };

function outcome(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return { ok: true };
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return { value };
}

async function performWrite(name: AssistantWriteToolName, raw: unknown, actor: ActivityActor): Promise<Record<string, unknown>> {
  switch (name) {
    case "set_physical_variant_stock": {
      const input = parseAssistantWriteInput(name, raw);
      return outcome(await applyPhysicalInventoryAdjustments({ adjustments: [{ variantId: input.variantId, quantity: input.quantity, expectedQuantity: input.expectedQuantity, expectedQuantityKnown: input.expectedQuantityKnown }], note: input.reason, actor }));
    }
    case "set_physical_variant_stocks": {
      const input = parseAssistantWriteInput(name, raw);
      return outcome(await applyPhysicalInventoryAdjustments({ adjustments: input.adjustments, note: input.reason, actor }));
    }
    case "rename_physical_product": {
      const input = parseAssistantWriteInput(name, raw);
      await updatePhysicalProduct({ itemId: input.itemId, title: input.title, expectedTitle: input.expectedTitle, actor });
      return { ok: true, itemId: input.itemId, title: input.title };
    }
    case "add_physical_variant": {
      const input = parseAssistantWriteInput(name, raw);
      await addPhysicalInventoryVariant({ itemId: input.itemId, title: input.title, sku: input.sku, expectedProductRevision: input.expectedProductRevision, actor });
      return { ok: true, itemId: input.itemId, title: input.title };
    }
    case "update_physical_variant": {
      const input = parseAssistantWriteInput(name, raw);
      await updatePhysicalInventoryVariant({ variantId: input.variantId, title: input.title, sku: input.sku, expectedVariantRevision: input.expectedVariantRevision, actor });
      return { ok: true, variantId: input.variantId, title: input.title };
    }
    case "archive_physical_variant": {
      const input = parseAssistantWriteInput(name, raw);
      await deletePhysicalInventoryVariant(input.variantId, actor, input.expectedVariantRevision);
      return { ok: true, variantId: input.variantId };
    }
    case "archive_physical_product": {
      const input = parseAssistantWriteInput(name, raw);
      await deletePhysicalProduct(input.itemId, actor, input.expectedProductRevision);
      return { ok: true, itemId: input.itemId };
    }
    case "create_packaging_material": {
      const input = parseAssistantWriteInput(name, raw);
      return outcome(await createPackagingMaterial({ title: input.title, quantity: input.quantity, actor }));
    }
    case "update_packaging_material": {
      const input = parseAssistantWriteInput(name, raw);
      return outcome(await updatePackagingMaterial({ id: input.id, title: input.title, quantity: input.quantity, expectedTitle: input.expectedTitle, expectedQuantity: input.expectedQuantity, actor }));
    }
    case "archive_packaging_material": {
      const input = parseAssistantWriteInput(name, raw);
      return outcome(await deletePackagingMaterial({ id: input.id, expectedTitle: input.expectedTitle, actor }));
    }
    case "set_channel_listing_mapping": {
      const input = parseAssistantWriteInput(name, raw);
      await savePhysicalListingMappings({ mappings: input.mappings, listingKind: input.listingKind, actor });
      return { ok: true, listingIds: input.mappings.map((mapping) => mapping.listingId) };
    }
    case "clear_channel_listing_mapping": {
      const input = parseAssistantWriteInput(name, raw);
      await savePhysicalListingMappings({ mappings: [{ listingId: input.listingId, components: [], expectedListingRevision: input.expectedListingRevision }], actor });
      return { ok: true, listingId: input.listingId };
    }
    case "set_channel_product_link": {
      const input = parseAssistantWriteInput(name, raw);
      await savePhysicalChannelProductLink({ channel: input.channel, externalProductId: input.externalProductId, physicalItemId: input.physicalItemId, expectedPhysicalItemId: input.expectedPhysicalItemId, actor });
      return { ok: true, channel: input.channel, externalProductId: input.externalProductId, physicalItemId: input.physicalItemId };
    }
    case "clear_channel_product_link": {
      const input = parseAssistantWriteInput(name, raw);
      await savePhysicalChannelProductLink({ channel: input.channel, externalProductId: input.externalProductId, physicalItemId: null, expectedPhysicalItemId: input.expectedPhysicalItemId, actor });
      return { ok: true, channel: input.channel, externalProductId: input.externalProductId };
    }
    case "create_lab_ingredient": {
      const input = parseAssistantWriteInput(name, raw);
      return outcome(await createLabIngredients({ ingredients: [{ title: input.title, quantityGrams: input.quantityGrams, reorderPointGrams: input.reorderPointGrams }], actor }));
    }
    case "import_lab_ingredients": {
      const input = parseAssistantWriteInput(name, raw);
      return outcome(await createLabIngredients({ ingredients: parseLabIngredientCsv(input.csv), imported: true, actor }));
    }
    case "update_lab_ingredient": {
      const input = parseAssistantWriteInput(name, raw);
      await updateLabIngredient({ id: input.id, quantityGrams: input.quantityGrams, reorderPointGrams: input.reorderPointGrams, expectedQuantityGrams: input.expectedQuantityGrams, actor });
      return { ok: true, ingredientId: input.id, quantityGrams: input.quantityGrams };
    }
    case "archive_lab_ingredient": {
      const input = parseAssistantWriteInput(name, raw);
      return outcome(await deleteLabIngredient({ id: input.id, expectedTitle: input.expectedTitle, actor }));
    }
    case "create_lab_formula": {
      const input = parseAssistantWriteInput(name, raw);
      const formula = await createLabFormula({ title: input.title, subtitle: input.subtitle, notes: input.notes, lines: input.lines, actor });
      return { ok: true, formulaId: formula.id, title: input.title };
    }
    case "set_lab_formula_packaging": {
      const input = parseAssistantWriteInput(name, raw);
      await updateLabFormulaPackaging({ formulaId: input.formulaId, fillQuantity: input.fillQuantity, fillUnit: input.fillUnit, expectedFillQuantity: input.expectedFillQuantity, expectedFillUnit: input.expectedFillUnit, actor });
      return { ok: true, formulaId: input.formulaId, fillQuantity: input.fillQuantity, fillUnit: input.fillUnit };
    }
    case "create_lab_batch": {
      const input = parseAssistantWriteInput(name, raw);
      return outcome(await createLabBatch({ formulaId: input.formulaId, batchNumber: input.batchNumber, targetGrams: input.targetGrams, outputQuantity: input.outputQuantity, outputUnit: input.outputUnit, expectedFormulaRevision: input.expectedFormulaRevision, expectedFillQuantity: input.expectedFillQuantity, expectedFillUnit: input.expectedFillUnit, expectedIngredients: input.expectedIngredients, actor }));
    }
    case "record_lab_batch_packaging": {
      const input = parseAssistantWriteInput(name, raw);
      return outcome(await updateLabBatchPackaging({ batchId: input.batchId, addedQuantity: input.addedQuantity, expectedPackagedQuantity: input.expectedPackagedQuantity, actor }));
    }
    case "set_lab_batch_notes": {
      const input = parseAssistantWriteInput(name, raw);
      return outcome(await updateLabBatchNotes({ batchId: input.batchId, notes: input.notes, expectedUpdatedAt: input.expectedUpdatedAt, actor }));
    }
    case "link_parcel2go_shipment": {
      const input = parseAssistantWriteInput(name, raw);
      await linkParcel2GoShipment(input.orderId, input.shipmentId, actor, input.expectedShipmentOrderId);
      return { ok: true, orderId: input.orderId, shipmentId: input.shipmentId };
    }
    case "run_direct_channel_sync": {
      return outcome(await syncDirectChannels("manual", actor));
    }
    case "refresh_tiktok_inventory": {
      const syncId = randomUUID();
      const value = await storeTikTokInventory();
      await ensurePhysicalChannelListings();
      await getPhysicalChannelListings("tiktok");
      await recordActivityEvent({ actor, source: "manual", provider: "tiktok", eventName: "sync.tiktok-inventory", entityType: "sync", entityId: syncId, summary: `TikTok inventory refresh completed: ${value.skus} live SKUs inspected`, details: { trigger: "assistant", skus: value.skus, products: value.products, matched: value.matched, removed: value.removed }, outcome: "succeeded", dedupeKey: `${syncId}:sync.tiktok-inventory` });
      return outcome(value);
    }
    case "refresh_tiktok_ads_report": {
      return outcome(await refreshTikTokAdsReporting("manual", actor));
    }
    case "start_tiktok_shop_connection": {
      return { authorizationStartUrl: `${getCanonicalAppUrl()}/api/tiktok/authorize`, requiresBrowser: true };
    }
    case "start_tiktok_ads_connection": {
      return { authorizationStartUrl: `${getCanonicalAppUrl()}/api/tiktok-ads/authorize`, requiresBrowser: true };
    }
    case "invite_employee": {
      const input = parseAssistantWriteInput(name, raw);
      const invitation = await inviteEmployee({ name: input.name, email: input.email, actor });
      return { ok: true, employeeId: invitation.employeeId, email: invitation.email, expiresAt: invitation.expiresAt,
        setupUrl: `${getCanonicalAppUrl()}/invite/${invitation.token}`,
        delivery: "Share this one-use setup link privately with the employee. It expires in 24 hours." };
    }
  }
}

export async function runAssistantWrite(principal: AssistantWritePrincipal, name: AssistantWriteToolName, raw: unknown) {
  const parsed = parseAssistantWriteInput(name, raw) as WriteArguments;
  const db = await getTursoClient();
  const currentUser = await db.execute({ sql: `SELECT u.id, u.name FROM "user" u WHERE u.id = ? AND EXISTS (SELECT 1 FROM "account" a WHERE a.userId = u.id) LIMIT 1`, args: [principal.userId] });
  const decision = authorizeAssistantWrite(principal, name, {
    writesEnabled: mcpWriteEnabled(), accountActive: Boolean(currentUser.rows[0]),
    allowedUserIds: mcpWriteAllowedUserIds(), allowedClientIds: mcpWriteAllowedClientIds(),
  });
  if (!decision.allowed) throw new Error(`MCP_WRITE_DENIED:${decision.reason}`);
  if (!(await enforceMcpWriteRateLimit({ userId: principal.userId, clientId: principal.clientId, toolName: name }))) throw new Error("MCP_WRITE_RATE_LIMITED");
  const actor: ActivityActor = {
    type: "staff", id: principal.userId,
    label: `${String(currentUser.rows[0].name).slice(0, 120)} via assistant`,
    assistant: { clientId: principal.clientId, operationId: parsed.idempotencyKey, toolName: name },
  };
  const execution = await executeMcpWriteOnce(db, {
    userId: principal.userId, clientId: principal.clientId, toolName: name,
    idempotencyKey: parsed.idempotencyKey, arguments: parsed,
  }, () => performWrite(name, parsed, actor), name === "invite_employee"
    ? (result) => ({ ...result, setupUrl: undefined, delivery: "The setup link was returned only on the first call. Reissue an invitation if it was lost." })
    : undefined);
  return { ...execution.result, operationId: parsed.idempotencyKey, replayed: execution.replayed };
}

export const IMPLEMENTED_ASSISTANT_WRITE_TOOLS = MCP_STAFF_WRITE_TOOLS;
