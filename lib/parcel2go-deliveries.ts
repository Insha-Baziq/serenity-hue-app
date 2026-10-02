import type { Client } from "@libsql/client";
import type { Parcel2GoDelivery, Parcel2GoMatchMethod } from "./types.ts";

function stringValue(value: unknown) { return typeof value === "string" ? value : ""; }
function optionalString(value: unknown) { return stringValue(value) || undefined; }
function stringArray(value: unknown): string[] {
  try {
    const parsed: unknown = JSON.parse(stringValue(value));
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch { return []; }
}
function toParcel2GoMatchMethod(value: unknown): Parcel2GoMatchMethod | undefined {
  const method = stringValue(value);
  return method === "order_reference" || method === "customer_email" || method === "customer_phone" || method === "delivery_address"
    ? method
    : undefined;
}

export async function getParcel2GoDeliveriesForOrders(db: Client, orderIds: string[]) {
  const deliveriesByOrderId = new Map<string, Parcel2GoDelivery[]>();
  if (orderIds.length === 0) return deliveriesByOrderId;

  const placeholders = orderIds.map(() => "?").join(", ");
  const shipments = await db.execute({
    sql: `SELECT s.id, links.order_id, s.external_order_line_id, s.source_references_json, s.courier, s.service, s.status,
                 s.paid_at, s.collection_date, s.estimated_delivery_at, s.tracking_url, links.match_method
          FROM shipments s JOIN shipment_orders links ON links.shipment_id = s.id
          WHERE links.order_id IN (${placeholders}) AND s.provider = 'parcel2go' ORDER BY s.last_synced_at DESC`,
    args: orderIds,
  });
  const deliveriesByShipmentId = new Map<string, Parcel2GoDelivery[]>();
  for (const shipment of shipments.rows) {
    const shipmentId = stringValue(shipment.id);
    const orderId = stringValue(shipment.order_id);
    if (!shipmentId || !orderId) continue;
    const delivery: Parcel2GoDelivery = {
      id: shipmentId,
      orderLineId: stringValue(shipment.external_order_line_id),
      sourceReferences: stringArray(shipment.source_references_json),
      courier: stringValue(shipment.courier) || "Parcel2Go courier",
      service: stringValue(shipment.service) || "Service details unavailable",
      status: stringValue(shipment.status) || "booked",
      paidAt: optionalString(shipment.paid_at),
      collectionDate: optionalString(shipment.collection_date),
      estimatedDeliveryAt: optionalString(shipment.estimated_delivery_at),
      trackingUrl: optionalString(shipment.tracking_url),
      matchMethod: toParcel2GoMatchMethod(shipment.match_method),
      events: [],
    };
    const shipmentDeliveries = deliveriesByShipmentId.get(shipmentId) ?? [];
    shipmentDeliveries.push(delivery);
    deliveriesByShipmentId.set(shipmentId, shipmentDeliveries);
    const orderDeliveries = deliveriesByOrderId.get(orderId) ?? [];
    orderDeliveries.push(delivery);
    deliveriesByOrderId.set(orderId, orderDeliveries);
  }
  const shipmentIds = [...deliveriesByShipmentId.keys()];
  if (shipmentIds.length === 0) return deliveriesByOrderId;
  const eventPlaceholders = shipmentIds.map(() => "?").join(", ");
  const events = await db.execute({
    sql: `SELECT id, shipment_id, event_key, label, occurred_at FROM shipment_events
          WHERE shipment_id IN (${eventPlaceholders}) ORDER BY occurred_at ASC`,
    args: shipmentIds,
  });
  for (const event of events.rows) {
    for (const delivery of deliveriesByShipmentId.get(stringValue(event.shipment_id)) ?? []) delivery.events.push({
      id: stringValue(event.id),
      key: stringValue(event.event_key),
      label: stringValue(event.label),
      occurredAt: stringValue(event.occurred_at),
    });
  }
  return deliveriesByOrderId;
}

