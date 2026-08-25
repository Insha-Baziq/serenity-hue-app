"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArchiveIcon, AvatarIcon, ChevronDownIcon, CubeIcon, DashboardIcon, ExitIcon, LayersIcon, PersonIcon } from "@radix-ui/react-icons";
import { useState, type ElementType } from "react";
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
  { href: "/orders", label: "Orders", icon: ArchiveIcon },
  { href: "/customers", label: "Customers", icon: AvatarIcon },
  { href: "/employees", label: "Employees", icon: PersonIcon },
];

const mobileItems: NavigationItem[] = [
  { href: "/overview", label: "Overview", icon: DashboardIcon },
  { href: "/orders", label: "Orders", icon: ArchiveIcon },
  { href: "/customers", label: "Customers", icon: AvatarIcon },
  { href: "/employees", label: "Employees", icon: PersonIcon },
  { href: "/inventory/products", label: "Products", icon: CubeIcon },
  { href: "/inventory/packaging", label: "Packaging", icon: LayersIcon },
];

export function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const { open, setOpen } = useSidebar();
  const [inventoryOpen, setInventoryOpen] = useState(pathname.startsWith("/inventory"));
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
                const active = pathname === href;
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
      <nav aria-label="Mobile navigation" className="mobile-navigation">
        {mobileItems.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return <Link aria-current={active ? "page" : undefined} className="mobile-navigation__link" data-active={active || undefined} href={href} key={href}>
            <Icon aria-hidden="true" />
            <span>{label}</span>
          </Link>;
        })}
      </nav>
    </ShadcnSidebar>;
}
