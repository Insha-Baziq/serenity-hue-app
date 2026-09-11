export type DeliveryProgressState = "placed" | "fulfilled" | "booked" | "in-transit" | "delivered" | "cancelled";

type DeliveryProgressInput = {
  cancelledAt: string | null;
  fulfillment: string;
  deliveries: Array<{ status: string }>;
};

/** Shipment status is the only evidence that an order reached the customer. */
export function deliveryProgressState(order: DeliveryProgressInput): DeliveryProgressState {
  if (order.cancelledAt || order.fulfillment === "cancelled") return "cancelled";
  const deliveryStatuses = order.deliveries.map((delivery) => delivery.status.toLowerCase());
  if (deliveryStatuses.includes("delivered")) return "delivered";
  if (deliveryStatuses.some((status) => ["in_transit", "at_depot", "delivery_scheduled", "collected", "dropped_off"].includes(status))) return "in-transit";
  if (deliveryStatuses.length > 0 || order.fulfillment === "partial") return "booked";
  return order.fulfillment === "fulfilled" ? "fulfilled" : "placed";
}

export function deliveryProgressCopy(state: DeliveryProgressState) {
  if (state === "fulfilled") return { label: "Fulfilled", detail: "Carrier status unavailable" };
  if (state === "booked") return { label: "Booked", detail: "Awaiting collection" };
  if (state === "in-transit") return { label: "In transit", detail: "With courier" };
  if (state === "delivered") return { label: "Delivered", detail: "Complete" };
  if (state === "cancelled") return { label: "Cancelled", detail: "Order stopped" };
  return { label: "Order placed", detail: "Awaiting booking" };
}
