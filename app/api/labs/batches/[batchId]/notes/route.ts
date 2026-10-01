import { activityActorForSession, getCurrentSession, requireApiSession } from "@/lib/auth-guard";
import { updateLabBatchNotes } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  if (!(await requireApiSession(request))) return Response.json({ ok: false, message: "Authentication required" }, { status: 401 });
  const session = await getCurrentSession({ requestHeaders: request.headers, disableCookieCache: true });
  if (!session?.user) return Response.json({ ok: false, message: "Authentication required" }, { status: 401 });
  try {
    const body = await request.json() as { notes?: unknown; expectedUpdatedAt?: unknown };
    if (typeof body.notes !== "string" || typeof body.expectedUpdatedAt !== "string" || !body.expectedUpdatedAt) {
      return Response.json({ ok: false, message: "Batch notes and current update time are required" }, { status: 400 });
    }
    const { batchId } = await params;
    const batch = await updateLabBatchNotes({ batchId, notes: body.notes, expectedUpdatedAt: body.expectedUpdatedAt, actor: activityActorForSession(session)! });
    return Response.json({ ok: true, batch });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save batch notes";
    if (message === "LAB_BATCH_NOT_FOUND") return Response.json({ ok: false, message: "That batch is no longer available" }, { status: 404 });
    if (message === "LAB_BATCH_STALE") return Response.json({ ok: false, message: "This batch changed since you opened it. Reload the page before saving notes." }, { status: 409 });
    return Response.json({ ok: false, message }, { status: 400 });
  }
}
