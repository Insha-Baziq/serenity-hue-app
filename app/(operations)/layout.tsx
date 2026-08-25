import { Sidebar } from "@/components/sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { requirePageSession } from "@/lib/auth-guard";

export default async function OperationsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await requirePageSession();

  return <SidebarProvider>
    <div className="operations-shell">
      <Sidebar />
      <SidebarInset className="operations-main">{children}</SidebarInset>
    </div>
  </SidebarProvider>;
}
