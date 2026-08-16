"use client";

import { Download, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { TableColumnPicker, type TableColumn } from "@/components/table-column-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { relativeTime } from "@/lib/format";
import type { PackagingMaterial } from "@/lib/types";

type PackagingFilter = "all" | "in-stock" | "low" | "empty";
type PackagingColumnId = "quantity" | "reorderPoint" | "leadTime" | "updated" | "status";

const filters: { label: string; value: PackagingFilter }[] = [
  { label: "All materials", value: "all" },
  { label: "In stock", value: "in-stock" },
  { label: "Low stock", value: "low" },
  { label: "Empty", value: "empty" },
];

const columns: TableColumn<PackagingColumnId>[] = [
  { id: "quantity", label: "On hand" },
  { id: "reorderPoint", label: "Reorder point" },
  { id: "leadTime", label: "Lead time" },
  { id: "updated", label: "Last updated" },
  { id: "status", label: "Status" },
];

const defaultVisibleColumns = columns.map((column) => column.id);

export function PackagingWorkspace({ items }: { items: PackagingMaterial[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<PackagingFilter>("all");
  const [visibleColumns, setVisibleColumns] = useState<PackagingColumnId[]>(defaultVisibleColumns);
  const materials = useMemo(() => items.filter((item) => {
    const status = getStatus(item);
    const matchesQuery = !query.trim() || item.title.toLowerCase().includes(query.trim().toLowerCase());
    const matchesFilter = filter === "all" || (filter === "in-stock" && status === "In stock") || (filter === "low" && status === "Low stock") || (filter === "empty" && status === "Empty");
    return matchesQuery && matchesFilter;
  }), [filter, items, query]);

  function toggleColumn(column: PackagingColumnId) {
    setVisibleColumns((current) => current.includes(column) ? current.filter((item) => item !== column) : [...current, column]);
  }

  function exportPackaging() {
    const rows = [["Material", "On hand", "Reorder point", "Lead time", "Last updated", "Status"], ...items.map((item) => [item.title, item.quantity, item.reorderPoint, item.leadTimeDays ? `${item.leadTimeDays} days` : "Not set", item.updatedAt, getStatus(item)])];
    const csv = rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "serenity-hue-packaging.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="workspace workspace--packaging">
      <header className="workspace-header">
        <div>
          <p className="workspace-kicker">Inventory</p>
          <h1>Packaging</h1>
          <p className="workspace-description">Pouches, boxes, and other materials used to fulfil orders.</p>
        </div>
        <div className="header-actions"><Button variant="outline" onClick={exportPackaging}><Download size={17} />Export packaging</Button></div>
      </header>

      <div className="orders-table-frame packaging-table-frame">
        <div className="inventory-toolbar">
          <label className="search-field search-field--inventory"><Search size={18} strokeWidth={1.8} aria-hidden="true" /><span className="sr-only">Search packaging materials</span><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search packaging" /></label>
        </div>
        <div className="inventory-tabs">
          <div role="tablist" aria-label="Packaging filter">
            {filters.map((item) => <button key={item.value} type="button" role="tab" aria-selected={filter === item.value} className={filter === item.value ? "is-selected" : ""} onClick={() => setFilter(item.value)}>{item.label}</button>)}
          </div>
          <TableColumnPicker columns={columns} visibleColumns={visibleColumns} onToggle={toggleColumn} onReset={() => setVisibleColumns(defaultVisibleColumns)} />
        </div>
        <div className="inventory-scroll">
          <table className="packaging-table-grid">
            <thead><tr><th>Material</th>{visibleColumns.includes("quantity") && <th>On hand</th>}{visibleColumns.includes("reorderPoint") && <th>Reorder point</th>}{visibleColumns.includes("leadTime") && <th>Lead time</th>}{visibleColumns.includes("updated") && <th>Last updated</th>}{visibleColumns.includes("status") && <th>Status</th>}</tr></thead>
            <tbody>{materials.map((item) => <PackagingRow item={item} key={item.id} visibleColumns={visibleColumns} />)}</tbody>
          </table>
        </div>
        <div className="mobile-record-list mobile-packaging-list" aria-label="Packaging materials">
          {materials.map((item) => {
            const status = getStatus(item);
            const needsAttention = status !== "In stock";
            return (
              <article className="mobile-record mobile-packaging-card" key={item.id}>
                <div className="mobile-record__header"><span><strong>{item.title}</strong><small>{item.leadTimeDays ? `${item.leadTimeDays}-day lead time` : "Lead time not set"}</small></span><span className={`stock-status stock-status--${needsAttention ? "low" : "confirmed"}`}><i />{status}</span></div>
                <div className="mobile-packaging-card__metrics"><span><small>On hand</small><strong className={needsAttention ? "quantity-cell quantity-cell--low" : "quantity-cell"}>{item.quantity}</strong></span><span><small>Reorder point</small><strong>{item.reorderPoint}</strong></span><span><small>Last updated</small><strong>{item.updatedAt ? relativeTime(item.updatedAt) : "—"}</strong></span></div>
              </article>
            );
          })}
        </div>
        {materials.length === 0 && <div className="table-empty">No packaging materials match those filters.</div>}
      </div>
    </section>
  );
}

function PackagingRow({ item, visibleColumns }: { item: PackagingMaterial; visibleColumns: PackagingColumnId[] }) {
  const status = getStatus(item);
  const needsAttention = status !== "In stock";
  return <tr><td className="packaging-material"><strong>{item.title}</strong><small>{item.leadTimeDays ? `${item.leadTimeDays}-day lead time` : "Lead time not set"}</small></td>{visibleColumns.includes("quantity") && <td className={needsAttention ? "quantity-cell quantity-cell--low" : "quantity-cell"}>{item.quantity}</td>}{visibleColumns.includes("reorderPoint") && <td>{item.reorderPoint}</td>}{visibleColumns.includes("leadTime") && <td>{item.leadTimeDays ? `${item.leadTimeDays} days` : "—"}</td>}{visibleColumns.includes("updated") && <td>{item.updatedAt ? relativeTime(item.updatedAt) : "—"}</td>}{visibleColumns.includes("status") && <td><span className={`stock-status stock-status--${needsAttention ? "low" : "confirmed"}`}><i />{status}</span></td>}</tr>;
}

function getStatus(item: PackagingMaterial) {
  if (item.quantity <= 0) return "Empty";
  if (item.quantity <= item.reorderPoint) return "Low stock";
  return "In stock";
}
