import { notFound } from "next/navigation";
import { PhysicalProductDetailWorkspace } from "@/components/physical-product-detail-workspace";
import { requirePageSession } from "@/lib/auth-guard";
import { ensurePhysicalChannelListings, getPhysicalChannelListings, getPhysicalProductDetail, getPhysicalProductRunway } from "@/lib/repository";

export const dynamic = "force-dynamic";

type ProductDetailPageProps = {
  params: Promise<{ productId: string }>;
};

export default async function ProductDetailPage({ params }: ProductDetailPageProps) {
  const { productId } = await params;
  await requirePageSession();
  await ensurePhysicalChannelListings();
  const product = await getPhysicalProductDetail(productId);
  if (!product) notFound();
  const [shopifyListings, tiktokListings, runway] = await Promise.all([getPhysicalChannelListings("shopify"), getPhysicalChannelListings("tiktok"), getPhysicalProductRunway(productId)]);
  return <PhysicalProductDetailWorkspace initial={product} channelListings={[...shopifyListings, ...tiktokListings]} runway={runway} />;
}
