# VAT workspace: setup, data import, and limits

The `/vat` workspace brings the standalone **VAT Automation** app (purchase invoices
for the UK VAT return) into Serenity Hue Operations. It uses the normal staff login
and the authenticated operations shell. There is no separate VAT password.

## Shared data model

- VAT records belong to the business. Every signed-in staff member sees the same
  invoices, To get items, removed records, ignored emails, and connection status.
  There is no per-user ownership and no VAT-specific role.
- Staff identity is recorded only for audit: `updated_by_*`, `removed_by_*`,
  `connected_by_*`, and the append-only `vat_events` history. Each change also
  appears for seven days in the activity feed (`/logs`).
- Tables are additive and namespaced: `vat_settings`, `vat_connections`,
  `vat_oauth_states`, `vat_mail_accounts`, `vat_emails`, `vat_invoices`,
  `vat_uploads`, `vat_events`. They are created by `npm run db:migrate`, which the
  Vercel build runs. No other table changes.
- **Money** is stored as integer hundredths (`*_amount_minor`) of the invoice
  currency, matching the source app's `numeric(12,2)` scale. It is never stored as
  a SQLite REAL. A database CHECK rejects non-integer values. Dates are `YYYY-MM-DD`
  text and timestamps are ISO-8601 UTC.
- **Nothing is permanently removed.** Removing a record sets `status = 'removed'`
  and keeps it in the **Removed** list, where it can be restored. Its Dropbox
  document moves to `/Invoices/_Removed/` rather than being deleted. A replaced
  document goes to the same folder. Database triggers block deleting
  `vat_invoices` or `vat_emails` and block changing `vat_events`.

## What works in this phase

- Lists for Invoices (saved), To get, Ignored, and Removed. Each is paginated at
  25 rows, with a month filter for Invoices and Ignored.
- Invoice details sheet with notes, source, and history. Staff can edit details,
  remove (with a reason), and restore. A save from an out-of-date view is refused.
- Upload an invoice, either new or as the fetched invoice for a To get item.
  The browser sends the file **directly to Dropbox** through a single-use temporary
  upload link (`files/get_temporary_upload_link`). The file never passes through a
  Vercel Function, so the 4.5 MB payload limit does not apply. Files can be up to
  20 MB. The server then checks the file's size in Dropbox and moves it to
  `/Invoices/<year>/<MM - Month>/` under the existing file-name convention. Staff
  enter the figures.
- Matching rules from the source app. A saved invoice clears To get items from the
  same supplier with a compatible amount within 7 days; those items stay in Removed
  as "Invoice received". Similar saved invoices are flagged **Possible duplicate**;
  manual entries are never merged automatically.
- `invoice_log.csv` for the accountant: download per year from the page. After each
  change it is also rewritten in Dropbox when Dropbox is connected.
- Business-wide Dropbox and Outlook connection flows, with encrypted tokens.

## Deferred (not implemented)

- **Inbox sync and email processing.** Nothing reads mail: no scans, polling,
  scheduled jobs, or background workers. Connecting an Outlook inbox stores its
  authorization only. The page never fetches mail while rendering.
- **Automatic reading of uploaded documents** (LlamaExtract) and classification
  (Jev). Both depend on the deferred pipeline, so staff type the figures on upload.
- "Move back to Invoices" for an ignored email. It needs the mailbox, so the Ignored
  list is read-only for now.
- Gmail connections. Imported Gmail inboxes are listed, but only Outlook can be
  connected.

## Dropbox-dependent behaviour

Until the shared Dropbox is configured **and** connected:

- Upload requests return `409 dropbox_not_configured` or `dropbox_not_connected`,
  and the page shows a setup-required banner. The app never reports a file as
  filed unless Dropbox confirmed the move.
- Records with no file, and records whose file came from the earlier app (see
  below), can still be edited, removed, and restored.
- A record whose file was filed by this workspace can't be edited, removed, or
  restored while Dropbox is unavailable, because its file name would fall out of
  step.

**Imported files.** Imported records keep their `dropbox_path` and shared link
from the earlier app's Dropbox account, which was the developer's. They are marked
as legacy (`dropbox_account_id IS NULL`), and the app never tries to move them in the
newly connected account. Their shared links keep working only while the earlier
account still holds the files. To move them into the business Dropbox, copy the
earlier app folder's `/Invoices` tree into the new app folder, or upload them again.

## Configuration (names only)

| Variable | Purpose |
|---|---|
| `VAT_TOKEN_ENCRYPTION_KEY` | base64 of 32 random bytes; AES-256-GCM key for stored tokens. Required in production. |
| `VAT_DROPBOX_APP_KEY`, `VAT_DROPBOX_APP_SECRET` | Dropbox app with **App folder** access |
| `VAT_MICROSOFT_CLIENT_ID`, `VAT_MICROSOFT_CLIENT_SECRET` | Microsoft Entra app for Outlook inboxes |
| `VAT_MICROSOFT_TENANT` | Optional, default `common` (work and personal Microsoft accounts) |

Generate the encryption key locally and store it only in Vercel's environment
settings:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Redirect URIs are derived from `BETTER_AUTH_URL` / `APP_URL`. For production:

- Dropbox: `https://serenity-hue-operations.vercel.app/api/vat/connections/dropbox/callback`
- Microsoft: `https://serenity-hue-operations.vercel.app/api/vat/connections/outlook/callback`

For local development, use the same paths on `http://localhost:3000`. The
**Connections** sheet on `/vat` shows the exact URIs for the running deployment,
plus the names of any settings still missing.

### Dropbox app

1. Create an app at <https://www.dropbox.com/developers/apps> under the business
   (or accountant) Dropbox account. Choose **Scoped access** and **App folder**.
2. Permissions: `account_info.read`, `files.metadata.read`, `files.content.read`,
   `files.content.write`, `sharing.read`, `sharing.write`.
3. Add both redirect URIs above, then copy the app key and secret into Vercel.
4. Sign in to `/vat`, open **Connections**, and choose **Connect Dropbox**. The
   connection then applies to every staff member.

### Microsoft app

1. In Microsoft Entra, register an app for "Accounts in any organizational directory
   and personal Microsoft accounts" (multi-tenant + personal).
2. Add a **Web** redirect URI for the callback above.
3. Delegated permissions: `openid`, `email`, `offline_access`, `User.Read`,
   `Mail.Read`. `Mail.Read` is requested now so the deferred sync doesn't need
   consent again; nothing reads mail yet.
4. Create a client secret and copy the ID and secret into Vercel.

## Importing the existing VAT data

The import is safe to repeat and is **idempotent**: rows are matched by their source
ids (`legacy_id` for invoices and inboxes, the provider message id for emails).
Rows that already exist are skipped, so later staff edits are never overwritten.
Credentials are never exported or imported: no OAuth tokens, no Dropbox connection,
no API keys, and no sync-pause state.

1. Export from the VAT Automation Postgres container (read-only):

   ```powershell
   New-Item -ItemType Directory -Force tmp
   cmd /c "docker exec -i serenity-hue-db psql -U serenity -d serenity_hue -At -v ON_ERROR_STOP=1 < scripts\vat-postgres-export.sql > tmp\vat-export.json"
   ```

2. Rehearse against a throwaway local database:

   ```powershell
   npm run vat:import -- --file tmp/vat-export.json --database file:./tmp/vat-import-check.db
   ```

3. Import into the configured Turso database. This runs only after the `vat_`
   tables exist (deploy or `npm run db:migrate` first) and only with the explicit
   flag:

   ```powershell
   npm run vat:import -- --file tmp/vat-export.json --production
   ```

The import validates every amount first: any amount that isn't exact to two decimal
places stops the import before anything is written. It prints how many rows it
found and inserted. `tmp/` is git-ignored; delete the export when you are done,
because it contains email subjects and invoice bodies.
