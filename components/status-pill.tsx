import type { Channel, FulfillmentStatus, MappingStatus, PaymentStatus } from "@/lib/types";

export function ChannelPill({ channel }: { channel: Channel }) {
  return <span className={`channel-pill channel-pill--${channel}`}>{channel === "shopify" ? "Shopify" : "TikTok Shop"}</span>;
}

export function PaymentPill({ status }: { status: PaymentStatus }) {
  const text = status === "paid" ? "Paid" : status === "refunded" ? "Refunded" : "Pending";
  return <span className={`status-pill status-pill--payment-${status}`}>{text}</span>;
}

export function FulfillmentPill({ status }: { status: FulfillmentStatus }) {
  const text = status === "fulfilled" ? "Fulfilled" : status === "partial" ? "Partially fulfilled" : "Unfulfilled";
  return <span className={`status-pill status-pill--fulfillment-${status}`}>{text}</span>;
}

export function MappingPill({ status }: { status: MappingStatus }) {
  const text = status === "confirmed" ? "Confirmed" : status === "review" ? "Review" : "Needs mapping";
  return <span className={`mapping-pill mapping-pill--${status}`}>{text}</span>;
}
