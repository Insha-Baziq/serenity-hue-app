# ADR-0007: Expose a stateless, read-only remote MCP connector

## Status

Accepted for staging; production enablement is gated.

## Decision

Serenity Hue Operations exposes `/api/mcp` through the official MCP TypeScript SDK's
stateless Streamable HTTP transport. Claude Desktop, ChatGPT custom MCP apps, Codex,
and MCP Inspector authenticate through OAuth authorization code flow with S256 PKCE.
The connector has four read-only tools: dataset discovery, the registered query DSL,
registered reports, and freshness inspection.

OAuth records are durable in the primary authentication database. Business queries use
only `MCP_READ_DATABASE_URL` and `MCP_READ_DATABASE_AUTH_TOKEN`; the production process
also requires `MCP_READ_DATABASE_ENFORCED=true`, which is an operator gate that may be
set only after the Turso/replica credential has been verified to reject writes. The
connector never runs migrations, seeders, provider calls, sync leases, cache writes, or
business audit writes.

The dataset registry is code-owned and versioned. SQL is assembled only from registered
dataset fragments, fields, metrics, filters, sorts, and includes; user values are always
parameters. PII is a separate `assistant:pii` scope and remains disabled until explicit
business-owner/privacy approval.

## Threat model and invariants

- Treat MCP clients, prompts, customer text, order text, and provider text as untrusted.
- Do not accept arbitrary SQL, arbitrary joins, browser automation, provider credentials,
  subscription proxying, or write tools.
- Bind every token and cursor to the fixed issuer, exact MCP resource, client, user,
  scope, audience, and expiry.
- Only an authenticated Better Auth user may complete consent. Production fails closed
  unless exactly one access policy is configured: `MCP_ALLOWED_USER_ID` for a single
  user, or the explicit `MCP_ALLOW_ALL_AUTHENTICATED_USERS=true` policy for every
  existing account.
- Authorization codes are one-time and PKCE-protected. Refresh tokens rotate atomically;
  replay revokes their entire family.
- Never log tokens, codes, prompts, query values, result rows, or customer PII.
- Disabling `MCP_ENABLED` immediately makes the MCP and OAuth endpoints unavailable.

## Consequences

- Deployment is serverless-safe: no cookies, in-memory OAuth state, session affinity, or
  long-lived process is required.
- The connector can answer broad operational questions while preserving the existing
  physical/channel/packaging/Labs boundaries.
- A provider-enforced read-only database credential and live staging compatibility checks
  remain mandatory before production, especially before enabling customer PII.
- Read access is intentionally broad, so rate limits, response limits, redacted security
  logs, staged scopes, and regular token revocation are part of the feature rather than
  optional enhancements.
