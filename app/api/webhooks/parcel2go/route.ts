import { createHmac, timingSafeEqual } from "node:crypto";
import { hasParcel2GoCredentials } from "@/lib/parcel2go";
import { importRecentParcel2GoShipments } from "@/lib/parcel2go-import";
import { recordParcel2GoWebhook } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_WEBHOOK_AGE_MS = 24 * 60 * 60 * 1000;

type Parcel2GoWebhook = {
  Id?: unknown;
  Timestamp?: unknown;
  Signature?: unknown;
  Type?: unknown;
};

type VerifiedParcel2GoWebhook = {
  Id: string;
  Timestamp: string;
  Signature: string;
  Type: string;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function canonicalTimestamp(timestamp: string) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function hasMatchingSignature(payload: VerifiedParcel2GoWebhook, secret: string) {
  const supplied = Buffer.from(payload.Signature.toLowerCase(), "utf8");
  const timestampCandidates = new Set([payload.Timestamp, canonicalTimestamp(payload.Timestamp)].filter((value): value is string => Boolean(value)));
  return [...timestampCandidates].some((timestamp) => {
    const expected = createHmac("sha256", secret).update(`${payload.Id}:${timestamp}:${payload.Type}`).digest("hex");
    const expectedBuffer = Buffer.from(expected, "utf8");
    return supplied.length === expectedBuffer.length && timingSafeEqual(supplied, expectedBuffer);
  });
}

export async function POST(request: Request) {
  const secret = process.env.PARCEL2GO_WEBHOOK_SECRET?.trim();
  if (!secret) return Response.json({ message: "Parcel2Go webhook secret is not configured" }, { status: 503 });

  let body: Parcel2GoWebhook;
  try {
    body = await request.json() as Parcel2GoWebhook;
  } catch {
    return Response.json({ message: "Invalid JSON" }, { status: 400 });
  }
  const payload = { Id: text(body.Id), Timestamp: text(body.Timestamp), Signature: text(body.Signature), Type: text(body.Type) };
  if (!payload.Id || !payload.Timestamp || !payload.Signature || !payload.Type) {
    return Response.json({ message: "Parcel2Go webhook fields are missing" }, { status: 400 });
  }
  const sentAt = Date.parse(payload.Timestamp);
  if (Number.isNaN(sentAt) || Math.abs(Date.now() - sentAt) > MAX_WEBHOOK_AGE_MS) {
    return Response.json({ message: "Parcel2Go webhook timestamp is outside the accepted window" }, { status: 400 });
  }
  if (!hasMatchingSignature(payload, secret)) return Response.json({ message: "Invalid Parcel2Go webhook signature" }, { status: 401 });

  const isNew = await recordParcel2GoWebhook({ externalEventId: payload.Id, topic: payload.Type });
  if (isNew && hasParcel2GoCredentials()) {
    try {
      await importRecentParcel2GoShipments();
    } catch {
      // The verified event is retained; the five-minute reconciliation will retry the delivery refresh.
    }
  }
  return Response.json({ ok: true, duplicate: !isNew });
}
