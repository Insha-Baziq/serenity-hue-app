"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Cross2Icon } from "@radix-ui/react-icons";
import type { ComponentPropsWithoutRef, ElementRef } from "react";
import { forwardRef } from "react";

const Sheet = Dialog.Root;
const SheetTrigger = Dialog.Trigger;
const SheetClose = Dialog.Close;
const SheetTitle = Dialog.Title;
const SheetDescription = Dialog.Description;

const SheetContent = forwardRef<
  ElementRef<typeof Dialog.Content>,
  ComponentPropsWithoutRef<typeof Dialog.Content> & { showCloseButton?: boolean }
>(({ children, className = "", showCloseButton = true, ...props }, ref) => (
  <Dialog.Portal>
    <Dialog.Overlay className="ui-sheet-overlay" />
    <Dialog.Content ref={ref} className={`ui-sheet ui-sheet--right ${className}`} {...props}>
      {showCloseButton && (
        <Dialog.Close className="ui-sheet-close" aria-label="Close details">
          <Cross2Icon />
        </Dialog.Close>
      )}
      {children}
    </Dialog.Content>
  </Dialog.Portal>
));
SheetContent.displayName = Dialog.Content.displayName;

export { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle, SheetTrigger };
