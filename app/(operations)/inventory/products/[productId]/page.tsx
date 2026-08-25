import { notFound } from "next/navigation";
import { PhysicalProductDetailWorkspace } from "@/components/physical-product-detail-workspace";
import { requirePageSession } from "@/lib/auth-guard";
import { getPhysicalChannelListings, getPhysicalProductDetail } from "@/lib/repository";

export const dynamic = "force-dynamic";

type ProductDetailPageProps = {
  params: Promise<{ productId: string }>;
};

export default async function ProductDetailPage({ params }: ProductDetailPageProps) {
  const { productId } = await params;
  await requirePageSession();
  const product = await getPhysicalProductDetail(productId);
  if (!product) notFound();
  const [shopifyListings, tiktokListings] = await Promise.all([getPhysicalChannelListings("shopify"), getPhysicalChannelListings("tiktok")]);
  return <PhysicalProductDetailWorkspace initial={product} channelListings={[...shopifyListings, ...tiktokListings]} />;
}
