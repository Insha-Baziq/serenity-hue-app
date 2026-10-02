import { getVatRun } from "@/lib/vat-run-store";
import { resumeVatRun } from "@/lib/vat-runs";
import { vatApiActor, vatErrorResponse, vatJson, vatUnauthorized } from "@/lib/vat-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** After a top-up or reconnect: continue where the run paused. */
export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  if (!(await vatApiActor(request))) return vatUnauthorized();
  try {
    const { runId } = await params;
    await resumeVatRun(runId);
    return vatJson({ ok: true, run: await getVatRun(runId) });
  } catch (error) {
    return vatErrorResponse(error);
  }
}
