import assert from "node:assert/strict";
import test from "node:test";
import { deliveryProgressState } from "../lib/delivery-progress.ts";

const baseOrder = { cancelledAt: null, fulfillment: "fulfilled", deliveries: [] };

test("delivery progress does not treat provider-unknown fulfilment as delivered", () => {
  assert.equal(deliveryProgressState(baseOrder), "fulfilled");
  assert.equal(deliveryProgressState({ ...baseOrder, deliveries: [{ status: "delivered" }] }), "delivered");
});
