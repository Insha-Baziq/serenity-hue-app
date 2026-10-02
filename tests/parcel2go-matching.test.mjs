import test from "node:test";
import assert from "node:assert/strict";
import { findParcel2GoOrderMatches } from "../lib/parcel2go-matching.ts";

const order = (id) => ({ id, sourceOrderId: id, orderNumber: id, customerName: "Customer", customerEmail: "", customerPhone: "", shippingAddress: "", createdAt: "2026-10-01T10:00:00Z" });
const shipment = (references) => ({ orderLineId: "booking-1", courier: "Courier", service: "Service", status: "booked", importedReferences: references, deliveryAddress: {}, events: [] });

test("one booking links every separately referenced order and skips missing orders", () => {
  const orders = ["10000001", "10000002", "10000003", "10000004", "10000005"].map(order);
  const booking = shipment(["10000001.checkout.line", "10000002.checkout.line", "10000003.checkout.line", "10000004.checkout.line", "10000005.checkout.line", "10000006.checkout.line"]);
  assert.deepEqual(findParcel2GoOrderMatches(booking, orders), orders.map(({ id }) => ({ orderId: id, method: "order_reference" })));
});

test("duplicate references do not duplicate links and checkout IDs are not order IDs", () => {
  const orders = ["10000001", "10000002"].map(order);
  assert.deepEqual(findParcel2GoOrderMatches(shipment(["10000001.10000002.line", "10000001.other.line"]), orders),
    [{ orderId: "10000001", method: "order_reference" }]);
  assert.deepEqual(findParcel2GoOrderMatches(shipment(["99999999.10000002.line"]), orders), []);
});

test("an ambiguous reference does not block a separate unambiguous reference", () => {
  const duplicate = { ...order("internal"), sourceOrderId: "10000001", orderNumber: "10000001" };
  assert.deepEqual(findParcel2GoOrderMatches(shipment(["10000001", "10000002"]), [order("10000001"), duplicate, order("10000002")]),
    [{ orderId: "10000002", method: "order_reference" }]);
});
