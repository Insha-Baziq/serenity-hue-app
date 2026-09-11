# 0002. Use Next.js, TypeScript, Turso/libSQL, and Vercel

- **Status**: Accepted
- **Date**: 2026-08-27
- **Deciders**: Reconstructed from `package.json`, `README.md`, `vercel.json`, and deployment notes; confirm with project owner

**Reconstructed** from the codebase on 2026-08-27. The rationale below is inferred, not
recorded at the time. Correct it if you know better.

## Context

The app is an internal operations tool with server-rendered pages, authenticated API
routes, relational operational data, provider integrations, and a managed deployment.
The code already depends on Next App Router/React/TypeScript, libSQL/Turso, and Vercel.

## Decision

We will continue using Next.js App Router with strict TypeScript, Turso/libSQL behind a
repository layer, and Vercel for deployment.

## Alternatives considered

| Option | Why not |
|---|---|
| Client-side database access | Would expose operational persistence and credentials. |
| A different relational host | Would contradict the deployed Turso/libSQL client and migration path. |
| Separate frontend/backend deployment | Adds boundaries the current App Router routes already provide. |

## Consequences

The team gets one deployable app and server-only provider edges. Runtime behavior depends
on environment configuration and migration safety; Vercel build includes `db:migrate`.

## Notes for agents

Do not add direct database access to client code or bypass the repository. Treat changes to
the Vercel migration command as deployment-sensitive.
