import { finishVatConnection } from "@/lib/vat-connect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Stores the inbox authorization only. Inbox reading and invoice sync are deferred.
export function GET(request: Request) {
  return finishVatConnection(request, "outlook");
}
