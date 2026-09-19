import { PhysicalInventoryWorkspace } from "@/components/physical-inventory-workspace";
import { requirePageSession } from "@/lib/auth-guard";
import { ensurePhysicalChannelListings, getPhysicalChannelListings, getPhysicalInventory, getPhysicalInventoryRunways } from "@/lib/repository";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  await requirePageSession();
  await ensurePhysicalChannelListings();
  const [inventory, shopifyListings, tiktokListings, runways] = await Promise.all([
    getPhysicalInventory(),
    getPhysicalChannelListings("shopify"),
    getPhysicalChannelListings("tiktok"),
    getPhysicalInventoryRunways(),
  ]);
  return <PhysicalInventoryWorkspace initial={inventory} initialShopifyListings={shopifyListings} initialTikTokListings={tiktokListings} initialRunways={runways} />;
}
