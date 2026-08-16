"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Boxes, ChevronDown, ClipboardList, Home, Package, type LucideIcon } from "lucide-react";
import { useState } from "react";

const primaryItems: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/overview", label: "Overview", icon: Home },
  { href: "/orders", label: "Orders", icon: ClipboardList },
];

const mobileItems: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/overview", label: "Overview", icon: Home },
  { href: "/orders", label: "Orders", icon: ClipboardList },
  { href: "/inventory/products", label: "Products", icon: Package },
  { href: "/inventory/packaging", label: "Packaging", icon: Boxes },
];

export function Sidebar() {
  const pathname = usePathname();
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const inventoryActive = pathname.startsWith("/inventory");
  return (
    <aside className="sidebar">
      <div className="brand-lockup">
        <Image src="/serenity-hue-logo-black.png" alt="Serenity Hue by Shabina" width={122} height={122} priority />
      </div>
      <nav aria-label="Main navigation" className="nav-list nav-list--desktop">
        {primaryItems.map(({ href, label, icon: Icon }) => (
          <Link className={`nav-link ${pathname === href ? "is-active" : ""}`} href={href} key={href} onClick={() => setInventoryOpen(false)}>
            <Icon aria-hidden="true" size={19} strokeWidth={1.65} />
            <span>{label}</span>
          </Link>
        ))}
        <button type="button" className={`nav-link nav-link--inventory ${inventoryActive ? "is-active" : ""}`} aria-expanded={inventoryOpen} aria-controls="inventory-navigation" onClick={() => setInventoryOpen((open) => !open)}>
          <Package aria-hidden="true" size={19} strokeWidth={1.65} />
          <span>Inventory</span>
          <ChevronDown className={inventoryOpen ? "inventory-chevron is-open" : "inventory-chevron"} aria-hidden="true" size={16} strokeWidth={1.8} />
        </button>
        {inventoryOpen && <div className="inventory-subnav" id="inventory-navigation">
          <Link className={pathname === "/inventory/products" ? "inventory-subnav__link is-active" : "inventory-subnav__link"} href="/inventory/products" onClick={() => setInventoryOpen(false)}>Products</Link>
          <Link className={pathname === "/inventory/packaging" ? "inventory-subnav__link is-active" : "inventory-subnav__link"} href="/inventory/packaging" onClick={() => setInventoryOpen(false)}>Packaging</Link>
        </div>}
      </nav>
      <nav aria-label="Mobile navigation" className="mobile-navigation">
        {mobileItems.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return <Link aria-current={active ? "page" : undefined} className={active ? "mobile-navigation__link is-active" : "mobile-navigation__link"} href={href} key={href}>
            <Icon aria-hidden="true" size={20} strokeWidth={1.7} />
            <span>{label}</span>
          </Link>;
        })}
      </nav>
    </aside>
  );
}
