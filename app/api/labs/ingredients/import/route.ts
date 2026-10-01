import { activityActorForSession, getCurrentSession, requireApiSession } from "@/lib/auth-guard";
import { parseLabIngredientCsv } from "@/lib/lab-ingredient-csv";
import { createLabIngredients } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CSV_BYTES = 1_000_000;

export async function POST(request: Request) {
  if (!(await requireApiSession(request))) return Response.json({ ok: false, message: "Authentication required" }, { status: 401 });
  const session = await getCurrentSession({ requestHeaders: request.headers, disableCookieCache: true });
  if (!session?.user) return Response.json({ ok: false, message: "Authentication required" }, { status: 401 });

  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".csv")) {
      return Response.json({ ok: false, message: "Choose a CSV file to import" }, { status: 400 });
    }
    if (file.size > MAX_CSV_BYTES) return Response.json({ ok: false, message: "CSV files must be 1 MB or smaller" }, { status: 413 });
    const ingredients = parseLabIngredientCsv(await file.text());
    const result = await createLabIngredients({ ingredients, actor: activityActorForSession(session)!, imported: true });
    return Response.json({ ok: true, createdCount: result.createdCount, skippedCount: result.skippedCount }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to import this CSV";
    return Response.json({ ok: false, message }, { status: 400 });
  }
}
