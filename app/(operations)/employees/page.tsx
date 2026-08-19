import { EmployeesWorkspace } from "@/components/employees-workspace";
import { getEmployees } from "@/lib/repository";

export const dynamic = "force-dynamic";

export default async function EmployeesPage() {
  const employees = await getEmployees();
  return <EmployeesWorkspace initialEmployees={employees} />;
}
