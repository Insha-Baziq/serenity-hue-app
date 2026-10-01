# 009 — MCP staff write parity

Type: HITL
Status: in progress
Design: `docs/design/2026-09-30-mcp-safe-write-access.md`
PRD: `issues/prd.md`

## Scope

Implement the accepted MCP staff write catalogue as one security-critical product change, in small vertical slices within this issue. The full tool list and staff route mapping are in the design document.

## Acceptance criteria

- [x] Explicit write OAuth scopes, consent text, independent user/client policy, current-account check, revocation, and kill switch.
- [x] Durable retry protection, stale-value preconditions, bounded requests, distributed rate limits, and safe audit provenance.
- [x] Physical product/variant/count and packaging material tools use existing business rules.
- [x] Labs ingredient/import, formula, batch, and packaging tools preserve Labs calculations and ledgers.
- [x] Channel mapping/link, shipment link, employee invitation, sync/refresh, and provider connection tools use existing services.
- [x] Every authenticated staff business mutation has a corresponding named MCP tool or a documented system-only exception; no SQL/code/admin escape hatch.
- [x] Existing read tokens cannot write; read-only connector boundary remains intact.
- [ ] Public-seam behavioral tests and all required repository feedback loops pass; staging Claude and ChatGPT checks are recorded before release. Local checks pass; provider staging is pending.
- [x] Architecture map, ADR, connector setup documentation, and migration review are complete.

## Notes

Implementation and isolated local protocol verification are in the main app checkout. No worktree or PR is involved. Existing in-progress Labs changes remain in place. Production write access stays disabled until live Claude/ChatGPT staging checks are complete.

Local verification on 2026-09-30: `npm run typecheck`, `npm test` (94 passing), `npm run lint`, `npm run build`, and `node scripts/verify-mcp-write.mjs` all passed. The protocol test used a temporary local database and exercised real MCP HTTP tool calls; it did not connect a live Claude or ChatGPT client.

Production deployment on 2026-10-01: Vercel deployment `dpl_4bjtyftRoF3GmxvqcDwFY4WDQ6Sw` reached READY and was aliased to `https://serenity-hue-operations.vercel.app`. The migration completed during the Vercel build. The login page and MCP discovery endpoints returned HTTP 200. OAuth metadata advertised only read/PII scopes, confirming staff writes remain disabled in this deployment. Live Claude and ChatGPT staging checks remain open.
