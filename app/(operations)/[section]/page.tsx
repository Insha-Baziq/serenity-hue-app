import { notFound } from "next/navigation";
import { OverviewWorkspace } from "@/components/overview-workspace";
import { getInventory, getOrders } from "@/lib/repository";

export const dynamic = "force-dynamic";

export default async function UpcomingPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (section !== "overview") notFound();
  const [orders, inventory] = await Promise.all([getOrders(), getInventory()]);
  return <OverviewWorkspace orders={orders} inventory={inventory} />;
}
