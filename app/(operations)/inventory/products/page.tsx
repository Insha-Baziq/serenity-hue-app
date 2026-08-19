import { ChannelInventoryWorkspace } from "@/components/channel-inventory-workspace";
import { getChannelInventory } from "@/lib/repository";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const inventory = await getChannelInventory();
  return <ChannelInventoryWorkspace initial={inventory} />;
}
