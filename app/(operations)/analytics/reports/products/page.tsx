import { notFound } from "next/navigation";
import { ProductHealthReportWorkspace } from "@/components/product-health-report-workspace";
import { requirePageSession } from "@/lib/auth-guard";
import { getPhysicalInventory, getProductHealthReport } from "@/lib/repository";
import { resolveReportingPeriod } from "@/lib/reporting-period";

export const dynamic = "force-dynamic";

export default async function ProductHealthReportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePageSession();
  const params = await searchParams;
  const productId = typeof params.product === "string" && params.product ? params.product : undefined;
  const { range } = resolveReportingPeriod(params);
  const [report, catalogue] = await Promise.all([getProductHealthReport(range, productId), getPhysicalInventory()]);
  if (productId && report.products.length === 0) notFound();
  return <ProductHealthReportWorkspace report={report} catalogue={catalogue.map((item) => ({ id: item.id, title: item.title }))} />;
}
