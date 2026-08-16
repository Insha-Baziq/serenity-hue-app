import { PackagingWorkspace } from "@/components/packaging-workspace";
import { getInventory } from "@/lib/repository";

export const dynamic = "force-dynamic";

export default async function PackagingPage() {
  const inventory = await getInventory();
  return <PackagingWorkspace items={inventory.packaging} />;
}
