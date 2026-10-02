import { getVatLogRows } from "@/lib/vat-repository";
import { buildVatInvoiceLogCsv } from "@/lib/vat-rules";
import { vatApiActor, vatErrorResponse, vatJson, vatUnauthorized } from "@/lib/vat-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The accountant's invoice log for one year, generated from current records. */
export async function GET(request: Request) {
  if (!(await vatApiActor(request))) return vatUnauthorized();
  const year = new URL(request.url).searchParams.get("year") ?? "";
  if (!/^20\d{2}$/.test(year)) return vatJson({ ok: false, message: "Choose a year such as 2026." }, 400);
  try {
    const csv = buildVatInvoiceLogCsv(await getVatLogRows(year));
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="invoice_log_${year}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return vatErrorResponse(error);
  }
}
