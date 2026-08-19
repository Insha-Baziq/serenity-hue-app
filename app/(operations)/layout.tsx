import { Sidebar } from "@/components/sidebar";
import { getCurrentSession } from "@/lib/auth-guard";
import { redirect } from "next/navigation";

export default async function OperationsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  if (!(await getCurrentSession())) redirect("/login");

  return (
    <div className="operations-shell">
      <Sidebar />
      <main className="operations-main">{children}</main>
    </div>
  );
}
