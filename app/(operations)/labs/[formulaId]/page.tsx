import { LabFormulaWorkspace } from "@/components/lab-formula-workspace";
import { requirePageSession } from "@/lib/auth-guard";
import { getLabFormula, getPhysicalInventory, initializeLabsData } from "@/lib/repository";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function LabFormulaPage({ params }: { params: Promise<{ formulaId: string }> }) {
  await requirePageSession();
  await initializeLabsData();
  const { formulaId } = await params;
  const formula = await getLabFormula(formulaId);
  if (!formula) notFound();
  const physicalInventory = await getPhysicalInventory();
  return <LabFormulaWorkspace formula={formula} physicalInventory={physicalInventory} />;
}
