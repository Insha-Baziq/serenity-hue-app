# Shared Parcel2Go bookings

One Parcel2Go booking can contain references for any number of separate channel orders.
Resolve each reference independently, link all available orders, and retry absent orders on later syncs.

- [x] Resolve all explicit references independently and deduplicate order matches.
- [x] Store many orders per booking while preserving existing automatic/manual links.
- [x] Hydrate tracking, status, and events on every linked order.
- [x] Retry saved references beyond the provider's recent feed.
- [x] Test multiple references, missing orders, later availability, duplicate references, and shared history.
- [x] Complete typecheck, lint, and build gate (103 tests passed).
- [x] Deploy through the Shabina Khan Vercel profile.
- [x] Reconcile saved production bookings and verify Loraine Laven and Karen Robst.

Deployed 2026-10-02 to https://serenity-hue-operations.vercel.app.
Saved-reference reconciliation created nine additional order links; the shared
booking hydration was verified against production data, including identical
tracking and event history for each pair. The public URL returns the login page;
authenticated browser verification was not available in this session.

Vercel's existing QStash signature and TikTok affiliate reporting errors are
separate from this matching fix and remain outside this issue.
