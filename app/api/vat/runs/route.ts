import { getVatRun } from "@/lib/vat-run-store";
import { getVatRunOverview } from "@/lib/vat-run-store";
import { startVatRun } from "@/lib/vat-runs";
import { readVatJsonBody, vatApiActor, vatErrorResponse, vatJson, vatUnauthorized } from "@/lib/vat-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The unfinished run (if any) and the suggested start date for Get invoices. */
export async function GET(request: Request) {
  if (!(await vatApiActor(request))) return vatUnauthorized();
  try {
    return vatJson({ ok: true, ...(await getVatRunOverview()) });
  } catch (error) {
    return vatErrorResponse(error);
  }
}

/** Starts Get invoices from a date. Processing happens in browser-driven steps. */
export async function POST(request: Request) {
  const actor = await vatApiActor(request);
  if (!actor) return vatUnauthorized();
  try {
    const body = await readVatJsonBody(request);
    if (typeof body.startDate !== "string") return vatJson({ ok: false, message: "Choose a start date." }, 400);
    const runId = await startVatRun(body.startDate, actor);
    return vatJson({ ok: true, run: await getVatRun(runId) });
  } catch (error) {
    return vatErrorResponse(error);
  }
}
