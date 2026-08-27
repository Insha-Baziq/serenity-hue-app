"use client";

import { ChevronLeft, ChevronRight, Download, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TableColumnPicker, type TableColumn } from "@/components/table-column-picker";
import { ChannelPill, CustomerTypePill } from "@/components/status-pill";
import { compactTime, formatMoney, relativeTime } from "@/lib/format";
import { getPageItems } from "@/lib/pagination";
import type { Customer, CustomerType, SyncSnapshot } from "@/lib/types";

type CustomerFilter = "all" | "repeat" | "one-time";
type CustomerColumnId = "customer" | "email" | "phone" | "channels" | "orders" | "spent" | "lastOrder" | "type";

const columns: TableColumn<CustomerColumnId>[] = [
  { id: "customer", label: "Customer" },
  { id: "email", label: "Email" },
  { id: "phone", label: "Phone" },
  { id: "channels", label: "Channels" },
  { id: "orders", label: "Orders" },
  { id: "spent", label: "Total spent" },
  { id: "lastOrder", label: "Last order" },
  { id: "type", label: "Customer type" },
];

const defaultVisibleColumns = columns.map((column) => column.id);

export function CustomersWorkspace({ initialCustomers, initialSync }: { initialCustomers: Customer[]; initialSync: SyncSnapshot }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<CustomerFilter>("all");
  const [visibleColumns, setVisibleColumns] = useState<CustomerColumnId[]>(defaultVisibleColumns);
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);

  const customers = useMemo(() => {
    const search = query.trim().toLowerCase();
    return initialCustomers.filter((customer) => {
      const haystack = [customer.name, customer.email, customer.phone, ...customer.channels, customer.type].join(" ").toLowerCase();
      const matchesFilter = filter === "all" || customer.type === filter;
      return matchesFilter && (!search || haystack.includes(search));
    });
  }, [filter, initialCustomers, query]);

  const totalPages = Math.max(1, Math.ceil(customers.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = customers.length === 0 ? 0 : (currentPage - 1) * pageSize;
  const pageEnd = Math.min(pageStart + pageSize, customers.length);
  const visibleCustomers = customers.slice(pageStart, pageEnd);
  const pageItems = getPageItems(currentPage, totalPages);
  const syncCaption = initialSync.lastSyncedAt ? `reconciled ${relativeTime(initialSync.lastSyncedAt)}` : initialSync.message;

  function resetPage() {
    setPage(1);
  }

  function toggleColumn(column: CustomerColumnId) {
    setVisibleColumns((current) => current.includes(column) ? current.filter((item) => item !== column) : [...current, column]);
  }

  function exportCustomers() {
    const rows = [
      ["Customer", "Email", "Phone", "Channels", "Orders", "Total spent", "Last order", "Customer type"],
      ...customers.map((customer) => [
        customer.name,
        customer.email,
        customer.phone,
        customer.channels.map((channel) => channel === "shopify" ? "Shopify" : "TikTok Shop").join(" / "),
        customer.orders,
        (customer.totalSpent / 100).toFixed(2),
        customer.lastOrderAt,
        customerTypeLabel(customer.type),
      ]),
    ];
    const csv = rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "serenity-hue-customers.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="workspace workspace--customers">
      <header className="workspace-header">
        <div>
          <p className="workspace-kicker">Customer operations</p>
          <h1>Customers</h1>
          <div className="live-caption">
            <span>Shopify + TikTok Shop</span>
            <span aria-hidden="true">·</span>
            <span>{syncCaption}</span>
            <span className={`live-dot live-dot--${initialSync.status}`} aria-hidden="true" />
            <span>{initialSync.status === "healthy" ? "Order history live" : "Sync needs attention"}</span>
          </div>
        </div>
        <div className="header-actions">
          <Button variant="primary" onClick={exportCustomers}>
            <Download size={17} aria-hidden="true" />
            Export customers
          </Button>
        </div>
      </header>

      <div className="customers-toolbar">
        <label className="search-field search-field--customers">
          <Search size={18} strokeWidth={1.8} aria-hidden="true" />
          <span className="sr-only">Search customers</span>
          <Input value={query} onChange={(event) => { setQuery(event.target.value); resetPage(); }} placeholder="Search customer, email or phone" />
        </label>
      </div>

      <Card className="customers-table-frame">
        <CardHeader className="customers-table-header">
          <Tabs value={filter} onValueChange={(value) => { setFilter(value as CustomerFilter); resetPage(); }}>
            <TabsList aria-label="Customer type filter" className="customers-tabs-list">
              <TabsTrigger value="all">All customers</TabsTrigger>
              <TabsTrigger value="repeat">Repeat customers</TabsTrigger>
              <TabsTrigger value="one-time">One-time customers</TabsTrigger>
            </TabsList>
          </Tabs>
          <TableColumnPicker columns={columns} visibleColumns={visibleColumns} onToggle={toggleColumn} onReset={() => setVisibleColumns(defaultVisibleColumns)} />
        </CardHeader>

        <CardContent className="customers-table-content">
          {customers.length > 0 ? <Table className="customers-table">
            <TableHeader>
              <TableRow>
                {visibleColumns.includes("customer") && <TableHead>Customer</TableHead>}
                {visibleColumns.includes("email") && <TableHead>Email</TableHead>}
                {visibleColumns.includes("phone") && <TableHead>Phone</TableHead>}
                {visibleColumns.includes("channels") && <TableHead>Channels</TableHead>}
                {visibleColumns.includes("orders") && <TableHead>Orders</TableHead>}
                {visibleColumns.includes("spent") && <TableHead>Total spent</TableHead>}
                {visibleColumns.includes("lastOrder") && <TableHead>Last order</TableHead>}
                {visibleColumns.includes("type") && <TableHead>Customer type</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleCustomers.map((customer) => <CustomerTableRow customer={customer} visibleColumns={visibleColumns} key={customer.id} />)}
            </TableBody>
          </Table> : <div className="table-empty">No customers match those filters.</div>}

          <div className="mobile-record-list mobile-customer-list" aria-label="Customers">
            {visibleCustomers.map((customer) => <CustomerCard customer={customer} key={customer.id} />)}
          </div>
        </CardContent>

        <CardFooter className="table-footer">
          <div className="page-size-control">
            <Select value={String(pageSize)} onValueChange={(value) => { setPageSize(Number(value)); resetPage(); }}>
              <SelectTrigger aria-label="Customers per page"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="25">25 per page</SelectItem>
                <SelectItem value="40">40 per page</SelectItem>
                <SelectItem value="50">50 per page</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="pagination" aria-label="Pagination">
            <span className="pagination-summary">{pageStart + (customers.length ? 1 : 0)}–{pageEnd} of {customers.length}</span>
            <Button variant="ghost" size="icon" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={currentPage === 1} aria-label="Previous page"><ChevronLeft size={16} /></Button>
            {pageItems.map((item, index) => item === "ellipsis" ? <span className="pagination-ellipsis" key={`ellipsis-${index}`}>…</span> : <Button variant="ghost" size="compact" key={item} className={item === currentPage ? "is-current" : ""} aria-current={item === currentPage ? "page" : undefined} onClick={() => setPage(item)}>{item}</Button>)}
            <Button variant="ghost" size="icon" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={currentPage === totalPages} aria-label="Next page"><ChevronRight size={16} /></Button>
          </div>
        </CardFooter>
      </Card>
    </section>
  );
}

function CustomerTableRow({ customer, visibleColumns }: { customer: Customer; visibleColumns: CustomerColumnId[] }) {
  return <TableRow>
    {visibleColumns.includes("customer") && <TableCell className="customer-name-cell"><strong>{customer.name}</strong></TableCell>}
    {visibleColumns.includes("email") && <TableCell>{customer.email || "—"}</TableCell>}
    {visibleColumns.includes("phone") && <TableCell>{customer.phone || "—"}</TableCell>}
    {visibleColumns.includes("channels") && <TableCell><div className="customer-channels">{customer.channels.map((channel) => <ChannelPill channel={channel} key={channel} />)}</div></TableCell>}
    {visibleColumns.includes("orders") && <TableCell className="customer-number-cell">{customer.orders}</TableCell>}
    {visibleColumns.includes("spent") && <TableCell className="total-cell">{formatMoney(customer.totalSpent)}</TableCell>}
    {visibleColumns.includes("lastOrder") && <TableCell className="date-cell date-cell--single">{compactTime(customer.lastOrderAt)}</TableCell>}
    {visibleColumns.includes("type") && <TableCell><CustomerTypePill type={customer.type} /></TableCell>}
  </TableRow>;
}

function CustomerCard({ customer }: { customer: Customer }) {
  return <Card className="mobile-record mobile-customer-card">
    <CardHeader className="mobile-customer-card__header">
      <div><CardTitle>{customer.name}</CardTitle><CardDescription>{customer.email || "No email recorded"}</CardDescription></div>
      <CustomerTypePill type={customer.type} />
    </CardHeader>
    <CardContent className="mobile-customer-card__content">
      <div className="mobile-customer-card__contact"><span><small>Phone</small><strong>{customer.phone || "—"}</strong></span><span><small>Channels</small><span className="customer-channels">{customer.channels.map((channel) => <ChannelPill channel={channel} key={channel} />)}</span></span></div>
      <div className="mobile-customer-card__metrics"><span><small>Orders</small><strong>{customer.orders}</strong></span><span><small>Total spent</small><strong>{formatMoney(customer.totalSpent)}</strong></span><span><small>Last order</small><strong>{compactTime(customer.lastOrderAt)}</strong></span></div>
    </CardContent>
  </Card>;
}

function customerTypeLabel(type: CustomerType) {
  if (type === "repeat") return "Repeat customer";
  if (type === "guest") return "Guest customer";
  return "One-time customer";
}
