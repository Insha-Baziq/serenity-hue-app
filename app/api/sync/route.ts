import { syncDirectChannels } from "@/lib/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  const result = await syncDirectChannels("manual");
  return Response.json(result, { status: result.ok ? 200 : 503 });
}
