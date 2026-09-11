"use client";

import { Download, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useMemo, useState } from "react";
import { TableColumnPicker, type TableColumn } from "@/components/table-column-picker";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { relativeTime } from "@/lib/format";
import type { PackagingMaterial } from "@/lib/types";

type PackagingFilter = "all" | "in-stock" | "low" | "empty";
type PackagingColumnId = "quantity" | "reorderPoint" | "updated" | "status";
type PackagingDialogMode = "add" | "edit";

const filters: { label: string; value: PackagingFilter }[] = [
  { label: "All materials", value: "all" },
  { label: "In stock", value: "in-stock" },
  { label: "Low stock", value: "low" },
  { label: "Empty", value: "empty" },
];

const columns: TableColumn<PackagingColumnId>[] = [
  { id: "quantity", label: "On hand" },
  { id: "reorderPoint", label: "Reorder point" },
  { id: "updated", label: "Last updated" },
  { id: "status", label: "Status" },
];

const defaultVisibleColumns = columns.map((column) => column.id);

export function PackagingWorkspace({ items }: { items: PackagingMaterial[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<PackagingFilter>("all");
  const [visibleColumns, setVisibleColumns] = useState<PackagingColumnId[]>(defaultVisibleColumns);
  const [dialogMode, setDialogMode] = useState<PackagingDialogMode | null>(null);
  const [editingItem, setEditingItem] = useState<PackagingMaterial | null>(null);
  const [formTitle, setFormTitle] = useState("");
  const [formQuantity, setFormQuantity] = useState("");
  const [dialogError, setDialogError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deletingItem, setDeletingItem] = useState<PackagingMaterial | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);

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

  function openAddDialog() {
    setEditingItem(null);
    setFormTitle("");
    setFormQuantity("");
    setDialogError("");
    setDialogMode("add");
  }

  function openEditDialog(item: PackagingMaterial) {
    setEditingItem(item);
    setFormTitle(item.title);
    setFormQuantity(String(item.quantity));
    setDialogError("");
    setDialogMode("edit");
  }

  function closeFormDialog(open: boolean) {
    if (!submitting) {
      setDialogMode(open ? dialogMode : null);
      if (!open) setDialogError("");
    }
  }

  async function submitPackaging(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDialogError("");
    const title = formTitle.trim();
    if (!formQuantity.trim()) {
      setDialogError("Enter the quantity currently on hand.");
      return;
    }
    const quantity = Number(formQuantity);
    if (title.length < 2) {
      setDialogError("Enter a packaging name.");
      return;
    }
    if (!Number.isSafeInteger(quantity) || quantity < 0) {
      setDialogError("Quantity must be a whole number of zero or more.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/inventory/packaging", {
        method: dialogMode === "edit" ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingItem?.id, title, quantity }),
      });
      const result = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) {
        setDialogError(result.message || "Unable to save this packaging option.");
        return;
      }
      setDialogMode(null);
      router.refresh();
    } catch {
      setDialogError("Unable to save this packaging option. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function openDeleteDialog(item: PackagingMaterial) {
    setDeletingItem(item);
    setDeleteError("");
  }

  async function confirmDelete() {
    if (!deletingItem) return;
    setDeleteError("");
    setDeleting(true);
    try {
      const response = await fetch("/api/inventory/packaging", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: deletingItem.id }),
      });
      const result = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) {
        setDeleteError(result.message || "Unable to delete this packaging option.");
        return;
      }
      setDeletingItem(null);
      router.refresh();
    } catch {
      setDeleteError("Unable to delete this packaging option. Check your connection and try again.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section className="workspace workspace--packaging">
      <header className="workspace-header">
        <div>
          <h1>Packaging</h1>
        </div>
        <div className="header-actions">
          <Button variant="outline" onClick={exportPackaging}><Download size={17} />Export packaging</Button>
          <Button variant="primary" onClick={openAddDialog}><Plus size={17} strokeWidth={1.9} />Add packaging</Button>
        </div>
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
            <thead><tr><th>Material</th>{visibleColumns.includes("quantity") && <th>On hand</th>}{visibleColumns.includes("reorderPoint") && <th>Reorder point</th>}{visibleColumns.includes("updated") && <th>Last updated</th>}{visibleColumns.includes("status") && <th>Status</th>}<th className="packaging-actions-heading">Actions</th></tr></thead>
            <tbody>{materials.map((item) => <PackagingRow item={item} key={item.id} visibleColumns={visibleColumns} onEdit={openEditDialog} onDelete={openDeleteDialog} />)}</tbody>
          </table>
        </div>
        <div className="mobile-record-list mobile-packaging-list" aria-label="Packaging materials">
          {materials.map((item) => {
            const status = getStatus(item);
            const needsAttention = status !== "In stock";
            return (
              <article className="mobile-record mobile-packaging-card" key={item.id}>
                <div className="mobile-record__header"><span><strong>{item.title}</strong></span><span className="mobile-packaging-card__actions"><span className={`stock-status stock-status--${needsAttention ? "low" : "confirmed"}`}><i />{status}</span><PackagingActionButtons item={item} onEdit={openEditDialog} onDelete={openDeleteDialog} /></span></div>
                <div className="mobile-packaging-card__metrics"><span><small>On hand</small><strong className={needsAttention ? "quantity-cell quantity-cell--low" : "quantity-cell"}>{item.quantity}</strong></span><span><small>Reorder point</small><strong>{item.reorderPoint}</strong></span><span><small>Last updated</small><strong>{item.updatedAt ? relativeTime(item.updatedAt) : "—"}</strong></span></div>
              </article>
            );
          })}
        </div>
        {materials.length === 0 && <div className="table-empty">No packaging materials match those filters.</div>}
      </div>

      <Dialog open={dialogMode !== null} onOpenChange={closeFormDialog}>
        <DialogContent className="packaging-dialog" aria-describedby="packaging-dialog-description">
          <div className="packaging-dialog__header"><div><p className="workspace-kicker">Inventory control</p><DialogTitle>{dialogMode === "edit" ? "Edit packaging" : "Add packaging"}</DialogTitle><DialogDescription id="packaging-dialog-description">{dialogMode === "edit" ? "Update the name or current count for this packaging option." : "Add a pouch or other packaging material and record its current count."}</DialogDescription></div></div>
          <form className="packaging-dialog__form" onSubmit={submitPackaging}>
            <label className="packaging-dialog__field"><span>Packaging name</span><Input value={formTitle} onChange={(event) => setFormTitle(event.target.value)} placeholder="e.g. Large Pouch" autoFocus required minLength={2} maxLength={80} /></label>
            <label className="packaging-dialog__field"><span>Quantity on hand</span><Input value={formQuantity} onChange={(event) => setFormQuantity(event.target.value)} type="number" inputMode="numeric" min="0" step="1" placeholder="Enter a whole number" required /></label>
            {dialogError && <p className="packaging-dialog__error" role="alert">{dialogError}</p>}
            <div className="packaging-dialog__actions"><Button variant="outline" onClick={() => setDialogMode(null)} disabled={submitting}>Cancel</Button><Button variant="primary" type="submit" disabled={submitting}>{submitting ? "Saving…" : dialogMode === "edit" ? "Save changes" : "Add packaging"}</Button></div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deletingItem)} onOpenChange={(open) => { if (!open && !deleting) { setDeletingItem(null); setDeleteError(""); } }}>
        <DialogContent className="packaging-dialog packaging-dialog--delete" aria-describedby="packaging-delete-description">
          <div className="packaging-dialog__header"><div><p className="workspace-kicker">Remove material</p><DialogTitle>Delete packaging option?</DialogTitle><DialogDescription id="packaging-delete-description">{deletingItem ? `${deletingItem.title} will be removed from the active packaging list. Historical stock movements are kept.` : "This packaging option will be removed from the active list."}</DialogDescription></div></div>
          {deleteError && <p className="packaging-dialog__error" role="alert">{deleteError}</p>}
          <div className="packaging-dialog__actions"><Button variant="outline" onClick={() => setDeletingItem(null)} disabled={deleting}>Cancel</Button><Button variant="primary" className="packaging-dialog__delete-button" onClick={confirmDelete} disabled={deleting}>{deleting ? "Deleting…" : "Delete packaging"}</Button></div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function PackagingRow({ item, visibleColumns, onEdit, onDelete }: { item: PackagingMaterial; visibleColumns: PackagingColumnId[]; onEdit: (item: PackagingMaterial) => void; onDelete: (item: PackagingMaterial) => void }) {
  const status = getStatus(item);
  const needsAttention = status !== "In stock";
  return <tr><td className="packaging-material"><strong>{item.title}</strong></td>{visibleColumns.includes("quantity") && <td className={needsAttention ? "quantity-cell quantity-cell--low" : "quantity-cell"}>{item.quantity}</td>}{visibleColumns.includes("reorderPoint") && <td>{item.reorderPoint}</td>}{visibleColumns.includes("updated") && <td>{item.updatedAt ? relativeTime(item.updatedAt) : "—"}</td>}{visibleColumns.includes("status") && <td><span className={`stock-status stock-status--${needsAttention ? "low" : "confirmed"}`}><i />{status}</span></td>}<td className="packaging-actions-cell"><PackagingActionButtons item={item} onEdit={onEdit} onDelete={onDelete} /></td></tr>;
}

function PackagingActionButtons({ item, onEdit, onDelete }: { item: PackagingMaterial; onEdit: (item: PackagingMaterial) => void; onDelete: (item: PackagingMaterial) => void }) {
  return <span className="packaging-action-buttons"><button type="button" className="packaging-action-button packaging-action-button--edit" aria-label={`Edit ${item.title}`} title={`Edit ${item.title}`} data-testid={`packaging-edit-${item.id}`} onClick={() => onEdit(item)}><Pencil size={16} strokeWidth={1.9} /></button><button type="button" className="packaging-action-button packaging-action-button--delete" aria-label={`Delete ${item.title}`} title={`Delete ${item.title}`} data-testid={`packaging-delete-${item.id}`} onClick={() => onDelete(item)}><Trash2 size={16} strokeWidth={1.9} /></button></span>;
}

function getStatus(item: PackagingMaterial) {
  if (item.quantity <= 0) return "Empty";
  if (item.quantity <= item.reorderPoint) return "Low stock";
  return "In stock";
}
