import { Sidebar } from "@/components/sidebar";

export default function OperationsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="operations-shell">
      <Sidebar />
      <main className="operations-main">{children}</main>
    </div>
  );
}
