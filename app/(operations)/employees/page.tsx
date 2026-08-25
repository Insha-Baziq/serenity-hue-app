import { EmployeesWorkspace } from "@/components/employees-workspace";
import { requirePageSession } from "@/lib/auth-guard";
import { getEmployees } from "@/lib/repository";

export const dynamic = "force-dynamic";

export default async function EmployeesPage() {
  await requirePageSession();
  const employees = await getEmployees();
  return <EmployeesWorkspace initialEmployees={employees} />;
}
