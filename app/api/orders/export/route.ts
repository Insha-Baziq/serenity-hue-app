import { getCurrentSession } from "@/lib/auth-guard";
import { streamOrdersForExport } from "@/lib/repository";
import { parseOrdersQuery } from "@/lib/orders-query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Streams every order matching the current filters as CSV, ignoring pagination. */
export async function GET(request: Request) {
  const session = await getCurrentSession({ requestHeaders: request.headers, disableCookieCache: true });
  if (!session?.user) return Response.json({ ok: false, message: "Authentication required" }, { status: 401 });

  const params: Record<string, string> = {};
  new URL(request.url).searchParams.forEach((value, key) => { params[key] = value; });
  const query = parseOrdersQuery(params);

  const encoder = new TextEncoder();
  const toCsv = (row: string[]) => `${row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")}\n`;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(toCsv(["Order", "Channel", "Customer", "Payment", "Fulfilment", "Date", "Total"])));
        for await (const row of streamOrdersForExport(query)) controller.enqueue(encoder.encode(toCsv(row)));
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv;charset=utf-8",
      "Content-Disposition": 'attachment; filename="serenity-hue-orders.csv"',
      "Cache-Control": "no-store",
    },
  });
}
