import { LabIngredientsWorkspace } from "@/components/lab-ingredients-workspace";
import { requirePageSession } from "@/lib/auth-guard";
import { getLabIngredients } from "@/lib/repository";

export const dynamic = "force-dynamic";

export default async function LabIngredientsPage() {
  await requirePageSession();
  return <LabIngredientsWorkspace items={await getLabIngredients()} />;
}
