import { cookies } from "next/headers";
import { VatUnlock } from "@/components/vat-unlock";
import { VatWorkspace } from "@/components/vat-workspace";
import { hasVatAccess, VAT_ACCESS_COOKIE } from "@/lib/vat-access";
import { requirePageSession } from "@/lib/auth-guard";
import { getVatWorkspace } from "@/lib/vat-repository";
import { parseVatSummaryQuery, parseVatWorkspaceQuery } from "@/lib/vat-rules";
import { getVatSummary } from "@/lib/vat-summary";

export const dynamic = "force-dynamic";

// Reads only Turso. Never fetches mail or calls Dropbox while rendering.
export default async function VatPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requirePageSession();
  // The VAT password is asked for in each browser before any VAT data is read.
  if (!hasVatAccess((await cookies()).get(VAT_ACCESS_COOKIE)?.value, session.user.id)) return <VatUnlock />;
  const params = await searchParams;
  let data;
  let summary = null;
  try {
    const query = parseVatWorkspaceQuery(params);
    [data, summary] = await Promise.all([
      getVatWorkspace(query),
      query.tab === "summary" ? getVatSummary(parseVatSummaryQuery(params)) : Promise.resolve(null),
    ]);
  } catch (error) {
    // The vat_ tables arrive with `npm run db:migrate` (run by every Vercel deployment).
    if (!/no such table: vat_/.test(String((error as Error)?.message))) throw error;
    return <section className="workspace">
      <header className="workspace-header"><div>
        <h1>VAT</h1>
        <p className="workspace-description">The VAT tables aren&apos;t in this database yet. Run <code>npm run db:migrate</code> or deploy, then reload this page.</p>
      </div></header>
    </section>;
  }
  const single = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? null;
  const connected = single(params.connected);
  return <VatWorkspace
    data={data}
    summary={summary}
    notice={connected === "dropbox" ? "Dropbox is connected for VAT filing." : connected === "outlook" ? "Inbox connected. It won't be read until inbox sync is enabled." : null}
    connectionError={single(params.connection_error)?.slice(0, 200) ?? null}
  />;
}
