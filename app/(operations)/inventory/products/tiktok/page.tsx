import { notFound } from "next/navigation";
import { PhysicalChannelProductDetailWorkspace } from "@/components/physical-channel-product-detail-workspace";
import { requirePageSession } from "@/lib/auth-guard";
import { groupChannelListings } from "@/lib/physical-channel-products";
import { ensurePhysicalChannelListings, getPhysicalChannelListings, getPhysicalInventory } from "@/lib/repository";

export const dynamic = "force-dynamic";

export default async function TikTokProductDetailPage({ searchParams }: { searchParams: Promise<{ product?: string }> }) {
  const { product: externalProductId } = await searchParams;
  await requirePageSession();
  if (!externalProductId) notFound();
  await ensurePhysicalChannelListings();
  const [listings, items] = await Promise.all([getPhysicalChannelListings("tiktok"), getPhysicalInventory()]);
  const group = groupChannelListings(listings).find((candidate) => candidate.externalProductId === externalProductId);
  if (!group) notFound();
  return <PhysicalChannelProductDetailWorkspace group={group} items={items} />;
}
