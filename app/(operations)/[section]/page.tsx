import { notFound } from "next/navigation";
import { OverviewWorkspace } from "@/components/overview-workspace";
import { requirePageSession } from "@/lib/auth-guard";
import { getLatestSync, getOrders, getPackagingInventory, getPhysicalInventory } from "@/lib/repository";

export const dynamic = "force-dynamic";

export default async function UpcomingPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (section !== "overview") notFound();
  await requirePageSession();
  const [orders, items, packaging, sync] = await Promise.all([getOrders(), getPhysicalInventory(), getPackagingInventory(), getLatestSync()]);
  return <OverviewWorkspace orders={orders} items={items} packaging={packaging} sync={sync} />;
}
