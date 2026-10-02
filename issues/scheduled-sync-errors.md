# Scheduled sync error diagnosis — 2026-10-02

## Confirmed TikTok cause

The affiliate video request uses `tiktokAffiliateAnalyticsWindow()`, which requests
90 days plus an exclusive end boundary. A live read-only request to
`GET /analytics/202605/shop_videos/performance` returned HTTP 200, code 28001022:
`invalid request params; detail:date range cannot exceed 60 days.`

The same request with a 60-day range succeeded and returned 49 videos. Both today's
exclusive end and tomorrow's exclusive end succeeded, so the confirmed failure is
the range length, not the end boundary. The affiliate-order endpoint returned code
0. Stored affiliate reporting last succeeded on 2026-09-24.

Fix: fetch video analytics in windows no larger than 60 days, preserve retained
history, and retain the provider's safe error details instead of discarding its
message in `tiktokApiRequest()`.

## Confirmed QStash behavior

The configured account has an active reconciliation schedule every 30 minutes and
an Ads schedule every hour. The reconciliation requests pass verification, complete
the other imports, then return 503 because affiliate video reporting failed.
QStash retries each failed request three times. Its latest 100 events contained
28 reconciliation errors with HTTP 503, zero HTTP 500 errors, and successful Ads
deliveries.

Vercel also records another roughly five-minute stream of POST requests to
`/api/jobs/reconcile` that fail with `SignatureError: signature verification failed`.
The installed SDK throws when both signing-key checks fail; the App Router wrapper
does not catch that exception, so these rejected requests become HTTP 500.
These requests are not represented in the inspected QStash account's latest events.
A stale schedule or another QStash account is a likely source, but the exact sender
is NOT confirmed by the available logs.

Fix: resolve the TikTok failure to stop valid-job retries; investigate the other
request source before changing signing keys or removing schedules. Return 403 for
invalid signatures while retaining authentication. Never disable signature checks.

Production environment export hides sensitive values as empty strings, so exported
blank signing keys do NOT prove the deployed keys are blank or mismatched. Current
account keys match the local keys; successful authenticated production jobs confirm
that this account's requests are accepted.

Only read-only diagnostics were performed. No schedules, environment variables,
tokens, or deployed code were changed. Temporary credential exports were removed.
