import { OrdersWorkspace } from "@/components/orders-workspace";
import { requirePageSession } from "@/lib/auth-guard";
import { getLatestSync, getOrdersPage, getUnlinkedParcel2GoShipments } from "@/lib/repository";
import { parseOrdersQuery } from "@/lib/orders-query";

export const dynamic = "force-dynamic";

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePageSession();
  const query = parseOrdersQuery(await searchParams);
  const [result, sync, unlinkedParcel2GoShipments] = await Promise.all([
    getOrdersPage(query),
    getLatestSync(),
    getUnlinkedParcel2GoShipments(),
  ]);
  return (
    <OrdersWorkspace
      initialOrders={result.orders}
      initialSync={sync}
      query={{ ...query, page: result.page }}
      total={result.total}
      page={result.page}
      pageSize={result.pageSize}
      totalPages={result.totalPages}
      unlinkedParcel2GoShipments={unlinkedParcel2GoShipments}
    />
  );
}
