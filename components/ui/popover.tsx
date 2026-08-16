"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";

type PopoverContextValue = { open: boolean; setOpen: (open: boolean) => void };

const PopoverContext = createContext<PopoverContextValue | null>(null);

function usePopoverContext() {
  const context = useContext(PopoverContext);
  if (!context) throw new Error("Popover components must be used inside a Popover.");
  return context;
}

function Popover({ children, open: controlledOpen, onOpenChange }: { children: ReactNode; open?: boolean; onOpenChange?: (open: boolean) => void }) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const open = controlledOpen ?? uncontrolledOpen;

  const setOpen = useCallback((nextOpen: boolean) => {
    if (controlledOpen === undefined) setUncontrolledOpen(nextOpen);
    onOpenChange?.(nextOpen);
  }, [controlledOpen, onOpenChange]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }

    if (open) document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open, setOpen]);

  return <PopoverContext.Provider value={{ open, setOpen }}><div ref={rootRef} className="ui-popover">{children}</div></PopoverContext.Provider>;
}

function PopoverTrigger({ children, onClick, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  const { open, setOpen } = usePopoverContext();
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-haspopup="dialog"
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) setOpen(!open);
      }}
      {...props}
    >
      {children}
    </button>
  );
}

function PopoverContent({ children, onKeyDown, ...props }: HTMLAttributes<HTMLDivElement>) {
  const { open, setOpen } = usePopoverContext();
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="false"
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.key === "Escape") setOpen(false);
      }}
      {...props}
    >
      {children}
    </div>
  );
}

export { Popover, PopoverContent, PopoverTrigger };
