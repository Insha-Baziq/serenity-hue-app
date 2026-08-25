import type { PhysicalChannel, PhysicalChannelListing } from "@/lib/types";

export type ChannelProductGroup = {
  id: string;
  channel: PhysicalChannel;
  externalProductId: string;
  title: string;
  imageUrl: string | null;
  listingUrl: string | null;
  kind: PhysicalChannelListing["kind"];
  channelQuantity: number | null;
  masterProductId: string | null;
  masterProductTitle: string | null;
  mappingStatus: PhysicalChannelListing["mappingStatus"];
  listings: PhysicalChannelListing[];
};

export function listingVariantLabel(listing: PhysicalChannelListing) {
  return listing.variantTitle && listing.variantTitle !== "Default Title" ? listing.variantTitle : "Default variant";
}

export function mappingStatusLabel(status: PhysicalChannelListing["mappingStatus"]) {
  return status === "confirmed" ? "Mapped" : status === "review" ? "Needs review" : "Not mapped";
}

export function isListingMappedToLinkedMaster(listing: PhysicalChannelListing) {
  if (listing.kind !== "individual" || !listing.masterProductId) return listing.mappingStatus === "confirmed";
  return listing.components.length === 1 && listing.components[0].itemId === listing.masterProductId;
}

export function groupChannelListings(listings: PhysicalChannelListing[]): ChannelProductGroup[] {
  const groups = new Map<string, PhysicalChannelListing[]>();
  for (const listing of listings) {
    const key = `${listing.channel}:${listing.externalProductId || listing.id}`;
    groups.set(key, [...(groups.get(key) ?? []), listing]);
  }

  return [...groups.entries()].map(([id, groupedListings]) => {
    const first = groupedListings[0];
    const quantities = groupedListings.flatMap((listing) => listing.channelQuantity === null ? [] : [listing.channelQuantity]);
    const mappingStatus = groupedListings.every(isListingMappedToLinkedMaster)
      ? "confirmed"
      : groupedListings.some((listing) => listing.mappingStatus !== "unmapped" || listing.components.length > 0) ? "review" : "unmapped";
    const kinds = new Set(groupedListings.map((listing) => listing.kind));

    return {
      id,
      channel: first.channel,
      externalProductId: first.externalProductId,
      title: first.title,
      imageUrl: groupedListings.find((listing) => listing.imageUrl)?.imageUrl ?? null,
      listingUrl: groupedListings.find((listing) => listing.listingUrl)?.listingUrl ?? null,
      kind: kinds.size === 1 ? first.kind : "unknown",
      channelQuantity: quantities.length ? quantities.reduce((total, quantity) => total + quantity, 0) : null,
      masterProductId: first.masterProductId,
      masterProductTitle: first.masterProductTitle,
      mappingStatus,
      listings: groupedListings,
    };
  });
}

export function channelProductDetailHref(channel: PhysicalChannel, externalProductId: string) {
  return `/inventory/products/${channel}?product=${encodeURIComponent(externalProductId)}`;
}
