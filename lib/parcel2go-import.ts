import "server-only";

import { findParcel2GoOrderMatch, type Parcel2GoOrderMatchCandidate } from "@/lib/parcel2go-matching";
import { getRecentParcel2GoShipments } from "@/lib/parcel2go";
import { getTursoClient } from "@/lib/turso";

export type Parcel2GoImportResult = {
  shipments: number;
  events: number;
  autoLinked: number;
};

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function shippingAddress(value: unknown) {
  if (typeof value !== "string") return "";
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((line): line is string => typeof line === "string").join(" ") : "";
  } catch {
    return "";
  }
}

/** Upserts Parcel2Go's recent delivery feed and links only high-confidence channel matches. */
export async function importRecentParcel2GoShipments(): Promise<Parcel2GoImportResult> {
  const shipments = await getRecentParcel2GoShipments();
  const db = await getTursoClient();
  const ordersResult = await db.execute(`
    SELECT id, source_order_id, order_number, customer_name, customer_email, customer_phone, shipping_address_json, source_created_at
    FROM orders
    WHERE source IN ('shopify', 'tiktok')
  `);
  const orders: Parcel2GoOrderMatchCandidate[] = ordersResult.rows.map((order) => ({
    id: stringValue(order.id),
    sourceOrderId: stringValue(order.source_order_id),
    orderNumber: stringValue(order.order_number),
    customerName: stringValue(order.customer_name),
    customerEmail: stringValue(order.customer_email),
    customerPhone: stringValue(order.customer_phone),
    shippingAddress: shippingAddress(order.shipping_address_json),
    createdAt: stringValue(order.source_created_at),
  })).filter((order) => Boolean(order.id && order.createdAt));
  const now = new Date().toISOString();
  let events = 0;
  let autoLinked = 0;

  for (const shipment of shipments) {
    const shipmentId = `parcel2go:${shipment.orderLineId}`;
    const match = findParcel2GoOrderMatch(shipment, orders);
    await db.execute({
      sql: `INSERT INTO shipments (
              id, provider, external_order_line_id, order_id, match_method, transaction_id, courier, service, source, status,
              paid_at, collection_date, estimated_delivery_at, tracking_url, last_synced_at, created_at, updated_at
            ) VALUES (?, 'parcel2go', ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(provider, external_order_line_id) DO UPDATE SET
              transaction_id = excluded.transaction_id,
              courier = excluded.courier,
              service = excluded.service,
              source = excluded.source,
              status = excluded.status,
              paid_at = excluded.paid_at,
              collection_date = excluded.collection_date,
              estimated_delivery_at = excluded.estimated_delivery_at,
              tracking_url = excluded.tracking_url,
              last_synced_at = excluded.last_synced_at,
              updated_at = excluded.updated_at`,
      args: [
        shipmentId,
        shipment.orderLineId,
        shipment.transactionId ?? null,
        shipment.courier,
        shipment.service,
        shipment.source ?? null,
        shipment.status,
        shipment.paidAt ?? null,
        shipment.collectionDate ?? null,
        shipment.estimatedDeliveryAt ?? null,
        shipment.trackingUrl ?? null,
        now,
        now,
        now,
      ],
    });

    if (match) {
      const linked = await db.execute({
        sql: `UPDATE shipments
              SET order_id = ?, match_method = ?, updated_at = ?
              WHERE id = ? AND order_id IS NULL`,
        args: [match.orderId, match.method, now, shipmentId],
      });
      autoLinked += linked.rowsAffected;
    }

    for (const event of shipment.events) {
      events += 1;
      await db.execute({
        sql: `INSERT INTO shipment_events (id, shipment_id, event_key, label, occurred_at, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(shipment_id, event_key) DO UPDATE SET
                label = excluded.label,
                occurred_at = excluded.occurred_at,
                updated_at = excluded.updated_at`,
        args: [`${shipmentId}:${event.key}`, shipmentId, event.key, event.label, event.occurredAt, now, now],
      });
    }
  }

  return { shipments: shipments.length, events, autoLinked };
}
