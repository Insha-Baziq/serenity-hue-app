import type { Channel, CustomerType, FulfillmentStatus, MappingStatus, PaymentStatus } from "@/lib/types";

export function ChannelPill({ channel }: { channel: Channel }) {
  return <span className={`channel-pill channel-pill--${channel}`}>{channel === "shopify" ? "Shopify" : "TikTok Shop"}</span>;
}

export function PaymentPill({ status, cancelled = false }: { status: PaymentStatus; cancelled?: boolean }) {
  const text = cancelled ? "No payment due" : status === "paid" ? "Paid" : status === "refunded" ? "Refunded" : "Pending";
  return <span className={`status-pill status-pill--payment-${cancelled ? "cancelled" : status}`}>{text}</span>;
}

export function FulfillmentPill({ status }: { status: FulfillmentStatus }) {
  const text = status === "cancelled" ? "Cancelled" : status === "fulfilled" ? "Fulfilled" : status === "partial" ? "Partially fulfilled" : "Unfulfilled";
  return <span className={`status-pill status-pill--fulfillment-${status}`}>{text}</span>;
}

export function MappingPill({ status }: { status: MappingStatus }) {
  const text = status === "confirmed" ? "Confirmed" : status === "review" ? "Review" : "Needs mapping";
  return <span className={`mapping-pill mapping-pill--${status}`}>{text}</span>;
}

export function CustomerTypePill({ type }: { type: CustomerType }) {
  const text = type === "repeat" ? "Repeat customer" : type === "guest" ? "Guest customer" : "One-time customer";
  return <span className={`customer-type-pill customer-type-pill--${type}`}>{text}</span>;
}
