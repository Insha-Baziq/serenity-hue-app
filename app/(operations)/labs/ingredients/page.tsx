import { LabIngredientsWorkspace } from "@/components/lab-ingredients-workspace";
import { requirePageSession } from "@/lib/auth-guard";
import { getLabIngredients, initializeLabsData } from "@/lib/repository";

export const dynamic = "force-dynamic";

export default async function LabIngredientsPage() {
  await requirePageSession();
  await initializeLabsData();
  return <LabIngredientsWorkspace items={await getLabIngredients()} />;
}
