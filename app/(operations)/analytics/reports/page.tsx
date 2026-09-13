import Link from "next/link";
import { ArrowLeft, ArrowRight, PackageSearch } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePageSession } from "@/lib/auth-guard";

export default async function ReportsPage() {
  await requirePageSession();
  return <section className="workspace analytics-hub">
    <Link className="analytics-back" href="/analytics"><ArrowLeft aria-hidden="true" /> Analytics</Link>
    <header className="workspace-header"><div><p className="workspace-kicker">Analytics</p><h1>Reports</h1><p className="workspace-description">Structured views generated from reconciled operations data.</p></div></header>
    <div className="analytics-hub__grid analytics-hub__grid--reports">
      <Link href="/analytics/reports/products" className="analytics-destination"><Card><CardHeader><span className="analytics-destination__icon"><PackageSearch aria-hidden="true" /></span><CardTitle>Product Health Report</CardTitle><CardDescription>Net product performance, period comparison, physical stock, channel-shown quantities, coverage and mapping detail.</CardDescription></CardHeader><CardContent><span>Generate report <ArrowRight aria-hidden="true" /></span></CardContent></Card></Link>
    </div>
  </section>;
}
