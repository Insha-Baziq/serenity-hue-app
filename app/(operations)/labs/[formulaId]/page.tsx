import { LabFormulaWorkspace } from "@/components/lab-formula-workspace";
import { requirePageSession } from "@/lib/auth-guard";
import { getLabFormula, initializeLabsData } from "@/lib/repository";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function LabFormulaPage({ params }: { params: Promise<{ formulaId: string }> }) {
  await requirePageSession();
  await initializeLabsData();
  const { formulaId } = await params;
  const formula = await getLabFormula(formulaId);
  if (!formula) notFound();
  return <LabFormulaWorkspace formula={formula} />;
}
