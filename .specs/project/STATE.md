# State

**Last Updated:** 2026-02-23
**Current Work:** Listing images in Telegram - IMPLEMENTATION COMPLETE, ready for testing and deployment

---

## Recent Decisions (Last 60 days)

### AD-010: Processing tracking with processed_at and worker state (2026-02-22)

**Decision:** Add explicit `processed_at` timestamp to `listings_raw` table and cursor-based notification tracking via `worker_state` table.
**Reason:** The original LEFT JOIN approach for detecting unprocessed listings was fragile and led to re-processing all data on every processor run. Notifications were being sent multiple times due to lack of cursor tracking between notify worker runs.
**Trade-off:** Adds `worker_state` table and `processed_at` column, slightly more complex state management, but guarantees idempotent operations and prevents duplicate notifications.
**Impact:** Migration 0007 adds `processed_at` to `listings_raw`, creates `worker_state` table, and backfills existing data. Processor uses simple `WHERE processed_at IS NULL` query with partial index. Notify worker tracks last run time to avoid re-processing listings. Both workers are now fully idempotent.

### AD-009: Database scripts use root wrangler config (2026-02-22)

**Decision:** All database operation scripts (migrate, query, seed) use root `wrangler.migrations.json` as single source of truth, instead of running through individual app contexts.
**Reason:** Database operations are a shared concern across all workers. Running through `@rentifier/collector` was an architectural inconsistency - migrations should be app-agnostic.
**Trade-off:** Requires wrangler to be available at root level (already a dev dependency), but this is cleaner than the workaround.
**Impact:** Scripts simplified from `pnpm --filter @rentifier/collector exec wrangler ...` to `wrangler ... --config wrangler.migrations.json`. Single source of truth, consistent between local and remote operations.

### AD-006: Hebrew-only localization for M3 (2026-02-22)

**Decision:** Implement Hebrew localization exclusively for M3. Multi-language support deferred to future milestone.
**Reason:** Target audience is Israeli Hebrew speakers. Single-language implementation is simpler and faster to deliver.
**Trade-off:** Non-Hebrew speakers cannot use the bot. English/Russian/Arabic support requires additional work later.
**Impact:** All bot messages, command descriptions, and UI elements in Hebrew. Centralized i18n module (`i18n/he.ts`) for maintainability.

### AD-007: Callback query format - colon-separated action hierarchy (2026-02-22)

**Decision:** Use `action:subaction:param` format for inline keyboard callback data (e.g., `filter:delete:5`, `quick:filter`).
**Reason:** Simple to parse, hierarchical structure allows routing, fits within Telegram's 64-byte limit.
**Trade-off:** Limited to 3 levels of nesting. Complex data may require database lookup instead of encoding in callback.
**Impact:** All keyboard builders follow this format. Callback router parses with `data.split(':')`.

### AD-008: Hybrid text/button flows for filter creation (2026-02-22)

**Decision:** Allow users to either click buttons OR type text during filter creation. Callback queries update conversation state mid-flow.
**Reason:** Flexibility improves UX—power users can type, casual users can click. Conversation state is the single source of truth.
**Trade-off:** More complex state management. Callback handlers must validate conversation state.
**Impact:** FilterCommand handles both text replies and callback queries. CallbackQueryRouter updates state and delegates to command handlers.

---

## Recent Decisions (Last 60 days)

### AD-001: Cloudflare as sole infrastructure provider (2026-02-21)

**Decision:** Use Cloudflare Workers + D1 + Cron Triggers + KV for all compute, storage, and scheduling.
**Reason:** Generous free tier covers projected usage; single-vendor simplicity reduces operational overhead for a solo developer.
**Trade-off:** Locked into Cloudflare's runtime constraints (10ms CPU per request on free tier, D1's SQLite dialect). Migration to another platform would require rewriting worker entry points and DB layer.
**Impact:** All three services (collector, processor, notify) are Cloudflare Workers with separate `wrangler.toml` configs.

### AD-002: TypeScript monorepo with pnpm workspaces (2026-02-21)

**Decision:** Structure the project as a monorepo with shared packages rather than separate repos or a single flat app.
**Reason:** Shared types, DB schema, connector interfaces, and extraction logic across three workers. Monorepo keeps everything in sync without publishing packages.
**Trade-off:** Slightly more complex initial setup; CI must handle selective deployment.
**Impact:** Repo structure uses `apps/` for workers and `packages/` for shared code.

### AD-003: YAD2 as first data source, Facebook deferred (2026-02-21)

**Decision:** Start with YAD2 instead of Facebook. Facebook connector deferred to M4.
**Reason:** Facebook scraping has significant legal (ToS) and technical (anti-bot) barriers. YAD2 is a more accessible starting point to prove the system works.
**Trade-off:** Facebook is arguably the richest source for Israeli rentals; deferring it delays full market coverage.
**Impact:** M2 focuses entirely on YAD2. Facebook connector research happens in M4 with proper legal consideration.

### AD-004: Rules-first extraction, AI as fallback (2026-02-21)

**Decision:** Use regex/rule-based extraction as the primary method. AI (Cloudflare Workers AI or similar) only for ambiguous cases.
**Reason:** Keeps costs at zero for the majority of listings. Structured sources like YAD2 may already provide parsed fields, reducing AI need further.
**Trade-off:** Rules require maintenance as source formats change; may miss nuanced listings.
**Impact:** `packages/extraction` implements a pipeline: rules first, confidence check, AI fallback if below threshold.

### AD-005: Yad2 API safety mechanisms (2026-02-21)

**Decision:** Implement retry with exponential backoff, captcha detection, and a circuit-breaker pattern for the Yad2 connector.
**Reason:** The Yad2 API is known to be intermittently unavailable and uses Radware Bot Manager for captcha protection. Without safety mechanisms, cron-triggered fetches would silently fail or waste CPU budget on blocked requests.
**Trade-off:** Adds complexity to the connector; circuit breaker state needs persistence in `source_state`.
**Impact:** Connector stores failure counts and backoff timestamps in `source_state.cursor` JSON. Collector skips sources in circuit-breaker-open state.

---

## Active Blockers

*None currently.*

---

## Completed Milestones

### M1 - Foundation (2026-02-21)

All 6 features implemented: monorepo setup, shared packages (core, db, connectors, extraction), D1 schema (7 tables + indexes + seed), collector worker, processor worker, notify worker. 37 source files, zero TypeScript errors. Architect-verified.

### Telegram Bot Commands (M3, 2026-02-22)

All 7 commands implemented and merged to main via PR #7. Webhook handler, conversation state management, database migration complete. VPN issue documented. Ready for production deployment.

### Telegram Bot Improvements (M3, 2026-02-22)

Complete Hebrew localization and interactive UI upgrade implemented via Ralph autonomous loop. All 12 tasks completed:
- Phase 1: I18n module, keyboard builders, callback router, telegram client extensions, webhook types
- Phase 2: Bot menu configurator with Hebrew command descriptions
- Phase 3-4: All 7 commands migrated to Hebrew with interactive keyboards, callback handlers
- Verification: TypeScript 0 errors, verifier approved, architect approved (95% deployment ready)
- Status: Ready for staging deployment and manual testing
- Files: 16 changed (12 modified, 4 new modules), 1,100+ lines added
- Documentation: Complete spec, design, tasks, and implementation completion documents

### Street Address with Google Maps Links (2026-02-23)

Complete implementation of clickable street addresses in Telegram notifications. All tasks completed:
- Database: Added `street` and `house_number` columns (migration 0008)
- YAD2 Connector: Extract street and house number from API response
- Message Formatter: Format street as clickable Google Maps link with Hebrew city names
- Data Processing: Convert house numbers to integers, escape HTML URLs properly
- Testing: 48 test notifications sent successfully with working links
- Status: MERGED to main via PR #12
- Files: 11 changed (schema, types, connector, formatter, queries, tests)
- Documentation: Complete spec, design, and task breakdown

### Listing Images in Telegram Notifications (2026-02-23)

Complete implementation of photo messages in Telegram notifications. All tasks completed:
- TelegramClient: Added sendPhoto() method with intelligent error handling
- NotificationService: Image support with fallback to text-only on failures
- Error Handling: Distinguish retryable (502, 503, 504, 429) vs non-retryable errors (400)
- Metrics: Track imageSuccess, imageFallback, noImage counts + imageSuccessRate
- Testing: 15 new tests (7 telegram-client + 8 notification-service), all passing
- TypeScript: Zero compilation errors
- Status: Implementation complete, ready for manual testing and deployment
- Files: 4 changed (telegram-client, notification-service, 2 test files)
- Documentation: Complete spec, design, tasks, and implementation notes

---

## Lessons Learned

- Store full `ListingCandidate` as `raw_json` in `listings_raw`, not just `sourceData` — the processor needs the complete candidate to reconstruct all fields.
- All workers should use the `createDB()` factory consistently — bypassing the DB abstraction leads to data contract mismatches.
- Connector lookup in the processor should be source-name-based (via `db.getSourceById()`), not hardcoded.
- Database operations are shared concerns — use root-level config instead of running through individual apps. The local D1 database is shared at `.wrangler/` (via `--persist-to` flag), so scripts should reflect that architecture.

---

## Preferences

**Model Guidance Shown:** never
