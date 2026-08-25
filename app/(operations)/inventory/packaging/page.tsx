import { PackagingWorkspace } from "@/components/packaging-workspace";
import { requirePageSession } from "@/lib/auth-guard";
import { getPackagingInventory } from "@/lib/repository";

export const dynamic = "force-dynamic";

export default async function PackagingPage() {
  await requirePageSession();
  const items = await getPackagingInventory();
  return <PackagingWorkspace items={items} />;
}
