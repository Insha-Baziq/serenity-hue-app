# MCP staff write parity

Status: approved concept, 2026-09-30. Source: `docs/design/2026-09-30-mcp-safe-write-access.md`.

## Outcome

An authorized client can ask Claude to perform every existing staff business write in Serenity Hue Operations through named MCP tools. Normal calls use the OAuth grant and do not require a fresh app login or app approval. The connector never exposes SQL, code editing, arbitrary CRUD, provider secrets, or direct database access.

## Users and stories

- As the owner, I can connect Claude with explicit business write scopes and revoke its access.
- As the owner, I can update physical counts, catalogue details, packaging, Labs ingredients/formulas/batches, channel mappings, shipment links, staff onboarding, and manual integration operations through Claude.
- As a staff member, I can see who initiated an assistant change, what changed, and whether it succeeded.
- As an operator, I can disable all assistant writes immediately while read tools and the staff app continue working.

## Requirements

1. Register the exact named tools in the accepted design, with strict schemas and action scopes. Keep the existing read connector's isolated, read-only database path intact.
2. Gate OAuth write grants at initial consent and every call by an explicit user/client policy. Existing read access never implies write access. A disabled or removed account cannot write.
3. Route every tool through the same domain/repository business rules used by staff routes. Preserve the distinctions between physical counts, channel listing quantities, packaging materials, and Labs ingredients and packaged output.
4. Require stable IDs, relevant current-state preconditions, and durable idempotency keys for writes. Reject stale, mismatched, oversized, duplicate, or unauthorized commands with safe error context.
5. Keep domain ledgers and activity records, with assistant user/client/operation provenance and no sensitive prompt or token logging.
6. Bound bulk operations and distributed request frequency. Provide an independent server-side write kill switch and revocation path.
7. Add a contract gate for every current staff business mutation, documenting system-only exceptions. Validate read-only denial, retries, concurrency, domain invariants, and app regressions before enabling production writes.

## Release gate

Write grants are off until all required commands and their safety controls pass `npm run typecheck`, `npm test`, `npm run lint`, `npm run build`, and staging MCP/client checks. Production deployment and migration review are separate decisions.
