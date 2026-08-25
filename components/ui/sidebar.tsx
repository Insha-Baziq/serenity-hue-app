"use client";

import {
  createContext,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";

const SIDEBAR_STORAGE_KEY = "serenity-hue-sidebar";
const SIDEBAR_CHANGE_EVENT = "serenity-hue-sidebar-change";

function subscribeToSidebar(callback: () => void) {
  const handleChange = () => callback();
  window.addEventListener("storage", handleChange);
  window.addEventListener(SIDEBAR_CHANGE_EVENT, handleChange);
  return () => {
    window.removeEventListener("storage", handleChange);
    window.removeEventListener(SIDEBAR_CHANGE_EVENT, handleChange);
  };
}

function getSidebarSnapshot() {
  return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) !== "collapsed";
}

function getServerSidebarSnapshot() {
  return true;
}

type SidebarContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggleSidebar: () => void;
};

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function useSidebar() {
  const context = useContext(SidebarContext);
  if (!context) throw new Error("useSidebar must be used inside SidebarProvider.");
  return context;
}

export function SidebarProvider({ children, defaultOpen = true }: { children: ReactNode; defaultOpen?: boolean }) {
  const storedOpen = useSyncExternalStore(subscribeToSidebar, getSidebarSnapshot, getServerSidebarSnapshot);
  const [openOverride, setOpenOverride] = useState<boolean | undefined>(undefined);
  const open = openOverride ?? (defaultOpen && storedOpen);

  const updateOpen = useCallback((nextOpen: boolean) => {
    setOpenOverride(nextOpen);
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, nextOpen ? "expanded" : "collapsed");
    window.dispatchEvent(new Event(SIDEBAR_CHANGE_EVENT));
  }, []);

  const toggleSidebar = useCallback(() => updateOpen(!open), [open, updateOpen]);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
        event.preventDefault();
        toggleSidebar();
      }
    }

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [toggleSidebar]);

  return (
    <SidebarContext.Provider value={{ open, setOpen: updateOpen, toggleSidebar }}>
      <div className="sh-sidebar-provider" data-sidebar-state={open ? "expanded" : "collapsed"}>{children}</div>
    </SidebarContext.Provider>
  );
}

export function Sidebar({ children, className = "", ...props }: HTMLAttributes<HTMLElement>) {
  const { open } = useSidebar();
  return <aside className={`sh-sidebar ${className}`} data-state={open ? "expanded" : "collapsed"} {...props}>{children}</aside>;
}

export function SidebarHeader({ className = "", ...props }: HTMLAttributes<HTMLElement>) {
  return <header className={`sh-sidebar__header ${className}`} {...props} />;
}

export function SidebarContent({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`sh-sidebar__content ${className}`} {...props} />;
}

export function SidebarFooter({ className = "", ...props }: HTMLAttributes<HTMLElement>) {
  return <footer className={`sh-sidebar__footer ${className}`} {...props} />;
}

export function SidebarGroup({ className = "", ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={`sh-sidebar__group ${className}`} {...props} />;
}

export function SidebarGroupLabel({ className = "", ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={`sh-sidebar__group-label ${className}`} {...props} />;
}

export function SidebarMenu({ className = "", ...props }: HTMLAttributes<HTMLUListElement>) {
  return <ul className={`sh-sidebar__menu ${className}`} {...props} />;
}

export function SidebarMenuItem({ className = "", ...props }: HTMLAttributes<HTMLLIElement>) {
  return <li className={`sh-sidebar__menu-item ${className}`} {...props} />;
}

export function SidebarMenuButton({ className = "", isActive = false, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { isActive?: boolean }) {
  return <button className={`sh-sidebar__menu-button ${className}`} data-active={isActive || undefined} {...props} />;
}

export function SidebarRail() {
  const { open, toggleSidebar } = useSidebar();
  return <button className="sh-sidebar__rail" type="button" onClick={toggleSidebar} aria-label={open ? "Collapse navigation" : "Expand navigation"} title={open ? "Collapse navigation (Ctrl+B)" : "Expand navigation (Ctrl+B)"} />;
}

export function SidebarInset({ className = "", ...props }: HTMLAttributes<HTMLElement>) {
  return <main className={`sh-sidebar-inset ${className}`} {...props} />;
}
