import "server-only";

import type { Parcel2GoShipment } from "@/lib/parcel2go";

export type Parcel2GoMatchMethod = "order_reference" | "customer_email" | "customer_phone" | "delivery_address";

export type Parcel2GoOrderMatchCandidate = {
  id: string;
  sourceOrderId: string;
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  shippingAddress: string;
  createdAt: string;
};

export type Parcel2GoOrderMatch = {
  orderId: string;
  method: Parcel2GoMatchMethod;
};

const MAX_DAYS_BETWEEN_ORDER_AND_BOOKING = 45;

function compact(value: string | undefined) {
  return (value ?? "").toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
}

function phoneDigits(value: string | undefined) {
  return (value ?? "").replace(/\D/g, "").slice(-10);
}

function referenceKeys(value: string) {
  const text = value.toLocaleLowerCase().trim();
  if (!text) return new Set<string>();

  const compact = text.replace(/\s+/g, "");
  const alphaNumeric = text.replace(/[^a-z0-9]/g, "");
  const keys = new Set([text, compact, compact.replace(/^#/, ""), alphaNumeric]);
  const shopifyGid = text.match(/gid:\/\/shopify\/order\/(\d+)/i)?.[1];
  if (shopifyGid) keys.add(shopifyGid);

  // Smart Send can combine the marketplace order ID, checkout ID, and line ID
  // into one dot-separated reference. For example:
  // 576937617770780675.1154308028247545859.576937617770911747
  // Each long numeric segment is an identifier in its own right. Keep the
  // segments so the first one can match TikTok's source order ID directly.
  for (const segment of text.match(/\d{8,}/g) ?? []) keys.add(segment);

  // Parcel2Go can prefix an imported checkout reference with the marketplace
  // name. Extract only a clearly labelled Shopify/TikTok order ID, rather
  // than treating unrelated numbers such as a postcode as an order number.
  const channelReference = text.match(/\b(?:shopify|tiktok(?:\s*shop)?)\b(?:\s+(?:order|reference|order\s*(?:id|number|no\.?)))?\s*[:#-]?\s*(#?[a-z0-9-]{4,})/i)?.[1];
  if (channelReference) {
    keys.add(channelReference.replace(/^#/, ""));
    keys.add(channelReference.replace(/[^a-z0-9]/g, ""));
  }

  keys.delete("");
  return keys;
}

function textIsInAddress(address: string, value: string | undefined) {
  const needle = compact(value);
  return needle.length >= 4 && compact(address).includes(needle);
}

function bookingDate(shipment: Parcel2GoShipment) {
  return shipment.paidAt ?? shipment.collectionDate;
}

function daysFromOrderToBooking(orderCreatedAt: string, shipment: Parcel2GoShipment) {
  const shipmentDate = bookingDate(shipment);
  if (!shipmentDate) return undefined;
  const days = (Date.parse(shipmentDate) - Date.parse(orderCreatedAt)) / 86_400_000;
  return Number.isFinite(days) ? days : undefined;
}

function isEligibleForDateBasedMatch(order: Parcel2GoOrderMatchCandidate, shipment: Parcel2GoShipment) {
  const days = daysFromOrderToBooking(order.createdAt, shipment);
  return days !== undefined && days >= -1 && days <= MAX_DAYS_BETWEEN_ORDER_AND_BOOKING;
}

function matchingReferenceOrder(shipment: Parcel2GoShipment, orders: Parcel2GoOrderMatchCandidate[]) {
  // Smart Send formats TikTok references as
  // {order-id}.{checkout-id}.{order-line-id}. The later IDs can themselves
  // look like valid TikTok order IDs, so resolve the leading segment first.
  // If it identifies one order, it is the authoritative Parcel2Go reference.
  const leadingReferenceIds = new Set(shipment.importedReferences
    .map((reference) => reference.trim().split(/[.\s,:;|/]+/, 1)[0]?.replace(/^#/, "").toLocaleLowerCase() ?? "")
    .filter((reference) => /^\d{8,}$/.test(reference)));
  if (leadingReferenceIds.size > 0) {
    const leadingMatches = orders.filter((order) => {
      const sourceOrderKeys = referenceKeys(order.sourceOrderId);
      const orderNumberKeys = referenceKeys(order.orderNumber);
      return [...sourceOrderKeys, ...orderNumberKeys].some((key) => leadingReferenceIds.has(key));
    });
    if (leadingMatches.length === 1) return leadingMatches[0];
  }

  const references = new Set(shipment.importedReferences.flatMap((reference) => [...referenceKeys(reference)]));
  if (references.size === 0) return undefined;
  const matches = orders.filter((order) => {
    const sourceOrderKeys = referenceKeys(order.sourceOrderId);
    const orderNumberKeys = referenceKeys(order.orderNumber);
    if ([...sourceOrderKeys, ...orderNumberKeys].some((key) => references.has(key))) return true;

    // Smart Send puts several IDs in one reference, separated by dots. Match
    // a complete order ID at a clear boundary, never a partial numeric prefix.
    // This covers values such as:
    // 576937617770780675.1154308028247545859.576937617770911747
    const orderIds = [order.sourceOrderId, order.orderNumber]
      .map((value) => value.trim().toLocaleLowerCase().replace(/^#/, ""))
      .filter((value) => value.length >= 4);
    return shipment.importedReferences.some((reference) => {
      const value = reference.trim().toLocaleLowerCase().replace(/^#/, "");
      return orderIds.some((orderId) => value === orderId
        || value.startsWith(`${orderId}.`)
        || value.includes(`.${orderId}.`)
        || value.endsWith(`.${orderId}`));
    });
  });
  return matches.length === 1 ? matches[0] : undefined;
}

function matchMethod(input: {
  email: boolean;
  phone: boolean;
  name: boolean;
  postcode: boolean;
  street: boolean;
  property: boolean;
}): Parcel2GoMatchMethod | undefined {
  if (input.email) return "customer_email";
  if (input.phone) return "customer_phone";
  if (input.name && input.postcode && (input.street || input.property)) return "delivery_address";
  return undefined;
}

/**
 * Matches only when independent customer and delivery signals make the result
 * unambiguous. Ambiguous deliveries stay unlinked so a status is never shown
 * against the wrong customer's order.
 */
export function findParcel2GoOrderMatch(shipment: Parcel2GoShipment, orders: Parcel2GoOrderMatchCandidate[]): Parcel2GoOrderMatch | undefined {
  const referenceOrder = matchingReferenceOrder(shipment, orders);
  if (referenceOrder) return { orderId: referenceOrder.id, method: "order_reference" };

  const delivery = shipment.deliveryAddress;
  const shipmentName = compact(delivery.contactName);
  const shipmentEmail = compact(delivery.email);
  const shipmentPhone = phoneDigits(delivery.phone);
  const shipmentPostcode = compact(delivery.postcode);

  const candidates = orders.flatMap((order) => {
    if (!isEligibleForDateBasedMatch(order, shipment)) return [];
    const email = Boolean(shipmentEmail && compact(order.customerEmail) === shipmentEmail);
    const phone = Boolean(shipmentPhone && phoneDigits(order.customerPhone) === shipmentPhone);
    const name = Boolean(shipmentName && compact(order.customerName) === shipmentName);
    const postcode = Boolean(shipmentPostcode && compact(order.shippingAddress).includes(shipmentPostcode));
    const street = textIsInAddress(order.shippingAddress, delivery.street);
    const property = textIsInAddress(order.shippingAddress, delivery.property);
    const town = textIsInAddress(order.shippingAddress, delivery.town);
    const method = matchMethod({ email, phone, name, postcode, street, property });
    if (!method) return [];

    const days = daysFromOrderToBooking(order.createdAt, shipment) ?? MAX_DAYS_BETWEEN_ORDER_AND_BOOKING;
    const score = (email ? 100 : 0)
      + (phone ? 80 : 0)
      + (name ? 25 : 0)
      + (postcode ? 20 : 0)
      + (street ? 35 : 0)
      + (property ? 20 : 0)
      + (town ? 10 : 0)
      + Math.max(0, 10 - Math.floor(days / 5));
    return [{ order, method, score }];
  }).sort((left, right) => right.score - left.score);

  const best = candidates[0];
  const runnerUp = candidates[1];
  if (!best || best.score < 80 || (runnerUp && best.score - runnerUp.score < 20)) return undefined;
  return { orderId: best.order.id, method: best.method };
}
