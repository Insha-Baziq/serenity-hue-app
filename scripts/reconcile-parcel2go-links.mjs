import { createClient } from "@libsql/client";
import { randomUUID } from "node:crypto";
import nextEnv from "@next/env";
import { reconcileParcel2GoOrderLinks } from "../lib/parcel2go-links.ts";

nextEnv.loadEnvConfig(process.cwd(), true);
const url = process.env.TURSO_DATABASE_URL?.trim();
const authToken = process.env.TURSO_AUTH_TOKEN?.trim();
if (!url || !authToken) throw new Error("Turso configuration is required.");
const db = createClient({ url, authToken });
try {
  const result = await db.execute("SELECT id, source_order_id, order_number, source_created_at FROM orders WHERE source IN ('shopify', 'tiktok')");
  const orders = result.rows.map((row) => ({
    id: String(row.id), sourceOrderId: String(row.source_order_id), orderNumber: String(row.order_number),
    createdAt: String(row.source_created_at), customerName: "", customerEmail: "", customerPhone: "", shippingAddress: "",
  }));
  const linked = await reconcileParcel2GoOrderLinks(db, orders);
  if (linked > 0) {
    const now = new Date().toISOString();
    await db.execute({
      sql: `INSERT INTO application_activity_log
        (id, occurred_at, expires_at, actor_type, actor_id, actor_label, source, provider, event_name, entity_type, summary, details_json, outcome)
        VALUES (?, ?, ?, 'system', 'parcel2go-reference-reconciliation', 'Parcel2Go reference reconciliation', 'manual', 'parcel2go', 'shipment.references_reconciled', 'shipment', ?, ?, 'succeeded')`,
      args: [randomUUID(), now, new Date(Date.parse(now) + 7 * 86400000).toISOString(), "Linked saved Parcel2Go booking references to available orders", JSON.stringify({ autoLinked: linked })],
    });
  }
  console.log(JSON.stringify({ autoLinked: linked }));
} finally { db.close(); }
