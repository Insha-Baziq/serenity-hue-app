# 0011. Bring the VAT Automation app into Operations as a business-wide workspace

- **Status**: Accepted
- **Date**: 2026-10-01
- **Deciders**: Project owner (integration brief) and implementation session

## Context

The standalone VAT Automation app (Next.js, Drizzle, local Docker Postgres) filed
purchase invoices to Dropbox by month and tracked To get items. It ran only on a
developer laptop, used the developer's Dropbox, and had no staff login. Operations
already has staff authentication, a Turso/libSQL repository layer, a Vercel
deployment, and an activity feed. The brief asked for one VAT workspace inside
Operations, shared by all staff. It also asked for no second database, exact money,
no permanent deletion, and Vercel-safe uploads. Inbox sync, email processing,
and scheduled work were explicitly deferred.

## Decision

We will:

- add additive `vat_` tables to the existing Turso schema;
- store VAT money as integer hundredths;
- keep removal as a retained, reversible status, enforced by triggers;
- record permanent VAT history in `vat_events`, alongside the seven-day activity
  feed;
- make Dropbox and inbox connections business-wide, with AES-GCM-encrypted tokens
  under a dedicated `VAT_TOKEN_ENCRYPTION_KEY`;
- upload documents with Dropbox temporary upload links, so files go from the
  browser straight to Dropbox;
- port the source app's filing, naming, note, and matching rules as pure modules;
- import existing data with an idempotent, credential-free export/import that is
  rehearsed locally first;
- not port inbox reading, Jev classification, or LlamaExtract extraction in this
  phase.

## Alternatives considered

| Option | Why not |
|---|---|
| Keep VAT as a separate app or second database | The brief requires one login, one shell, and no second database. |
| Store amounts as REAL or decimal text | REAL is inexact; text needs repeated parsing and allows malformed values. Integer minor units are exact and checkable. |
| Upload through a route handler | Vercel Functions cap request bodies at 4.5 MB, and a serverless filesystem isn't durable. |
| Vercel Blob for uploads | Adds a second storage system; Dropbox is the agreed filing location, and uploads are honestly unavailable until it is connected. |
| Hard-delete removed invoices, as the source app did | Conflicts with the retention requirement; Dropbox's deleted files expire after 30 days. |
| Auto-merge certain duplicates on upload | A manual entry could hide a genuine second purchase; flagging keeps the decision with staff. |
| Move imported files into the new Dropbox automatically | They live in the developer's account, which this app must not use. They are marked legacy and left untouched. |

## Consequences

- Staff can review, correct, remove, restore, and upload VAT records on Vercel
  before any inbox is connected.
- Uploads, file moves, and the Dropbox copy of the CSV log depend on a connected
  business Dropbox. Until then, the API returns explicit setup-required errors.
- Imported documents' shared links still point at the earlier account until they
  are copied or uploaded again.
- Re-enabling inbox sync later must use `vat_mail_accounts` tokens and keep the
  "classify each email once" and "a refusing service never leads to a decision"
  rules from the source app.

## Notes for agents

- Never add a query that filters VAT records by staff member; VAT data is
  business-wide.
- Never `DELETE` from `vat_invoices` or `vat_emails`, and never update `vat_events`.
- Money in and out of VAT tables goes through `lib/vat-money.ts`; never through
  floats.
- No VAT page or route may fetch mail during rendering, and no scheduled VAT job may
  be added without a new decision.
- Keep VAT matching general: no per-supplier rules.
