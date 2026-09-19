import { LabBatchesWorkspace } from "@/components/lab-batches-workspace";
import { requirePageSession } from "@/lib/auth-guard";
import { getLabBatches, getLabFormula, initializeLabsData } from "@/lib/repository";

export const dynamic = "force-dynamic";

export default async function LabBatchesPage({ searchParams }: { searchParams: Promise<{ formula?: string | string[] }> }) {
  await requirePageSession();
  await initializeLabsData();
  const query = await searchParams;
  const requestedFormulaId = typeof query.formula === "string" ? query.formula : undefined;
  const formula = requestedFormulaId ? await getLabFormula(requestedFormulaId) : null;
  const batches = await getLabBatches(100, formula?.id);
  return <LabBatchesWorkspace batches={batches} formula={formula} />;
}
