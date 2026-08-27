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
