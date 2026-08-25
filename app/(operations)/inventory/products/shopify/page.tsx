import { notFound } from "next/navigation";
import { PhysicalChannelProductDetailWorkspace } from "@/components/physical-channel-product-detail-workspace";
import { requirePageSession } from "@/lib/auth-guard";
import { groupChannelListings } from "@/lib/physical-channel-products";
import { getPhysicalChannelListings, getPhysicalInventory } from "@/lib/repository";

export const dynamic = "force-dynamic";

export default async function ShopifyProductDetailPage({ searchParams }: { searchParams: Promise<{ product?: string }> }) {
  const { product: externalProductId } = await searchParams;
  await requirePageSession();
  if (!externalProductId) notFound();
  const [listings, items] = await Promise.all([getPhysicalChannelListings("shopify"), getPhysicalInventory()]);
  const group = groupChannelListings(listings).find((candidate) => candidate.externalProductId === externalProductId);
  if (!group) notFound();
  return <PhysicalChannelProductDetailWorkspace group={group} items={items} />;
}
