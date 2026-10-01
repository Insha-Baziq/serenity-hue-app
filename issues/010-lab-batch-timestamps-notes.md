# 010 — Exact batch timestamps and notes

Type: HITL
Status: complete

## Scope

Show exact UK creation and update date/time on both the full and formula-filtered batch pages. Let staff read and edit batch notes through the batch side panel and a dedicated dialog. Keep the existing packaging and ingredient rules intact.

## Acceptance criteria

- [x] Batch creation and last update are persisted; existing rows are backfilled from creation or packaging allocation history.
- [x] Both batch lists and the side panel show absolute UK date/time with seconds and the creator remains visible.
- [x] Notes can be read in full, added, changed, or cleared from a dedicated dialog.
- [x] Notes saves reject stale edits, record actor activity without storing note text in the audit event, and do not affect quantities.
- [x] The new staff write has a named Labs MCP tool with the same repository command.
- [x] Browser interaction and all feedback loops pass.

## Notes

Implemented in the main checkout. Verified against an isolated local database through the browser; 98 tests, typecheck, lint, and production build pass.
