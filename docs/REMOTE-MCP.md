# Serenity Hue remote MCP connector

This connector lets an approved business user read Serenity Hue Operations data and,
with a separate write grant, ask Claude or another compatible MCP client to perform
named staff actions directly. It never accepts SQL, code changes, arbitrary HTTP
requests, or provider secrets.

## Configuration

Copy the MCP entries from `.env.example` into the deployment environment. Staging and
production must use different OAuth secrets, allowed users, client registrations, token
records, and read-database credentials.

Required production values:

- `MCP_ENABLED=true` only after all staging gates pass.
- Fixed HTTPS `MCP_ISSUER_URL` and `MCP_RESOURCE_URL` (the resource is `/api/mcp`).
- A random `MCP_OAUTH_SECRET` of at least 32 characters.
- Exactly one user policy: either `MCP_ALLOWED_USER_ID` for one approved Better Auth
  user, or `MCP_ALLOW_ALL_AUTHENTICATED_USERS=true` for every existing Better Auth
  account. The latter must remain false if any account is not approved for business
  data access.
- `MCP_READ_DATABASE_URL` and its dedicated read-only auth token.
- `MCP_READ_DATABASE_ENFORCED=true` only after the database provider has been tested to
  reject `INSERT`, `UPDATE`, `DELETE`, DDL, migrations, and write transactions for that
  credential. The application cannot turn a normal Turso token into a read-only token.
- `MCP_PII_ENABLED=false` until privacy and business-owner approval is recorded.
- `MCP_WRITE_ENABLED=false` until the write release gate below is complete. This is
  an independent emergency switch for every business write tool.
- `MCP_WRITE_ALLOWED_USER_IDS` and `MCP_WRITE_ALLOWED_CLIENT_IDS` must contain exact
  comma-separated IDs. Both are checked on every write, even if the OAuth token has
  a write scope. The read-side all-authenticated-user setting never grants writes.

Run `npm run db:migrate` against the primary authentication/business database before
using OAuth. The read-only database must already contain the compatible schema and must
not be migrated by a request.

Write scopes are `assistant:write:inventory`, `assistant:write:packaging`,
`assistant:write:mappings`, `assistant:write:labs`, `assistant:write:shipments`,
`assistant:write:team`, `assistant:write:integrations`, and
`assistant:write:connections`. The client must request each desired scope during
OAuth consent. Read-only grants cannot call write tools. Existing grants do not gain
new scopes during refresh. Once consented, routine writes do not require another app
login or approval. The server still checks account existence, scope, allowlists,
stale-state preconditions, durable retry keys, and database-backed action limits.

Every write call requires a fresh `idempotencyKey` for a new action. Retrying the
same key and arguments returns the stored result. A key with different arguments is
rejected. If a call reports `MCP_OPERATION_UNCERTAIN`, inspect the app's activity and
business record before deciding on a new action; the server will not repeat that
key automatically. The current reservation provides safe at-most-once execution;
the business transaction and reservation are separate commits, so an interrupted
final response can remain uncertain.

`invite_employee` returns a one-use setup link valid for 24 hours. Share it privately
with the intended employee. The employee chooses a password on that page; no password
is passed to the MCP tool or included in connector logs. There is no automatic email
delivery configured. The setup link is returned only on the first call, not an
idempotency replay; issuing a new invitation invalidates the previous link. TikTok
Shop and Ads connection tools return browser start URLs;
the owner completes the provider authorization in the browser.

## Discovery and client setup

The connector publishes both root and resource-specific metadata:

```text
GET /.well-known/oauth-protected-resource
GET /.well-known/oauth-authorization-server
GET /api/mcp/.well-known/oauth-protected-resource
GET /api/mcp/.well-known/oauth-authorization-server
POST /api/mcp/oauth/register
POST /api/mcp
```

Clients should discover OAuth metadata, register with exact redirect URIs when dynamic
registration is needed, complete the browser login and explicit consent page, and send
the resulting bearer token to `/api/mcp`. S256 PKCE is mandatory. Client ID Metadata
Documents are accepted when the client supplies an HTTPS metadata URL that passes the
SSRF and size checks.

## Rollout

1. Disabled: keep `MCP_ENABLED=false`; exercise unit and local protocol tests only.
2. Aggregate canary: approved user policy, `assistant:read`, no PII.
3. Operational detail: enable approved order/inventory/shipment detail while keeping
   sensitive contact fields unavailable.
4. Full capability: set `MCP_PII_ENABLED=true` only after written approval, then issue
   fresh `assistant:pii` consent. Existing tokens are still checked against the current
   flag, so disabling PII invalidates PII access on the next request.
5. Staff writes: run the local isolated verification script, inspect the migration and
   activity results, grant only the client's user and connector ID in the write
   allowlists, set `MCP_WRITE_ENABLED=true`, and issue new explicit write consent.

To disable writes, set `MCP_WRITE_ENABLED=false` in the deployed environment and
redeploy so the running app reads the new value. To disable the entire connector,
set `MCP_ENABLED=false` and redeploy. To
remove an individual connection, revoke its access or refresh token; refresh-token
replay revokes its whole token family. OAuth records can be retained for security
operations, but the documented security-log retention period is 30 days and logs are
redacted.

## Verification checklist

Before production, verify the database write rejection independently, run `npm run
typecheck`, `npm test`, `npm run lint`, and `npm run build`, and complete live staging
checks with MCP Inspector, Claude Desktop, ChatGPT custom MCP, and Codex. Confirm OAuth
discovery, consent, initialization, tool discovery/calls, refresh rotation, revocation,
errors, and the `assistant:pii` boundary. For writes, run
`node scripts/verify-mcp-write.mjs` against its isolated temporary database and verify
real tool calls, stale rejections, retries, ledgers, activity, employee setup, and
revocation. This is local protocol evidence; a live Claude and ChatGPT staging
connection is still required to claim provider compatibility.
