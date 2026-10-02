import { startVatConnection } from "@/lib/vat-connect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return startVatConnection(request, "dropbox");
}
