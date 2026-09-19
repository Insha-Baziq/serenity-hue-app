# Serenity Hue remote MCP connector

This connector lets one approved business user ask official Claude Desktop, ChatGPT
custom MCP apps, or Codex questions about Serenity Hue Operations. It is a read-only
data interface; it cannot edit business records, synchronize providers, or run SQL.

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

Run `npm run db:migrate` against the primary authentication/business database before
using OAuth. The read-only database must already contain the compatible schema and must
not be migrated by a request.

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

To disable access, set `MCP_ENABLED=false` and redeploy/configure the environment. To
remove an individual connection, revoke its access or refresh token; refresh-token
replay revokes its whole token family. OAuth records can be retained for security
operations, but the documented security-log retention period is 30 days and logs are
redacted.

## Verification checklist

Before production, verify the database write rejection independently, run `npm run
typecheck`, `npm test`, `npm run lint`, and `npm run build`, and complete live staging
checks with MCP Inspector, Claude Desktop, ChatGPT custom MCP, and Codex. Confirm OAuth
discovery, consent, initialization, tool discovery/calls, refresh rotation, revocation,
errors, and the `assistant:pii` boundary. This repository contains protocol and contract
tests, but a live client account/workspace is required to claim provider compatibility.
