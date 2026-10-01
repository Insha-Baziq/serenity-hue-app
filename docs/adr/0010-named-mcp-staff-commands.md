# ADR-0010: Expose staff business writes as named MCP commands

## Status

Implemented locally; production enablement gated on staging client verification and migration review.

## Context

ADR-0007 established a remote MCP connector with a provider-enforced read-only query path. The owner now wants Claude to perform the app's staff business actions directly after an explicit OAuth grant, without a fresh app login or approval for each call. A general database or HTTP proxy would bypass the domain rules that keep physical stock, channel listings, packaging materials, and Labs distinct.

## Decision

Add a separate assistant write adapter with one explicit tool per staff business action. Each tool has a strict schema, exact scope, current-state precondition, durable idempotency key, bounded workload, and audit result. The adapter calls the same domain/repository operations as staff routes. It does not issue SQL or call browser routes with synthetic sessions. Existing read tools keep their isolated read-only database credential and import boundary.

The OAuth consent page identifies write scopes. A read grant cannot write; write grants also require an independent current user/client allowlist and a kill switch on every call. Assistant operations retain the initiating staff user and OAuth client in audit provenance. No routine app confirmation is required. Provider OAuth remains a browser flow that the owner completes on the provider's page.

Staff business mutation routes and MCP commands are mapped by a coverage gate. Internal webhooks, scheduled jobs, protocol routes, migrations, retired endpoints, and development importers are documented exceptions. A new staff write action requires a named MCP command in the same feature work.

This decision supersedes ADR-0007's blanket prohibition on MCP write tools. Its read query boundary, credential requirement, and PII restrictions remain in force.

## Consequences

The command boundary and migration require security and domain tests, staging client checks, and operator review before production enablement. A write tool cannot be published safely just by registering a repository function: retries, stale data, and revocation are part of the command contract.

The implementation uses a durable at-most-once reservation before the existing domain transaction. A crash after the business commit but before saving the MCP result leaves the operation uncertain; the same key is never executed again automatically. This is less convenient than an atomic shared transaction but avoids replaying an irreversible business action through the existing repository interfaces. The client must inspect the record/activity before submitting a new action.
