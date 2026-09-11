# CONVENTIONS.md — Serenity Hue Operations

These conventions describe the code that exists, not an aspirational rewrite.

## Naming and shape

- TypeScript uses strict mode, `@/*` path aliases, and lower-kebab route/file names where the framework permits them.
- React components and exported component functions use PascalCase; domain functions and variables use camelCase.
- Use the words in `CONTEXT.md`. A new synonym for an existing concept is a review question.
- Route files adapt HTTP input/output; business behavior belongs behind the repository/domain interface.

## Module design

- Prefer a small public interface hiding persistence, integration, and transaction details.
- Do not import UI components into `lib/`, and do not issue SQL directly from `app/` or `components/`.
- Keep physical inventory, channel snapshots/listings, packaging, and Lab ingredients as separate domains.
- Server-only credentials and provider clients remain in server modules; client workspaces call authenticated routes.

## Tests and errors

- Tests should call public interfaces and describe behavior, not internal helpers or CSS implementation details.
- Mock at external process boundaries when needed; do not mock the repository's internal helpers.
- Preserve the existing `Response.json` boundary style, but keep user-facing messages free of stack traces, SQL, tokens, or provider internals.
- Never swallow an error to make a loop green. Validate external input at the route boundary and keep transactional writes atomic.

## Data and changes

- SQL values are parameterized. Schema changes belong in `database/schema.sql` and the migration manifest/script as appropriate.
- Preserve append-only ledgers and historical rows. Destructive or irreversible data changes are `HITL`.
- Soft-delete current physical catalogue records where history or mappings require retention.
- `package-lock.json` is tracked; do not upgrade dependencies as incidental cleanup.
- Avoid unrelated formatting churn. Generated `.next/`, `.vercel/`, local databases, environment files, and `tmp/` are ignored.

## Security checklist

- [ ] No secrets, keys, tokens, or real credentials in the diff
- [ ] External input validated at the boundary
- [ ] Queries parameterized
- [ ] AuthN/AuthZ checked on every new entry point
- [ ] No unbounded query or list added without a deliberate limit
- [ ] No PII added to logs
- [ ] New dependency justified and maintained

## Review questions

1. Does the diff match one issue's acceptance criteria?
2. Is there a public-interface regression test?
3. Was the empty/first-run state considered?
4. Did an interface change update `ARCHITECTURE.md`?
5. What did the author explicitly not do?
