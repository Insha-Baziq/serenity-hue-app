import "server-only";

type RateLimitEntry = { count: number; resetAt: number };
const buckets = new Map<string, RateLimitEntry>();

function clientAddress(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || "unknown";
}

/** Process-local guard for sensitive endpoints. Vercel's edge/WAF can add a
 * network-wide limit, while this protects each warm application isolate. */
export function takeRateLimit(request: Request, input: { name: string; limit: number; windowMs: number }) {
  const now = Date.now();
  const key = `${input.name}:${clientAddress(request)}`;
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + input.windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  current.count += 1;
  if (current.count <= input.limit) return { allowed: true, retryAfterSeconds: 0 };
  return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
}

export function rateLimitedResponse(retryAfterSeconds: number) {
  return Response.json(
    { ok: false, message: "Too many requests. Please try again shortly." },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds), "Cache-Control": "no-store" } },
  );
}
