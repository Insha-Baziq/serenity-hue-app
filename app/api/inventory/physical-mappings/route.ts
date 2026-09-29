import { activityActorForSession, getCurrentSession, requireApiSession } from "@/lib/auth-guard";
import { savePhysicalListingMappings } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MappingPayload = {
  listingId?: unknown;
  components?: unknown;
  mappings?: unknown;
  listingKind?: unknown;
};

/** Replaces one channel listing's physical-component map in a single transaction. */
export async function PATCH(request: Request) {
  if (!(await requireApiSession(request))) return Response.json({ ok: false, message: "Authentication required" }, { status: 401 });
  const session = await getCurrentSession({ requestHeaders: request.headers, disableCookieCache: true });
  if (!session?.user) return Response.json({ ok: false, message: "Authentication required" }, { status: 401 });

  let body: MappingPayload;
  try {
    body = await request.json() as MappingPayload;
  } catch {
    return Response.json({ ok: false, message: "A JSON mapping payload is required" }, { status: 400 });
  }
  const parseComponents = (value: unknown) => (Array.isArray(value) ? value : []).map((component) => {
    const value = component !== null && typeof component === "object" ? component as Record<string, unknown> : {};
    return {
      physicalVariantId: typeof value.physicalVariantId === "string" ? value.physicalVariantId.trim() : "",
      quantityPerSale: typeof value.quantityPerSale === "number" ? value.quantityPerSale : Number.NaN,
    };
  });
  const mappings = Array.isArray(body.mappings)
    ? body.mappings.map((mapping) => {
      const value = mapping !== null && typeof mapping === "object" ? mapping as Record<string, unknown> : {};
      return { listingId: typeof value.listingId === "string" ? value.listingId.trim() : "", components: parseComponents(value.components) };
    })
    : typeof body.listingId === "string" && body.listingId.trim() && Array.isArray(body.components)
      ? [{ listingId: body.listingId.trim(), components: parseComponents(body.components) }]
      : [];
  if (!mappings.length || mappings.some((mapping) => !mapping.listingId)) {
    return Response.json({ ok: false, message: "Listing and component details are required" }, { status: 400 });
  }
  const listingKind = body.listingKind === undefined ? undefined : body.listingKind === "individual" || body.listingKind === "bundle" ? body.listingKind : null;
  if (listingKind === null) {
    return Response.json({ ok: false, message: "Listing type must be Individual or Bundle" }, { status: 400 });
  }

  try {
    const listings = await savePhysicalListingMappings({ mappings, listingKind, actor: activityActorForSession(session)! });
    return Response.json({ ok: true, listings });
  } catch (error) {
    return Response.json({ ok: false, message: error instanceof Error ? error.message : "Unable to save the mapping" }, { status: 400 });
  }
}
