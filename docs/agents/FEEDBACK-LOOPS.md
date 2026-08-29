# FEEDBACK-LOOPS.md — the commands that tell the truth

Verified from the repository root on 2026-08-27. Runtimes vary by machine; the values
below are the observed local durations.

| Loop | Command | Observed runtime | Blocking? | State |
|---|---|---:|---|---|
| Typecheck | `npm run typecheck` | 5.16s | yes | green |
| Unit/integration tests | `npm test` | 3.19s | yes | green; discovers every `tests/*.test.mjs` file with Node's TypeScript stripping enabled |
| Single test file | `node --test tests/schema.test.mjs` | 3.12s inside npm test | — | green |
| CSS layout test | `node --test tests/labs-formula-layout.test.mjs` | included by `npm test` | — | green |
| Lint | `npm run lint` | 14.51s | yes | green |
| Format | none | — | no | absent |
| Build | `npm run build` | 9.97s | yes | green |
| Dev server | `npm run dev` | — | no | available; long-running |

## Truth and gaps

- TypeScript is strict and `tsc --noEmit` is active.
- ESLint uses the Next core-web-vitals and TypeScript configurations, with generated and local tool directories ignored.
- There is no formatter, format check, pre-commit hook, or CI workflow.
- The package test script discovers every committed `tests/*.test.mjs` file. The command was verified on 2026-08-30: 5 tests passed.
- Browser/visual checking is available through the local Playwright tooling, but it is a manual loop rather than an automated check.
- `vercel.json` runs `npm run db:migrate && npm run build`; migration execution is therefore part of deployment and needs human review.

Do not claim the repository is fully validated until the absent format/CI loops are
addressed or explicitly accepted.
