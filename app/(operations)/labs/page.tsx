import { LabsWorkspace } from "@/components/labs-workspace";
import { requirePageSession } from "@/lib/auth-guard";
import { getLabFormulas, getLabIngredients, initializeLabsData } from "@/lib/repository";

export const dynamic = "force-dynamic";

export default async function LabsPage() {
  await requirePageSession();
  await initializeLabsData();
  const [formulas, ingredients] = await Promise.all([getLabFormulas(), getLabIngredients()]);
  return <LabsWorkspace formulas={formulas} ingredients={ingredients} />;
}
