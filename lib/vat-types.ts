// Shared VAT workspace contracts. Safe for client components: no credentials,
// tokens, or provider payloads appear in these shapes.

export type VatInvoiceStatus = "saved" | "to_get" | "removed";
export type VatTab = "summary" | "saved" | "to_get" | "ignored" | "removed";
export type VatVatLine = { rate: number; netMinor: number; vatMinor: number };

export type VatInvoiceRow = {
  id: number;
  emailId: string | null;
  source: "email" | "manual";
  documentType: string | null;
  supplierName: string | null;
  supplierVatNumber: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  currency: string | null;
  netMinor: number | null;
  vatMinor: number | null;
  grossMinor: number | null;
  status: VatInvoiceStatus;
  notes: string[];
  portalUrl: string | null;
  fileName: string | null;
  dropboxUrl: string | null;
  /** The file was filed by the earlier standalone app's Dropbox account. */
  legacyFile: boolean;
  hasFile: boolean;
  /** Flagged Possible duplicate or Check, and not yet kept by staff. Left out of the accountant's log. */
  needsReview: boolean;
  emailSubject: string | null;
  emailFrom: string | null;
  /** When the source email arrived (null for uploads). */
  receivedAt: string | null;
  removedReason: string | null;
  removedAt: string | null;
  removedBy: string | null;
  updatedAt: string;
};

export type VatInvoiceDetail = VatInvoiceRow & {
  vatBreakdown: VatVatLine[];
  originalInvoiceNumber: string | null;
  inbox: string | null;
  updatedBy: string | null;
  createdAt: string;
  events: VatEventRow[];
  /** Other saved invoices from the same supplier within 14 days, for deciding duplicates. */
  similar: VatInvoiceRow[];
};

export type VatEventRow = {
  id: string;
  occurredAt: string;
  actor: string;
  action: string;
  summary: string;
};

export type VatEmailRow = {
  id: string;
  fromName: string | null;
  fromEmail: string | null;
  subject: string | null;
  receivedAt: string;
  category: string | null;
  status: "ignored" | "error";
  error: string | null;
  inbox: string | null;
  decidedBy: "jev" | "owner";
};

export type VatMailboxRow = {
  id: number;
  provider: "google" | "microsoft";
  email: string;
  connected: boolean;
  connectedBy: string | null;
  connectedAt: string | null;
  lastError: string | null;
  lastSyncedAt: string | null;
};

export type VatConnectionState = {
  dropbox: {
    configured: boolean;
    connected: boolean;
    accountEmail: string | null;
    connectedBy: string | null;
    connectedAt: string | null;
    lastError: string | null;
  };
  outlook: { configured: boolean };
  /** Environment variable names still missing (never values). */
  missingSettings: string[];
  redirectUris: { dropbox: string; outlook: string };
  mailboxes: VatMailboxRow[];
  /** Which key each service uses, by its last four characters only. */
  apiKeys: Array<{ service: "jev" | "llama"; name: string; source: "app" | "server" | "missing"; last4: string | null; updatedBy: string | null; updatedAt: string | null }>;
};

export type VatWorkspaceQuery = { tab: VatTab; month: string | null; page: number; review: boolean };

export type VatWorkspaceData = {
  query: VatWorkspaceQuery;
  counts: Record<VatTab, number>;
  /** Saved invoices still waiting for review (in the selected month). */
  reviewCount: number;
  invoices: VatInvoiceRow[];
  emails: VatEmailRow[];
  total: number;
  pageSize: number;
  pageCount: number;
  months: string[];
  syncStartDate: string | null;
  connections: VatConnectionState;
};

export type VatInvoiceFieldsInput = {
  documentType?: string | null;
  supplierName?: string | null;
  supplierVatNumber?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  dueDate?: string | null;
  currency?: string | null;
  netAmount?: string | null;
  vatAmount?: string | null;
  grossAmount?: string | null;
};

export type VatSummaryPreset = "month" | "last_month" | "quarter" | "year" | "all" | "custom";
export type VatSummaryQuery = { preset: VatSummaryPreset; month: string; from: string | null; to: string | null };

export type VatSummaryTotals = { invoices: number; netMinor: number; vatMinor: number; grossMinor: number; estimatedVatMinor: number };

export type VatSummaryData = {
  query: VatSummaryQuery;
  /** Inclusive start and exclusive end (YYYY-MM-DD); null means no limit. */
  range: { from: string | null; to: string | null; label: string };
  totals: VatSummaryTotals;
  byMonth: Array<VatSummaryTotals & { month: string }>;
  bySupplier: Array<VatSummaryTotals & { supplier: string }>;
  /** Not converted to GBP: shown separately in their own currency. */
  foreign: Array<{ currency: string; invoices: number; vatMinor: number; grossMinor: number }>;
  awaitingReview: number;
};
