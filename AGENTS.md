<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Design system reference

Before making any product-facing UI decision or editing frontend code, read
`DESIGN.md` at the repository root. It is the authoritative design-language
reference for Serenity Hue Operations and defines the visual tokens,
typography, layout, responsive behavior, component conventions, interaction
states, and explicit visual guardrails.

- Preserve its warm paper, plum/magenta, editorial-but-operational character.
- Reuse the existing shadcn-style primitives in `components/ui/` and the
  established patterns in `app/globals.css` before introducing new UI
  conventions.
- Treat `project-context.md` as the source of product truth and `DESIGN.md` as
  the source of presentation and interaction truth. When they conflict,
  preserve the product requirement and extend the design language coherently.
- If a requested UI pattern is not covered, first follow the closest existing
  pattern; document any durable, system-wide visual decision in `DESIGN.md` as
  part of the implementation.

## Agentic engineering

This repository follows the durable-context workflow in `docs/agents/WORKFLOW.md`.
Read `CONTEXT.md` before naming domain concepts, `docs/agents/ARCHITECTURE.md` before
changing interfaces, and `docs/agents/FEEDBACK-LOOPS.md` before claiming work is ready.

### Stack and feedback loops

- Runtime: Node.js with Next.js 16 App Router, React 19, and strict TypeScript.
- Persistence: SQLite/libSQL through Turso and the repository layer.
- Package manager: npm.
- Typecheck: `npm run typecheck`
- Tests: `npm test`
- Lint: `npm run lint`
- Build: `npm run build`
- Format: absent; do not claim formatting is enforced.

### Where things live

```text
app/              App Router pages and HTTP route adapters
components/       client-facing operations workspaces and shared UI
lib/              repository, domain rules, auth, integrations, and contracts
database/         schema, migration manifest, and seed data
tests/            Node test-runner tests
docs/agents/      workflow, architecture, feedback loops, conventions, handoffs
docs/adr/         append-only architecture decisions
issues/           local vertical-slice backlog
prompts/          unattended implementation/review prompts
```

### Non-negotiables

1. Do not issue SQL from pages or route adapters; use the repository/domain layer.
2. Keep physical inventory, channel listings, packaging, and Labs ingredients distinct.
3. Guard authenticated page/API mutations and preserve audit/history semantics.
4. Tests target public module interfaces; critical-path changes use red-green-refactor.
5. One issue per session; update `docs/agents/ARCHITECTURE.md` with interface changes.
6. Do not commit credentials, `.env.local`, production data, or unreviewed migrations.

### Local browser verification

For the local staff account used only to verify authenticated browser flows, consult
`LOCAL-VERIFICATION-CREDENTIALS.md`. This file is deliberately git-ignored: never
copy its contents into source, documentation, commits, logs, or external services.

### Vercel deployment (canonical command)

This project is deployed directly to the Shabina Khan Vercel account. Do not use
GitHub deployment flows or the default Vercel profile. This exact command is the
only approved production deployment command for this project; use it whenever
deploying this project to Vercel from the repository root:

```powershell
npx vercel --prod --yes --global-config "C:\Users\baziq\AppData\Local\vercel-profile-shabina-khan"
```

The Vercel project is linked locally and the deployment command runs the configured
database migration before the production build. Run the validation gate
(`npm run typecheck`, `npm run lint`, and `npm run build`) before deploying, and
verify the resulting production URL after the command completes.

For TikTok Ads reporting, use advertiser ID `7171533602079997953` (`Serenity Hue1129`).
The Promote-linked advertiser `7284999249782358018` is not the Ads Manager account used
for this project.
Keep `TIKTOK_ADS_HISTORY_START_DATE=2026-04-01` in local and production environments so
the KPI **All time** view retains the client's full available Ads history rather than
silently falling back to a 90-day cache.
