import { OrdersWorkspace } from "@/components/orders-workspace";
import { getLatestSync, getOrders } from "@/lib/repository";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const [orders, sync] = await Promise.all([getOrders(), getLatestSync()]);
  return <OrdersWorkspace initialOrders={orders} initialSync={sync} />;
}
