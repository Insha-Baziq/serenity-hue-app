import { PhysicalInventoryWorkspace } from "@/components/physical-inventory-workspace";
import { requirePageSession } from "@/lib/auth-guard";
import { getPhysicalChannelListings, getPhysicalInventory, getPhysicalInventoryRunways } from "@/lib/repository";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  await requirePageSession();
  // These four loaders share the same guarded seed/ensure work (deduped by an
  // in-flight promise in the repository), so a fresh database still sets itself
  // up exactly once even though the reads run in parallel.
  const [inventory, shopifyListings, tiktokListings, runways] = await Promise.all([
    getPhysicalInventory(),
    getPhysicalChannelListings("shopify"),
    getPhysicalChannelListings("tiktok"),
    getPhysicalInventoryRunways(),
  ]);
  return <PhysicalInventoryWorkspace initial={inventory} initialShopifyListings={shopifyListings} initialTikTokListings={tiktokListings} initialRunways={runways} />;
}
