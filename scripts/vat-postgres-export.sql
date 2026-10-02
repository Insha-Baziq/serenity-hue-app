-- Read-only export of the standalone VAT Automation PostgreSQL database as one
-- JSON document for scripts/import-vat-data.mjs. It deliberately omits every
-- credential: no OAuth refresh/access tokens, no Dropbox connection, no API keys,
-- and no sync-pause state. Money is exported as exact numeric text.
--
-- Usage (from this repository root, with the VAT database container running):
--   docker exec -i serenity-hue-db psql -U serenity -d serenity_hue -At -v ON_ERROR_STOP=1 < scripts/vat-postgres-export.sql > tmp/vat-export.json
SELECT json_build_object(
  'format', 'serenity-hue-vat-export/v1',
  'exportedAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'settings', COALESCE((
    SELECT json_agg(json_build_object(
      'key', key,
      'value', value,
      'updatedAt', to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ) ORDER BY key)
    FROM settings WHERE key = 'sync_start_date'
  ), '[]'::json),
  'mailAccounts', COALESCE((
    SELECT json_agg(json_build_object(
      'id', id,
      'provider', provider,
      'accountEmail', account_email,
      'lastError', last_error,
      'lastSyncedAt', to_char(last_synced_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'createdAt', to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ) ORDER BY id)
    FROM mail_accounts
  ), '[]'::json),
  'emails', COALESCE((
    SELECT json_agg(json_build_object(
      'id', id,
      'accountId', account_id,
      'threadId', thread_id,
      'fromName', from_name,
      'fromEmail', from_email,
      'subject', subject,
      'receivedAt', to_char(received_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'attachments', attachments,
      'bodyText', body_text,
      'category', category,
      'confidence', confidence,
      'jevAnswers', jev_answers,
      'status', status,
      'decidedBy', decided_by,
      'error', error,
      'attempts', attempts,
      'createdAt', to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ) ORDER BY received_at, id)
    FROM emails
  ), '[]'::json),
  'invoices', COALESCE((
    SELECT json_agg(json_build_object(
      'id', id,
      'emailId', email_id,
      'source', source,
      'documentType', document_type,
      'supplierName', supplier_name,
      'supplierVatNumber', supplier_vat_number,
      'invoiceNumber', invoice_number,
      'invoiceDate', invoice_date::text,
      'dueDate', due_date::text,
      'currency', currency,
      'netAmount', net_amount::text,
      'vatAmount', vat_amount::text,
      'grossAmount', gross_amount::text,
      'vatBreakdown', (
        SELECT json_agg(json_build_object('rate', line->>'rate', 'net', line->>'net', 'vat', line->>'vat'))
        FROM jsonb_array_elements(COALESCE(vat_breakdown, '[]'::jsonb)) AS line
      ),
      'originalInvoiceNumber', original_invoice_number,
      'portalUrl', portal_url,
      'fieldConfidence', field_confidence,
      'status', status,
      'notes', notes,
      'fileName', file_name,
      'dropboxPath', dropbox_path,
      'dropboxUrl', dropbox_url,
      'createdAt', to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'updatedAt', to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ) ORDER BY id)
    FROM invoices
  ), '[]'::json)
);
