# Full staff-operation control through MCP

Status: implemented locally, 2026-09-30; production enablement awaits migration review and live client checks. The write flag defaults to false.

## Goal and scope

An authorized Claude connection should be able to perform **every business write action available to Serenity Hue staff**, including inventory, packaging, Labs, mappings, shipment linking, employee onboarding, and manual refreshes. The client authorizes the connector's write capabilities during OAuth setup and can then ask Claude to perform actions directly. Routine calls do not require a fresh Better Auth login or approval in the app. The server executes only named business commands with the same rules and audit trail used by the staff UI.

“Every write” means staff-facing business operations, not a database administration interface. System webhooks, scheduled jobs, OAuth token exchange, migrations, seeders, the retired master-inventory endpoints, and the development-only legacy importer remain internal mechanisms. Claude never receives SQL execution, arbitrary table/field updates, code or deployment tools, provider secrets, or a way to bypass domain validation. If a new staff write feature is added later, MCP parity must be considered in the same feature design and verified by an automated coverage check.

The connector currently has four read-only tools. This plan expands the *same remote MCP product* with explicit write tools while preserving the isolated read query path and its provider-enforced read-only credential.

## Complete current staff-write catalogue

Each row is a named MCP capability. Tool names below are proposed contracts, not claims that they exist today. Several UI routes accept multiple operations; the MCP surface should use clear task-oriented tools with precise schemas. A clear/unlink/archive tool is still a write, even when no row is physically deleted.

| Staff operation in current app | Proposed MCP tool(s) | Existing domain path / special rule |
| --- | --- | --- |
| Set one or several physical variant counts | `set_physical_variant_stock`, `set_physical_variant_stocks` | `applyPhysicalInventoryAdjustments`; whole units, exact variant IDs, parent total and immutable ledger. |
| Rename a physical product | `rename_physical_product` | `updatePhysicalProduct`; preserve catalogue identity. |
| Add a physical variant | `add_physical_variant` | `addPhysicalInventoryVariant`; parent and duplicate rules. |
| Rename a variant or edit its SKU | `update_physical_variant` | `updatePhysicalInventoryVariant`; preserve mappings. |
| Archive a physical variant or product | `archive_physical_variant`, `archive_physical_product` | Existing soft-delete functions and mapping-dependency/last-variant guards. |
| Create, edit, or archive a packaging material | `create_packaging_material`, `update_packaging_material`, `archive_packaging_material` | Existing packaging functions; the update must expose title and count explicitly, with current-value preconditions. Rename cascades to product references as it does in the app. |
| Set or clear exact channel listing components and listing kind | `set_channel_listing_mapping`, `clear_channel_listing_mapping` | `savePhysicalListingMappings`; exact variants and per-sale multipliers, whole product group when changing kind. No guessed shade, size, or bundle component. |
| Set or clear a channel product-family link | `set_channel_product_link`, `clear_channel_product_link` | `savePhysicalChannelProductLink`; this is distinct from an exact variant/component mapping. |
| Create one Labs ingredient or import a CSV | `create_lab_ingredient`, `import_lab_ingredients` | `createLabIngredients` and the existing CSV parser; bounded input, duplicate/skip report, grams only. |
| Set ingredient count/reorder point or archive an ingredient | `update_lab_ingredient`, `archive_lab_ingredient` | Existing ingredient functions and immutable ledger; archiving stays blocked while formula-linked. |
| Create a formula | `create_lab_formula` | Existing formula validation; fixed, remainder, and manual q.s. lines retain their distinct meanings. |
| Set formula fill quantity/unit | `set_lab_formula_packaging` | `updateLabFormulaPackaging`; grams or milliliters, independent of physical on-hand. |
| Create a production batch | `create_lab_batch` | Existing batch calculation and ingredient-deduction transaction; return exact deducted/not-deducted outcome. |
| Record additional packaged batch output | `record_lab_batch_packaging` | `updateLabBatchPackaging`; whole finished units and remaining-bulk invariant, Labs-only ledger. This increment requires strong idempotency. |
| Link a Parcel2Go shipment to an order | `link_parcel2go_shipment` | `linkParcel2GoShipment`; exact order/shipment IDs and existing duplicate-link guard. |
| Create an employee account | `invite_employee` | Replace password-in-prompt creation with a one-time invitation/setup flow. Claude can initiate the full staff action; the employee chooses their own password outside the conversation. Existing `createEmployee` currently takes a password, so this needs a shared onboarding-domain change. |
| Run manual direct-channel sync | `run_direct_channel_sync` | `syncDirectChannels("manual", actor)`; existing lease, outcome and limits. Return run status rather than pretending completion when asynchronous. |
| Refresh TikTok listing quantities | `refresh_tiktok_inventory` | Existing TikTok fetch/store and listing refresh, with no external stock push. |
| Refresh TikTok Ads reporting | `refresh_tiktok_ads_report` | Existing `refreshTikTokAdsReporting("manual", actor)`. |
| Start TikTok Shop or Ads connection | `start_tiktok_shop_connection`, `start_tiktok_ads_connection` | Return the app's authorization-start URL so the browser sets the existing state cookie before redirecting to TikTok. The account owner must complete the provider's OAuth page; Claude cannot supply or receive provider credentials. |

There is currently no staff route for editing orders, cancelling/refunding orders, changing customers, pushing stock to Shopify/TikTok, or editing/deleting formulas. Do not invent those operations as raw MCP CRUD. When the app gains one of them, add its corresponding named tool and domain rules as part of that feature.

## How a direct write works

1. Claude uses the existing read tools to identify a stable record ID and current version. A title is discovery help, never the authority for a write.
2. Claude calls the named MCP tool with typed fields, an operation-specific reason where relevant, the expected current version/value, and an idempotency key. The OAuth bearer token identifies the user and client. No browser cookie or app approval is involved in the call.
3. The MCP write adapter checks token validity, current account status, the exact action scope and policy, request size/rate limits, and the tool schema. It constructs a typed domain command and assistant actor. It does not issue SQL itself or call a browser route with a forged session.
4. The adapter first reserves the idempotency key durably. The domain command runs the existing business logic and its preconditions inside its own transaction with the business change, domain ledger, and application activity. The adapter then records the result. A stale value returns a conflict; Claude must refresh safe read data before choosing a new action. If the process stops after the business commit but before result storage, the key stays pending/uncertain and cannot be replayed automatically.
5. The tool returns the actual outcome, identifiers, before/after values or created record, and operation ID. Retrying the same key with the same arguments returns the recorded result; reusing it with different arguments fails. Claude reports only what the app committed.

Not every action has the same precondition: an absolute count checks the current count/version; a batch creation checks the formula and ingredient snapshot and unique batch number; an incremental packaging update checks the current packaged amount; a mapping replacement checks all submitted listing/group revisions. All check the current state at execution time. User-provided order notes, product titles, CSV cells, and provider text remain untrusted data, never instructions to the MCP server.

## Authorization and safety without per-action approval

- Add separate scopes for physical inventory, packaging, Labs, mappings, shipments, team administration, integration runs, and connection setup. A read grant remains read-only; write scopes require explicit initial OAuth consent. Refresh rotation never enlarges the granted scope. The current consent page and OAuth metadata must describe the granted capabilities accurately.
- Keep a server-side per-user/per-client action allowlist that is checked on every call and can be revoked immediately. The existing `MCP_ALLOW_ALL_AUTHENTICATED_USERS` read setting must not grant writes. Restrict the first connection to the client's user ID and approved Claude client registration, then expand only if staff access is intended. Verify the account still exists and is active before every write.
- Use a durable idempotency table and explicit operation result for all writes, especially batch packaging increments, creates, imports, archives, and sync triggers. Add optimistic concurrency where existing absolute-replacement functions lack it. Per-user/client/action rate limits and bounded bulk sizes must be database-backed; the current process-local concurrency map is insufficient for write safety on serverless deployments.
- Preserve existing domain invariants: no negative physical or ingredient stock, no implicit channel stock push, exact bundle components, linked-record archive guards, batch allocation and unit rules, and append-only ledgers. The read-only MCP database credential remains read-only; the write adapter gets only a narrow code path to the primary repository/domain layer.
- Record the initiating user, OAuth client, tool/action, operation ID, target IDs, safe before/after summary, timestamp, and outcome. Mark activity source as assistant/MCP instead of `manual`. Keep tokens, passwords, raw prompts, and customer details out of logs. Surface assistant actions in staff history and provide token/client revocation plus a separate MCP-write kill switch.
- Publish correct write-tool annotations for client UX while enforcing every rule on the server. Claude and ChatGPT may show their own tool confirmations, but the app does not depend on those prompts for authorization.
- High-impact operations such as archiving, mapping replacement, employee onboarding, or batch creation can use narrower scopes and stricter server rules while remaining directly callable by Claude. If the business wants a specific operation to require a human decision, design that exception explicitly rather than adding approval to every write.

## Architecture and delivery

The implementation should define a **command registry** mapping each MCP tool to one typed application/domain command, required scope, input/output schema, idempotency behavior, precondition, and audit event. Browser routes and MCP tools should call the same commands. Never make the MCP layer a second implementation of inventory or Labs logic. Keep `assistant-read-repository.ts` and its read-only import-graph tests intact; write imports live only in a distinct module. Update `docs/agents/ARCHITECTURE.md` and add a new ADR when interfaces are implemented.

Deliver in reviewable vertical slices while targeting the complete catalogue:

1. Shared command infrastructure: write scopes/policy, actor provenance, idempotency, version checks, structured errors, distributed limits, and a write kill switch.
2. Physical catalogue and counts; packaging; Labs ingredients/imports, formulas, batches, and packaged output.
3. Channel mappings/product links, shipment linking, employee invitation, and manual sync/refresh/connection initiation.
4. Contract coverage gate: enumerate all authenticated staff mutation routes and fail when a business action lacks a corresponding MCP command or an explicit documented system-only exception. Run typecheck, tests, lint, build, and live Claude/ChatGPT staging checks before production. Include read-only token denial, revoked user/client, concurrent updates, retries, bulk partial failure, prompt-injection text, cross-domain isolation, and audit verification.

The accepted concept is captured in `issues/prd.md` and `issues/009-mcp-staff-write-parity.md` under `docs/agents/WORKFLOW.md`. The implementation is in the main app checkout at the user's request, alongside existing Labs changes. No worktree or PR is involved.

## Evidence from the repository and external clients

- `app/api/` has the staff mutations listed above. `lib/repository.ts` holds the domain writes; physical, packaging, and ingredient absolute updates lack a stale-value precondition today. The current employee route asks for a password. The old `/api/inventory/master` and `/api/inventory/clear-channel-mappings` routes return HTTP 410.
- `lib/mcp-server.ts`, `lib/mcp-contracts.ts`, `lib/mcp-auth.ts`, and the OAuth consent route currently advertise read/PII scopes and read-only behavior. `lib/turso.ts` and `tests/mcp-connector.test.mjs` protect the read path's separate database/import boundary.
- MCP annotations are hints, not enforcement: <https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/>. Claude remote connectors can expose write tools: <https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp>. ChatGPT custom MCP write availability and confirmation behavior depend on workspace plan and settings: <https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt>.
