"use client";

import { Columns3, Eye, EyeOff } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type TableColumn<T extends string> = { id: T; label: string };

export function TableColumnPicker<T extends string>({
  columns,
  visibleColumns,
  onToggle,
  onReset,
}: {
  columns: TableColumn<T>[];
  visibleColumns: T[];
  onToggle: (column: T) => void;
  onReset: () => void;
}) {
  return (
    <Popover>
      <PopoverTrigger className={buttonVariants({ variant: "outline", size: "compact" })}>
        <Columns3 size={16} strokeWidth={1.8} aria-hidden="true" />
        Columns
      </PopoverTrigger>
      <PopoverContent className="columns-popover" aria-label="Choose visible table columns">
        <div className="columns-popover__header">
          <div><strong>Columns</strong><span>Choose what appears in the table</span></div>
          <button className="columns-reset" type="button" onClick={onReset}>Reset</button>
        </div>
        <div className="columns-popover__list">
          {columns.map((column) => {
            const isVisible = visibleColumns.includes(column.id);
            return (
              <button className="column-option" type="button" key={column.id} role="switch" aria-checked={isVisible} onClick={() => onToggle(column.id)}>
                <span>{column.label}</span>
                {isVisible ? <Eye size={16} aria-hidden="true" /> : <EyeOff size={16} aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
