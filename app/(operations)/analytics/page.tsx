import Link from "next/link";
import { ArrowRight, BarChart3, FileText } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePageSession } from "@/lib/auth-guard";

export default async function AnalyticsPage() {
  await requirePageSession();
  return <section className="workspace analytics-hub">
    <header className="workspace-header"><div><p className="workspace-kicker">Business intelligence</p><h1>Analytics</h1><p className="workspace-description">Choose a focused report or open the live KPI workspace.</p></div></header>
    <div className="analytics-hub__grid">
      <Link href="/analytics/reports" className="analytics-destination"><Card><CardHeader><span className="analytics-destination__icon"><FileText aria-hidden="true" /></span><CardTitle>Reports</CardTitle><CardDescription>Generated, period-specific documents for reviewing product performance and stock context.</CardDescription></CardHeader><CardContent><span>Browse reports <ArrowRight aria-hidden="true" /></span></CardContent></Card></Link>
      <Link href="/kpis" className="analytics-destination"><Card><CardHeader><span className="analytics-destination__icon"><BarChart3 aria-hidden="true" /></span><CardTitle>KPIs</CardTitle><CardDescription>The existing live performance workspace for sales, products, channels, customers and connected sources.</CardDescription></CardHeader><CardContent><span>Open KPIs <ArrowRight aria-hidden="true" /></span></CardContent></Card></Link>
    </div>
  </section>;
}
