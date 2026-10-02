import { stepVatRun } from "@/lib/vat-runs";
import { vatApiActor, vatErrorResponse, vatJson, vatUnauthorized } from "@/lib/vat-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Processes the next batch of the run's queue within one function invocation. */
export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const actor = await vatApiActor(request);
  if (!actor) return vatUnauthorized();
  try {
    const { runId } = await params;
    if (!/^[0-9a-f-]{36}$/.test(runId)) return vatJson({ ok: false, message: "That run no longer exists." }, 404);
    return vatJson({ ok: true, ...(await stepVatRun(runId, actor)) });
  } catch (error) {
    return vatErrorResponse(error);
  }
}
