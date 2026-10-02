import { finishVatConnection } from "@/lib/vat-connect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return finishVatConnection(request, "dropbox");
}
