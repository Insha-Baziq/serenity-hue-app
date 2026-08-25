import { CustomersWorkspace } from "@/components/customers-workspace";
import { requirePageSession } from "@/lib/auth-guard";
import { getCustomers, getLatestSync } from "@/lib/repository";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  await requirePageSession();
  const [customers, sync] = await Promise.all([getCustomers(), getLatestSync()]);
  return <CustomersWorkspace initialCustomers={customers} initialSync={sync} />;
}
