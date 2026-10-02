import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@libsql/client";
import { readFile } from "node:fs/promises";
import { addParcel2GoOrderLinks, reconcileParcel2GoOrderLinks } from "../lib/parcel2go-links.ts";
import { getParcel2GoDeliveriesForOrders } from "../lib/parcel2go-deliveries.ts";

const candidate = (id) => ({ id, sourceOrderId: id, orderNumber: id, customerName: "", customerEmail: "", customerPhone: "", shippingAddress: "", createdAt: "2026-10-01" });

test("saved shared bookings link available orders, retry absent orders, and show the same events on every order", async () => {
  const db = createClient({ url: ":memory:" });
  try {
    const schema = await readFile(new URL("../database/schema.sql", import.meta.url), "utf8");
    await db.executeMultiple(schema);
    for (const id of ["10000001", "10000002", "10000003"]) {
      await db.execute({ sql: "INSERT INTO orders (id, source, source_order_id, order_number, source_created_at) VALUES (?, 'tiktok', ?, ?, '2026-10-01')", args: [id, id, id] });
    }
    await db.execute({ sql: "INSERT INTO shipments (id, provider, external_order_line_id, order_id, source_references_json, status, tracking_url) VALUES ('booking', 'parcel2go', 'booking', '10000001', ?, 'in_transit', 'https://example.com/tracking')", args: [JSON.stringify(["10000001.x.y", "10000002.x.y", "10000003.x.y"])] });
    await db.executeMultiple(schema);
    assert.equal((await db.execute("SELECT COUNT(*) AS count FROM shipment_orders")).rows[0].count, 1, "legacy link is preserved");
    assert.equal(await reconcileParcel2GoOrderLinks(db, ["10000001", "10000002"].map(candidate)), 1);
    assert.equal(await reconcileParcel2GoOrderLinks(db, ["10000001", "10000002"].map(candidate)), 0, "repeated sync is idempotent");
    assert.equal(await reconcileParcel2GoOrderLinks(db, ["10000001", "10000002", "10000003"].map(candidate)), 1, "a later order is picked up from saved references");
    assert.equal((await db.execute("SELECT order_id FROM shipments WHERE id = 'booking'")).rows[0].order_id, "10000001", "primary anchor remains stable");
    await db.execute("INSERT INTO shipment_events (id, shipment_id, event_key, label, occurred_at) VALUES ('event', 'booking', 'collected', 'Collected', '2026-10-02')");
    const deliveries = await getParcel2GoDeliveriesForOrders(db, ["10000001", "10000002", "10000003"]);
    for (const id of ["10000001", "10000002", "10000003"]) {
      assert.equal(deliveries.get(id).length, 1);
      assert.equal(deliveries.get(id)[0].trackingUrl, "https://example.com/tracking");
      assert.equal(deliveries.get(id)[0].status, "in_transit");
      assert.equal(deliveries.get(id)[0].events[0].label, "Collected");
    }
    assert.equal(await addParcel2GoOrderLinks(db, "booking", []), 0);
  } finally { db.close(); }
});
