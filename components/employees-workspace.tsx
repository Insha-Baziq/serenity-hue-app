"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { CheckCircle2, Mail, Plus, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useMemo, useState } from "react";
import { TableColumnPicker, type TableColumn } from "@/components/table-column-picker";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { relativeTime } from "@/lib/format";
import type { Employee } from "@/lib/types";

type EmployeeFilter = "all" | "active" | "offline";
type EmployeeColumnId = "email" | "status" | "joined" | "lastSeen";

const filters: { label: string; value: EmployeeFilter }[] = [
  { label: "Everyone", value: "all" },
  { label: "Online now", value: "active" },
  { label: "Offline", value: "offline" },
];

const columns: TableColumn<EmployeeColumnId>[] = [
  { id: "email", label: "Email" },
  { id: "status", label: "Status" },
  { id: "joined", label: "Joined" },
  { id: "lastSeen", label: "Last active" },
];

const defaultVisibleColumns = columns.map((column) => column.id);

export function EmployeesWorkspace({ initialEmployees }: { initialEmployees: Employee[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<EmployeeFilter>("all");
  const [visibleColumns, setVisibleColumns] = useState<EmployeeColumnId[]>(defaultVisibleColumns);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newEmployeeName, setNewEmployeeName] = useState("");
  const [newEmployeeEmail, setNewEmployeeEmail] = useState("");
  const [newEmployeePassword, setNewEmployeePassword] = useState("");
  const [dialogError, setDialogError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const employees = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return initialEmployees.filter((employee) => {
      const matchesQuery = !normalizedQuery || `${employee.name} ${employee.email}`.toLowerCase().includes(normalizedQuery);
      const matchesFilter = filter === "all" || employee.status === filter;
      return matchesQuery && matchesFilter;
    });
  }, [filter, initialEmployees, query]);

  const selectedEmployee = initialEmployees.find((employee) => employee.id === selectedId);

  function toggleColumn(column: EmployeeColumnId) {
    setVisibleColumns((current) => current.includes(column) ? current.filter((item) => item !== column) : [...current, column]);
  }

  function selectEmployee(employee: Employee) {
    setSelectedId(employee.id);
  }

  async function addEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDialogError("");
    setSubmitting(true);
    try {
      const response = await fetch("/api/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newEmployeeName, email: newEmployeeEmail, password: newEmployeePassword }),
      });
      const result = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) {
        setDialogError(result.message || "Unable to create the employee");
        return;
      }
      setDialogOpen(false);
      setNewEmployeeName("");
      setNewEmployeeEmail("");
      setNewEmployeePassword("");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="workspace workspace--employees">
      <header className="workspace-header employees-header">
        <div>
          <p className="workspace-kicker">Workspace access</p>
          <h1>Employees</h1>
          <p className="workspace-description">Keep track of the people who can sign in and work inside Serenity Hue Operations.</p>
        </div>
        <div className="header-actions employees-header__actions">
          <Dialog.Root open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (open) setDialogError(""); }}>
            <Dialog.Trigger asChild><Button variant="primary"><Plus size={17} strokeWidth={1.9} />Add employee</Button></Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="employee-dialog-overlay" />
              <Dialog.Content className="employee-dialog" aria-describedby="add-employee-description">
                <div className="employee-dialog__header"><div><p className="workspace-kicker">Workspace access</p><Dialog.Title className="employee-dialog__title">Add employee</Dialog.Title><Dialog.Description id="add-employee-description" className="employee-dialog__description">Create a secure sign-in for a new member of the operations team.</Dialog.Description></div><Dialog.Close className="employee-dialog__close" aria-label="Close add employee dialog"><X size={17} strokeWidth={1.8} /></Dialog.Close></div>
                <form className="employee-dialog__form" onSubmit={addEmployee}>
                  <label className="employee-dialog__field"><span>Full name</span><Input autoComplete="name" value={newEmployeeName} onChange={(event) => setNewEmployeeName(event.target.value)} placeholder="Employee name" required minLength={2} /></label>
                  <label className="employee-dialog__field"><span>Email address</span><Input autoComplete="email" type="email" value={newEmployeeEmail} onChange={(event) => setNewEmployeeEmail(event.target.value)} placeholder="employee@serenityhue.com" required /></label>
                  <label className="employee-dialog__field"><span>Temporary password</span><Input autoComplete="new-password" type="password" value={newEmployeePassword} onChange={(event) => setNewEmployeePassword(event.target.value)} placeholder="At least 8 characters" required minLength={8} /></label>
                  {dialogError && <p className="employee-dialog__error" role="alert">{dialogError}</p>}
                  <div className="employee-dialog__actions"><Dialog.Close asChild><Button variant="outline">Cancel</Button></Dialog.Close><Button variant="primary" type="submit" disabled={submitting}>{submitting ? "Creating…" : "Create employee"}</Button></div>
                </form>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </div>
      </header>

      <div className="orders-table-frame employees-table-frame">
        <div className="inventory-toolbar employees-toolbar">
          <label className="search-field search-field--inventory"><Search size={18} strokeWidth={1.8} aria-hidden="true" /><span className="sr-only">Search employees</span><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search employees" /></label>
        </div>
        <div className="inventory-tabs employees-tabs">
          <div role="tablist" aria-label="Employee status filter">
            {filters.map((item) => <button key={item.value} type="button" role="tab" aria-selected={filter === item.value} className={filter === item.value ? "is-selected" : ""} onClick={() => setFilter(item.value)}>{item.label}</button>)}
          </div>
          <TableColumnPicker columns={columns} visibleColumns={visibleColumns} onToggle={toggleColumn} onReset={() => setVisibleColumns(defaultVisibleColumns)} />
        </div>

        <div className="inventory-scroll">
          <table className="employees-table">
            <thead><tr><th>Employee</th>{visibleColumns.includes("email") && <th>Email</th>}{visibleColumns.includes("status") && <th>Status</th>}{visibleColumns.includes("joined") && <th>Joined</th>}{visibleColumns.includes("lastSeen") && <th>Last active</th>}</tr></thead>
            <tbody>{employees.map((employee) => <EmployeeRow employee={employee} key={employee.id} visibleColumns={visibleColumns} onSelect={() => selectEmployee(employee)} />)}</tbody>
          </table>
        </div>

        <div className="mobile-record-list mobile-employees-list" aria-label="Employees">
          {employees.map((employee) => <button className="mobile-record mobile-employee-card" key={employee.id} type="button" onClick={() => selectEmployee(employee)}><span className="mobile-record__header"><span className="employee-person"><span className="employee-avatar">{getInitials(employee.name)}</span><span><strong>{employee.name}</strong><small>{employee.email}</small></span></span><EmployeeStatus status={employee.status} /></span><span className="mobile-employee-card__footer"><span>Joined {formatDate(employee.createdAt)}</span><span>{employee.lastSeenAt ? `Last active ${relativeTime(employee.lastSeenAt)}` : "No recent activity"}</span></span></button>)}
        </div>
        {employees.length === 0 && <div className="table-empty">No employees match this search or filter.</div>}
      </div>

      <Sheet open={Boolean(selectedEmployee)} onOpenChange={(open) => !open && setSelectedId(undefined)}>
        <SheetContent className="employee-sheet" aria-describedby="employee-sheet-description">
          {selectedEmployee && <EmployeeDetails employee={selectedEmployee} />}
        </SheetContent>
      </Sheet>
    </section>
  );
}

function EmployeeRow({ employee, visibleColumns, onSelect }: { employee: Employee; visibleColumns: EmployeeColumnId[]; onSelect: () => void }) {
  return <tr tabIndex={0} onClick={onSelect} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(); } }} aria-label={`View ${employee.name}`}><td><span className="employee-person"><span className="employee-avatar">{getInitials(employee.name)}</span><span><strong>{employee.name}</strong><small>Workspace member</small></span></span></td>{visibleColumns.includes("email") && <td><span className="employee-email"><Mail size={14} strokeWidth={1.7} /><span>{employee.email}</span></span></td>}{visibleColumns.includes("status") && <td><EmployeeStatus status={employee.status} /></td>}{visibleColumns.includes("joined") && <td>{formatDate(employee.createdAt)}</td>}{visibleColumns.includes("lastSeen") && <td>{employee.lastSeenAt ? relativeTime(employee.lastSeenAt) : "No activity yet"}</td>}</tr>;
}

function EmployeeDetails({ employee }: { employee: Employee }) {
  return <div className="employee-details"><div className="employee-detail-header"><span className="employee-avatar employee-avatar--large">{getInitials(employee.name)}</span><div><p className="workspace-kicker">Workspace member</p><SheetTitle asChild><h2>{employee.name}</h2></SheetTitle><p>{employee.email}</p></div></div><SheetDescription id="employee-sheet-description" className="sr-only">Access details for {employee.name}.</SheetDescription><div className="employee-detail-status"><EmployeeStatus status={employee.status} /><span>{employee.status === "active" ? "Online now" : "Offline"}</span></div><section className="employee-detail-section"><h3>Account details</h3><div className="employee-detail-list"><span><small>Joined workspace</small><strong>{formatDate(employee.createdAt)}</strong></span><span><small>Last active</small><strong>{employee.lastSeenAt ? relativeTime(employee.lastSeenAt) : "No activity yet"}</strong></span><span><small>Access</small><strong>Workspace member</strong></span></div></section><div className="employee-detail-note"><CheckCircle2 size={17} strokeWidth={1.8} /><p>Account access is securely managed for this workspace.</p></div></div>;
}

function EmployeeStatus({ status }: { status: Employee["status"] }) {
  return <span className={`employee-status employee-status--${status}`}><i aria-hidden="true" />{status === "active" ? "Online" : "Offline"}</span>;
}

function getInitials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "SH";
}

function formatDate(iso: string) {
  if (!iso) return "Not available";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso));
}
