"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArchiveIcon, AvatarIcon, ChevronDownIcon, CubeIcon, DashboardIcon, ExitIcon, LayersIcon, PersonIcon } from "@radix-ui/react-icons";
import { useState, type ElementType } from "react";
import { BarChart3, FlaskConical, Menu, ReceiptText } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  Sidebar as ShadcnSidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { authClient } from "@/lib/auth-client";

type NavigationItem = { href: string; label: string; icon: ElementType };

const primaryItems: NavigationItem[] = [
  { href: "/overview", label: "Overview", icon: DashboardIcon },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/orders", label: "Orders", icon: ArchiveIcon },
  { href: "/customers", label: "Customers", icon: AvatarIcon },
  { href: "/employees", label: "Employees", icon: PersonIcon },
  { href: "/labs", label: "Labs", icon: FlaskConical },
  { href: "/vat", label: "VAT", icon: ReceiptText },
];

const mobileMenuItems: NavigationItem[] = [
  { href: "/overview", label: "Overview", icon: DashboardIcon },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/orders", label: "Orders", icon: ArchiveIcon },
  { href: "/customers", label: "Customers", icon: AvatarIcon },
  { href: "/employees", label: "Employees", icon: PersonIcon },
  { href: "/inventory/products", label: "Products", icon: CubeIcon },
  { href: "/inventory/packaging", label: "Packaging", icon: LayersIcon },
  { href: "/labs", label: "Labs", icon: FlaskConical },
  { href: "/vat", label: "VAT", icon: ReceiptText },
];

export function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const { open, setOpen } = useSidebar();
  const [inventoryOpen, setInventoryOpen] = useState(pathname.startsWith("/inventory"));
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const inventoryActive = pathname.startsWith("/inventory");

  async function signOut() {
    await authClient.signOut();
    router.replace("/login");
  }

  return <ShadcnSidebar aria-label="Serenity Hue navigation">
      <SidebarHeader>
        <Link className="sh-sidebar__brand" href="/overview" aria-label="Serenity Hue Operations home">
          <Image src="/serenity-hue-logo-transparent.png" alt="Serenity Hue by Shabina" width={142} height={142} priority />
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <nav aria-label="Main navigation">
            <SidebarMenu>
              {primaryItems.map(({ href, label, icon: Icon }) => {
                const active = href === "/analytics" ? pathname.startsWith("/analytics") || pathname === "/kpis" : href === "/labs" ? pathname.startsWith("/labs") : pathname === href;
                return <SidebarMenuItem key={href}>
                  <Link className="sh-sidebar__menu-link" data-active={active || undefined} href={href} aria-current={active ? "page" : undefined}>
                    <Icon aria-hidden="true" />
                    <span>{label}</span>
                  </Link>
                </SidebarMenuItem>;
              })}
              <SidebarMenuItem className="sh-sidebar__inventory-item">
                <SidebarMenuButton isActive={inventoryActive} onClick={() => { if (!open) setOpen(true); setInventoryOpen((current) => !current); }} aria-expanded={inventoryOpen} aria-controls="inventory-navigation">
                  <CubeIcon aria-hidden="true" />
                  <span>Inventory</span>
                  <ChevronDownIcon className="sh-sidebar__chevron" aria-hidden="true" data-open={inventoryOpen || undefined} />
                </SidebarMenuButton>
                {inventoryOpen && <ul className="sh-sidebar__sub-menu" id="inventory-navigation">
                  <li><Link href="/inventory/products" className="sh-sidebar__sub-menu-link" data-active={pathname === "/inventory/products" || undefined}>Products</Link></li>
                  <li><Link href="/inventory/packaging" className="sh-sidebar__sub-menu-link" data-active={pathname === "/inventory/packaging" || undefined}>Packaging</Link></li>
                </ul>}
              </SidebarMenuItem>
            </SidebarMenu>
          </nav>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <button type="button" className="sh-sidebar__account" aria-label="Sign out of Serenity Hue Operations" onClick={signOut}>
          <span className="sh-sidebar__account-avatar" aria-hidden="true">SH</span>
          <span className="sh-sidebar__account-copy"><strong>Serenity Hue</strong><small>Operations</small></span>
          <ExitIcon className="sh-sidebar__account-icon" aria-hidden="true" />
        </button>
      </SidebarFooter>
      <SidebarRail />
      <header className="mobile-topbar">
        <Link href="/overview" className="mobile-topbar__brand" aria-label="Serenity Hue Operations home"><span>Serenity Hue</span><small>Operations</small></Link>
        <button type="button" className="mobile-topbar__menu" aria-label="Open navigation" aria-expanded={mobileMenuOpen} aria-controls="mobile-workspace-navigation" onClick={() => setMobileMenuOpen(true)}><Menu aria-hidden="true" /></button>
      </header>
      <Dialog open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <DialogContent className="mobile-menu-dialog" aria-describedby="mobile-menu-description">
          <div className="mobile-menu-dialog__header"><DialogTitle>Workspace</DialogTitle><DialogDescription id="mobile-menu-description">Choose where you want to work.</DialogDescription></div>
          <nav id="mobile-workspace-navigation" className="mobile-menu-dialog__links" aria-label="Workspace navigation">
            {mobileMenuItems.map(({ href, label, icon: Icon }) => {
              const active = href === "/analytics" ? pathname.startsWith("/analytics") || pathname === "/kpis" : href === "/labs" ? pathname.startsWith("/labs") : pathname === href;
              return <Link href={href} key={href} data-active={active || undefined} aria-current={active ? "page" : undefined} onClick={() => setMobileMenuOpen(false)}><Icon aria-hidden="true" /><span>{label}</span></Link>;
            })}
          </nav>
        </DialogContent>
      </Dialog>
    </ShadcnSidebar>;
}
