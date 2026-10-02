import { cancelVatRun } from "@/lib/vat-runs";
import { vatApiActor, vatErrorResponse, vatJson, vatUnauthorized } from "@/lib/vat-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Stops the run. Emails already handled stay recorded and are skipped next time. */
export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  if (!(await vatApiActor(request))) return vatUnauthorized();
  try {
    await cancelVatRun((await params).runId);
    return vatJson({ ok: true });
  } catch (error) {
    return vatErrorResponse(error);
  }
}
