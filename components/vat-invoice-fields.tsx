"use client";

import { Input } from "@/components/ui/input";
import { minorToDecimal } from "@/lib/vat-money";
import { VAT_DOC_TYPE_LABELS } from "@/lib/vat-rules";
import type { VatInvoiceForm } from "@/lib/vat-client";
import type { VatInvoiceRow } from "@/lib/vat-types";
import styles from "./vat-workspace.module.css";

export function vatFormFromInvoice(invoice: VatInvoiceRow | null): VatInvoiceForm {
  return {
    documentType: invoice?.documentType ?? "",
    supplierName: invoice?.supplierName ?? "",
    supplierVatNumber: invoice?.supplierVatNumber ?? "",
    invoiceNumber: invoice?.invoiceNumber ?? "",
    invoiceDate: invoice?.invoiceDate ?? "",
    dueDate: invoice?.dueDate ?? "",
    currency: invoice?.currency ?? "GBP",
    netAmount: minorToDecimal(invoice?.netMinor) ?? "",
    vatAmount: minorToDecimal(invoice?.vatMinor) ?? "",
    grossAmount: minorToDecimal(invoice?.grossMinor) ?? "",
  };
}

type Props = { form: VatInvoiceForm; onChange: (form: VatInvoiceForm) => void; disabled?: boolean; idPrefix: string };

export function VatInvoiceFields({ form, onChange, disabled, idPrefix }: Props) {
  const set = (key: keyof VatInvoiceForm) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => onChange({ ...form, [key]: event.target.value });
  const id = (key: string) => `${idPrefix}-${key}`;
  return <div className={styles.formGrid}>
    <label className={`${styles.field} ${styles.fieldWide}`} htmlFor={id("supplier")}>Supplier
      <Input id={id("supplier")} className={styles.input} value={form.supplierName} onChange={set("supplierName")} disabled={disabled} required maxLength={200} />
    </label>
    <label className={styles.field} htmlFor={id("date")}>Invoice date
      <Input id={id("date")} className={styles.input} type="date" value={form.invoiceDate} onChange={set("invoiceDate")} disabled={disabled} />
    </label>
    <label className={styles.field} htmlFor={id("number")}>Invoice no
      <Input id={id("number")} className={styles.input} value={form.invoiceNumber} onChange={set("invoiceNumber")} disabled={disabled} maxLength={80} />
    </label>
    <label className={styles.field} htmlFor={id("type")}>Document type
      <select id={id("type")} className={styles.select} value={form.documentType} onChange={set("documentType")} disabled={disabled}>
        <option value="">Not set</option>
        {Object.entries(VAT_DOC_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </label>
    <label className={styles.field} htmlFor={id("currency")}>Currency
      <Input id={id("currency")} className={styles.input} value={form.currency} onChange={set("currency")} disabled={disabled} maxLength={3} placeholder="GBP" />
    </label>
    <label className={styles.field} htmlFor={id("net")}>Net
      <Input id={id("net")} className={styles.input} inputMode="decimal" value={form.netAmount} onChange={set("netAmount")} disabled={disabled} placeholder="0.00" />
    </label>
    <label className={styles.field} htmlFor={id("vat")}>VAT
      <Input id={id("vat")} className={styles.input} inputMode="decimal" value={form.vatAmount} onChange={set("vatAmount")} disabled={disabled} placeholder="Leave blank if not shown" />
    </label>
    <label className={styles.field} htmlFor={id("gross")}>Total
      <Input id={id("gross")} className={styles.input} inputMode="decimal" value={form.grossAmount} onChange={set("grossAmount")} disabled={disabled} placeholder="0.00" />
    </label>
    <label className={styles.field} htmlFor={id("vatno")}>Supplier VAT no
      <Input id={id("vatno")} className={styles.input} value={form.supplierVatNumber} onChange={set("supplierVatNumber")} disabled={disabled} maxLength={40} />
    </label>
    <label className={styles.field} htmlFor={id("due")}>Due date
      <Input id={id("due")} className={styles.input} type="date" value={form.dueDate} onChange={set("dueDate")} disabled={disabled} />
    </label>
  </div>;
}
