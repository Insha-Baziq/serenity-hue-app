import "server-only";

type Parcel2GoTokenResponse = {
  access_token?: unknown;
  expires_in?: unknown;
  error?: unknown;
  error_description?: unknown;
};

type AccessToken = {
  value: string;
  expiresAt: number;
};

export type Parcel2GoTrackingEvent = {
  key: "dropped_off" | "collected" | "in_transit" | "at_depot" | "delivery_scheduled" | "delivered";
  label: string;
  occurredAt: string;
};

export type Parcel2GoDeliveryAddress = {
  contactName?: string;
  email?: string;
  phone?: string;
  postcode?: string;
  property?: string;
  street?: string;
  town?: string;
};

export type Parcel2GoShipment = {
  orderLineId: string;
  transactionId?: string;
  courier: string;
  service: string;
  source?: string;
  status: string;
  paidAt?: string;
  collectionDate?: string;
  estimatedDeliveryAt?: string;
  trackingUrl?: string;
  deliveryAddress: Parcel2GoDeliveryAddress;
  importedReferences: string[];
  events: Parcel2GoTrackingEvent[];
};

const DEFAULT_API_BASE_URL = "https://www.parcel2go.com";
let cachedToken: AccessToken | undefined;

const trackingMilestones: Array<{
  field: string;
  key: Parcel2GoTrackingEvent["key"];
  label: string;
}> = [
  { field: "DroppedOff", key: "dropped_off", label: "Dropped off" },
  { field: "Collected", key: "collected", label: "Collected" },
  { field: "InTransit", key: "in_transit", label: "In transit" },
  { field: "AtDepot", key: "at_depot", label: "At depot" },
  { field: "DeliveryScheduled", key: "delivery_scheduled", label: "Delivery scheduled" },
  { field: "Delivered", key: "delivered", label: "Delivered" },
];

export function hasParcel2GoCredentials() {
  return Boolean(process.env.PARCEL2GO_CLIENT_ID?.trim() && process.env.PARCEL2GO_CLIENT_SECRET?.trim());
}

function apiBaseUrl() {
  return (process.env.PARCEL2GO_API_BASE_URL?.trim() || DEFAULT_API_BASE_URL).replace(/\/$/, "");
}

function requiredEnvironment(name: "PARCEL2GO_CLIENT_ID" | "PARCEL2GO_CLIENT_SECRET") {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name} in server environment`);
  return value;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function textOrUndefined(value: unknown) {
  const text = stringValue(value);
  return text || undefined;
}

function identifier(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function records(value: unknown) {
  if (Array.isArray(value)) return value;
  return value && typeof value === "object" ? Object.values(value) : [];
}

function dateOrUndefined(value: unknown) {
  const date = stringValue(value);
  return date && !Number.isNaN(Date.parse(date)) ? date : undefined;
}

function trackingPageUrl(value: unknown) {
  const link = records(value)
    .map(recordValue)
    .find((entry) => stringValue(entry.Name).toLowerCase() === "tracking-page");
  const url = textOrUndefined(link?.Link);
  if (!url) return undefined;
  try {
    return new URL(url).protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

function trackingEvents(value: unknown): Parcel2GoTrackingEvent[] {
  const tracking = recordValue(value);
  return trackingMilestones.flatMap(({ field, key, label }) => {
    const occurredAt = dateOrUndefined(tracking[field]);
    return occurredAt ? [{ key, label, occurredAt }] : [];
  });
}

function deliveryAddress(value: unknown): Parcel2GoDeliveryAddress {
  const address = recordValue(value);
  return {
    contactName: textOrUndefined(address.ContactName),
    email: textOrUndefined(address.Email),
    phone: textOrUndefined(address.Phone),
    postcode: textOrUndefined(address.Postcode),
    property: textOrUndefined(address.Property),
    street: textOrUndefined(address.Street),
    town: textOrUndefined(address.Town),
  };
}

function importedReferences(value: unknown) {
  return [...new Set(records(value)
    .map(recordValue)
    .map((item) => textOrUndefined(item.Ref))
    .filter((reference): reference is string => Boolean(reference)))];
}

function currentStatus(events: Parcel2GoTrackingEvent[]) {
  if (events.length === 0) return "booked";
  const latest = [...events].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))[0];
  return latest.key;
}

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;

  const response = await fetch(`${apiBaseUrl()}/auth/connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "public-api",
      client_id: requiredEnvironment("PARCEL2GO_CLIENT_ID"),
      client_secret: requiredEnvironment("PARCEL2GO_CLIENT_SECRET"),
    }),
    cache: "no-store",
  });
  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json") ? await response.json() as Parcel2GoTokenResponse : undefined;
  if (!response.ok) {
    const reason = payload && [payload.error, payload.error_description].find((value): value is string => typeof value === "string" && value.length > 0);
    throw new Error(`Parcel2Go token request failed (HTTP ${response.status})${reason ? `: ${reason}` : ""}`);
  }
  if (!payload || typeof payload.access_token !== "string" || !payload.access_token) {
    throw new Error("Parcel2Go token request returned no access token");
  }
  const lifetimeSeconds = typeof payload.expires_in === "number" && payload.expires_in > 0 ? payload.expires_in : 300;
  cachedToken = { value: payload.access_token, expiresAt: Date.now() + lifetimeSeconds * 1000 };
  return cachedToken.value;
}

/** Retrieves Parcel2Go's documented recent-deliveries feed (currently 25 orders). */
export async function getRecentParcel2GoShipments(): Promise<Parcel2GoShipment[]> {
  const response = await fetch(`${apiBaseUrl()}/api/me/orders/detail`, {
    headers: { Authorization: `Bearer ${await getAccessToken()}`, Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Parcel2Go recent orders request failed (HTTP ${response.status})`);
  const payload = recordValue(await response.json());

  return records(payload.Orders).flatMap((value) => {
    const order = recordValue(value);
    const orderLineId = identifier(order.OrderLineId);
    if (!orderLineId) return [];
    const events = trackingEvents(order.Tracking);
    return [{
      orderLineId,
      transactionId: textOrUndefined(order.TransactionId),
      courier: textOrUndefined(order.Courier) ?? "Parcel2Go courier",
      service: textOrUndefined(order.Service) ?? "Service details unavailable",
      source: textOrUndefined(order.Source),
      status: currentStatus(events),
      paidAt: dateOrUndefined(order.PaidDate),
      collectionDate: dateOrUndefined(order.CollectionDate),
      estimatedDeliveryAt: dateOrUndefined(order.EstimatedDeliveryDate),
      trackingUrl: trackingPageUrl(order.Links),
      deliveryAddress: deliveryAddress(order.DeliveryAddress),
      importedReferences: importedReferences(order.ImportedItems),
      events,
    } satisfies Parcel2GoShipment];
  });
}
