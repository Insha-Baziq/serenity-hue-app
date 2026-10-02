import type { Client } from "@libsql/client";
import { findParcel2GoOrderMatches, type Parcel2GoOrderMatch, type Parcel2GoOrderMatchCandidate } from "./parcel2go-matching.ts";

/** Add relationships without replacing existing links; retain the legacy primary anchor. */
export async function addParcel2GoOrderLinks(db: Client, shipmentId: string, matches: Parcel2GoOrderMatch[], now = new Date().toISOString()) {
  if (matches.length === 0) return 0;
  const results = await db.batch([
    ...matches.map((match) => ({
      sql: "INSERT OR IGNORE INTO shipment_orders (shipment_id, order_id, match_method, created_at) VALUES (?, ?, ?, ?)",
      args: [shipmentId, match.orderId, match.method, now],
    })),
    {
      sql: "UPDATE shipments SET order_id = ?, match_method = ?, updated_at = ? WHERE id = ? AND order_id IS NULL",
      args: [matches[0].orderId, matches[0].method, now, shipmentId],
    },
  ], "write");
  return results.slice(0, matches.length).reduce((count, result) => count + result.rowsAffected, 0);
}

/** Retry saved references too, including bookings that have left the provider's recent feed. */
export async function reconcileParcel2GoOrderLinks(db: Client, orders: Parcel2GoOrderMatchCandidate[]) {
  const shipments = await db.execute("SELECT id, source_references_json FROM shipments WHERE provider = 'parcel2go' AND source_references_json <> '[]'");
  const existing = await db.execute("SELECT shipment_id, order_id FROM shipment_orders");
  const linkedPairs = new Set(existing.rows.map((row) => JSON.stringify([String(row.shipment_id), String(row.order_id)])));
  let linked = 0;
  for (const shipment of shipments.rows) {
    let references: unknown;
    try { references = JSON.parse(String(shipment.source_references_json)); } catch { continue; }
    if (!Array.isArray(references)) continue;
    const matches = findParcel2GoOrderMatches({
      orderLineId: String(shipment.id), courier: "", service: "", status: "",
      importedReferences: references.filter((value): value is string => typeof value === "string"),
      deliveryAddress: {}, events: [],
    }, orders);
    const missing = matches.filter((match) => !linkedPairs.has(JSON.stringify([String(shipment.id), match.orderId])));
    linked += await addParcel2GoOrderLinks(db, String(shipment.id), missing);
  }
  return linked;
}
