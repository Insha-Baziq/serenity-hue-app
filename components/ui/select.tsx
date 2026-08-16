"use client";

import * as SelectPrimitive from "@radix-ui/react-select";
import { CheckIcon, ChevronDownIcon } from "@radix-ui/react-icons";
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";

const Select = SelectPrimitive.Root;
const SelectValue = SelectPrimitive.Value;

const SelectTrigger = forwardRef<
  ElementRef<typeof SelectPrimitive.Trigger>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className = "", children, ...props }, ref) => (
  <SelectPrimitive.Trigger ref={ref} className={`ui-select-trigger ${className}`} {...props}>
    {children}
    <SelectPrimitive.Icon className="ui-select-icon">
      <ChevronDownIcon />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

const SelectContent = forwardRef<
  ElementRef<typeof SelectPrimitive.Content>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className = "", children, position = "popper", ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content ref={ref} className={`ui-select-content ${className}`} position={position} sideOffset={7} {...props}>
      <SelectPrimitive.Viewport className="ui-select-viewport">{children}</SelectPrimitive.Viewport>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = SelectPrimitive.Content.displayName;

const SelectItem = forwardRef<
  ElementRef<typeof SelectPrimitive.Item>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className = "", children, ...props }, ref) => (
  <SelectPrimitive.Item ref={ref} className={`ui-select-item ${className}`} {...props}>
    <span className="ui-select-item__indicator">
      <SelectPrimitive.ItemIndicator><CheckIcon /></SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));
SelectItem.displayName = SelectPrimitive.Item.displayName;

export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue };
