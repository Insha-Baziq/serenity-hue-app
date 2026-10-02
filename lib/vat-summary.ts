import "server-only";

import { getTursoClient } from "@/lib/turso";
import { sameSupplier, vatSummaryRange } from "@/lib/vat-rules";
import type { VatSummaryData, VatSummaryQuery, VatSummaryTotals } from "@/lib/vat-types";

// VAT accumulation over a period: what was paid, how much was VAT, by month and
// by supplier. Only approved saved invoices count (flagged ones wait for
// review). GBP only; other currencies are reported separately, never converted.

const FLAGGED = "EXISTS (SELECT 1 FROM json_each(i.notes_json) WHERE json_each.value IN ('duplicate', 'unsure'))";
const APPROVED = `i.status = 'saved' AND NOT (i.reviewed_at IS NULL AND ${FLAGGED})`;
const ESTIMATED = "EXISTS (SELECT 1 FROM json_each(i.notes_json) WHERE json_each.value = 'vat_estimated')";
const GBP = "COALESCE(upper(i.currency), 'GBP') = 'GBP'";

// Net falls back to total − VAT when a document only shows a total, so net + VAT = total.
const SUMS = `COUNT(*) AS invoices, COALESCE(SUM(COALESCE(i.net_amount_minor, i.gross_amount_minor - COALESCE(i.vat_amount_minor, 0))), 0) AS net, COALESCE(SUM(i.vat_amount_minor), 0) AS vat,
  COALESCE(SUM(i.gross_amount_minor), 0) AS gross, COALESCE(SUM(CASE WHEN ${ESTIMATED} THEN i.vat_amount_minor ELSE 0 END), 0) AS estimated`;

function totals(row: Record<string, unknown> | undefined): VatSummaryTotals {
  return {
    invoices: Number(row?.invoices ?? 0),
    netMinor: Number(row?.net ?? 0),
    vatMinor: Number(row?.vat ?? 0),
    grossMinor: Number(row?.gross ?? 0),
    estimatedVatMinor: Number(row?.estimated ?? 0),
  };
}

function shiftMonth(month: string, delta: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber - 1 + delta, 1)).toISOString().slice(0, 7);
}

export async function getVatSummary(query: VatSummaryQuery): Promise<VatSummaryData> {
  const db = await getTursoClient();
  const range = vatSummaryRange(query);
  // Invoices count on the day their email arrived (uploads: their invoice date), as the lists show.
  const date = "COALESCE(substr(e.received_at, 1, 10), i.invoice_date)";
  const conditions: string[] = [];
  const args: string[] = [];
  if (range.from) { conditions.push(`${date} >= ?`); args.push(range.from); }
  if (range.to) { conditions.push(`${date} < ?`); args.push(range.to); }
  const inRange = conditions.length ? `AND ${conditions.join(" AND ")}` : "";

  // A single month shows the six months up to it for context; longer periods show their own months.
  const singleMonth = range.from && range.to && shiftMonth(range.from.slice(0, 7), 1) === range.to.slice(0, 7);
  const monthFrom = singleMonth ? `${shiftMonth(range.from!.slice(0, 7), -5)}-01` : range.from;
  const monthArgs = [...(monthFrom ? [monthFrom] : []), ...(range.to ? [range.to] : [])];
  const monthRange = [monthFrom ? `${date} >= ?` : "", range.to ? `${date} < ?` : ""].filter(Boolean).join(" AND ");
  const from = "FROM vat_invoices i LEFT JOIN vat_emails e ON e.id = i.email_id";

  const [overall, months, suppliers, foreign, review] = await db.batch([
    { sql: `SELECT ${SUMS} ${from} WHERE ${APPROVED} AND ${GBP} ${inRange}`, args },
    {
      sql: `SELECT substr(${date}, 1, 7) AS month, ${SUMS} ${from} WHERE ${APPROVED} AND ${GBP} ${monthRange ? `AND ${monthRange}` : ""}
            GROUP BY month ORDER BY month`,
      args: monthArgs,
    },
    { sql: `SELECT i.supplier_name AS supplier, ${SUMS} ${from} WHERE ${APPROVED} AND ${GBP} ${inRange} GROUP BY i.supplier_name`, args },
    {
      sql: `SELECT upper(i.currency) AS currency, COUNT(*) AS invoices, COALESCE(SUM(i.vat_amount_minor), 0) AS vat, COALESCE(SUM(i.gross_amount_minor), 0) AS gross
            ${from} WHERE ${APPROVED} AND NOT ${GBP} ${inRange} GROUP BY upper(i.currency) ORDER BY currency`,
      args,
    },
    { sql: `SELECT COUNT(*) AS count ${from} WHERE i.status = 'saved' AND i.reviewed_at IS NULL AND ${FLAGGED} ${inRange}`, args },
  ], "read");

  // Merge name variants ("GoDaddy" / "Go Daddy Europe Limited") the same way duplicates are matched.
  const merged = new Map<string, VatSummaryTotals & { supplier: string; weight: number }>();
  const keys: string[] = [];
  for (const row of suppliers.rows) {
    const name = String(row.supplier ?? "Unknown supplier");
    const key = keys.find((existing) => sameSupplier(existing, name)) ?? name;
    if (!keys.includes(key)) keys.push(key);
    const value = totals(row as Record<string, unknown>);
    const current = merged.get(key);
    if (!current) {
      merged.set(key, { ...value, supplier: name, weight: value.invoices });
      continue;
    }
    merged.set(key, {
      supplier: value.invoices > current.weight ? name : current.supplier,
      weight: Math.max(value.invoices, current.weight),
      invoices: current.invoices + value.invoices,
      netMinor: current.netMinor + value.netMinor,
      vatMinor: current.vatMinor + value.vatMinor,
      grossMinor: current.grossMinor + value.grossMinor,
      estimatedVatMinor: current.estimatedVatMinor + value.estimatedVatMinor,
    });
  }

  return {
    query,
    range,
    totals: totals(overall.rows[0] as Record<string, unknown>),
    byMonth: months.rows.map((row) => ({ month: String(row.month), ...totals(row as Record<string, unknown>) })),
    bySupplier: [...merged.values()]
      .map((row) => ({ supplier: row.supplier, invoices: row.invoices, netMinor: row.netMinor, vatMinor: row.vatMinor, grossMinor: row.grossMinor, estimatedVatMinor: row.estimatedVatMinor }))
      .sort((a, b) => b.vatMinor - a.vatMinor || b.grossMinor - a.grossMinor),
    foreign: foreign.rows.map((row) => ({ currency: String(row.currency), invoices: Number(row.invoices), vatMinor: Number(row.vat), grossMinor: Number(row.gross) })),
    awaitingReview: Number(review.rows[0]?.count ?? 0),
  };
}
