# State

**Last Updated:** 2026-03-03
**Current Work:** Playwright migration + extraction improvements COMPLETE (PR #32, 7 commits). Facebook connector uses headless Chromium with "See more" expansion, improved Hebrew extraction (price/bedroom/city/tag patterns), and robust post ID fallbacks. 210 tests passing. Known limitation: sponsored posts get `txt_` hash IDs. Pending roadmap items: facebook-pagination, ai-extraction, brokerage-detection, sublet-rent-classification.

---

## Recent Decisions (Last 60 days)

### AD-020: Playwright migration for Facebook connector (2026-03-03)

**Decision:** Migrate Facebook connector from raw `fetch()` GraphQL API calls to Playwright headless browser. Also evaluated and rejected `moda20/facebook-scraper` Python library.
**Reason:** Facebook sessions expire every few hours because the platform detects non-browser HTTP clients. Tested `moda20/facebook-scraper` (Python, `requests-html` against `m.facebook.com`) — Facebook 301-redirects all `m.facebook.com/groups/*` to `www.facebook.com` and serves "unsupported browser" interstitial. Tested with raw cookies, Chrome cookie jar, noscript mode, multiple user agents — all return 0 posts. A real browser engine is the only viable approach.
**Trade-off:** Higher runtime overhead (~10-15s vs ~2s per group), Chromium dependency in CI (~150MB), increased GitHub Actions timeout (5→10 min). Eliminates need for `FB_DOC_ID`, `FB_DTSG`, `FB_LSD` env vars.
**Impact:** Rewrite of `client.ts` and `parser.ts`. Connector architecture, state management, circuit breaker, account rotation unchanged. Spec at `.specs/features/facebook-playwright/`.

### AD-019: Facebook connector rewrite to GraphQL API (2026-03-02)

**Decision:** Replace mbasic.facebook.com HTML scraping with Facebook's internal GraphQL API (`POST /api/graphql/`). Key discovery: `jazoest` CSRF checksum (computed from `fb_dtsg`) is required for all requests.
**Reason:** mbasic.facebook.com now blocks all non-browser HTTP clients with an "unsupported browser" interstitial page. GraphQL API returns structured NDJSON (Relay incremental delivery) — no HTML parsing or Cheerio needed.
**Trade-off:** Requires `fb_dtsg`/`lsd` CSRF tokens that expire in 24–48h (will be auto-extracted from homepage in next iteration). `doc_id` can change on Facebook deploys. Response format is NDJSON, not single JSON.
**Impact:** All Facebook connector files rewritten. Cheerio removed. 15 tests (9 parser + 6 connector). 166 total tests. Confirmed working with live data (3 posts fetched).

### AD-018: Facebook connector via mbasic.facebook.com — SUPERSEDED (2026-03-02)

**Decision:** ~~Scrape Facebook group posts from `mbasic.facebook.com`.~~ Superseded by AD-019 (GraphQL API).
**Reason:** mbasic approach blocked by Facebook's "unsupported browser" interstitial for all non-browser HTTP clients.

### AD-017: YAD2 listing recency via orderId + image date (2026-03-02)

**Decision:** Filter old YAD2 listings using orderId threshold (higher = newer) and extract approximate post date from image URL filenames.
**Reason:** YAD2 map API returns no date fields. Users were receiving notifications for stale listings.
**Trade-off:** orderId is a proxy, not exact date. Image URL pattern may change.
**Impact:** PR #25 adds `minOrderId` to cursor state, `parseImageDate()` utility, 9 new tests. 151 total tests.

### AD-016: Half-room support (3.5 rooms) (2026-03-02)

**Decision:** Support half-room counts (e.g., 3.5) in filters and listings. SQLite dynamic typing handles floats without migration.
**Reason:** Israeli real estate commonly uses half-rooms. System was rejecting valid values like 3.5.
**Trade-off:** Validation constrains to 0.5 increments (not arbitrary decimals like 3.7).
**Impact:** PR #24 changes `parseInt` → `parseFloat` with `% 0.5` validation, removes `.int()` from Zod schemas. 2 new filter matching tests.

### AD-015: CI workflow for PRs (2026-03-01)

**Decision:** Add `.github/workflows/ci.yml` to run typecheck and tests on every PR to main and push to main.
**Reason:** No CI existed for pull requests. Tests and typecheck were only run locally.
**Impact:** PR #22 adds the workflow. 136 tests run in ~21s on GitHub Actions.

### AD-014: Reusable D1 REST API adapter (2026-03-01)

**Decision:** Extract inline D1 REST API code from `scripts/collect-yad2.ts` into a reusable `D1RestClient` class in `@rentifier/db`.
**Reason:** The script had ~50 lines of inline HTTP calls with `as any` casts. As more scripts may need D1 REST access, a proper typed adapter prevents duplication.
**Trade-off:** Single `as unknown as D1Database` cast at the factory boundary; consumers are fully typed.
**Impact:** `packages/db/src/rest-client.ts` provides `D1RestClient`, `createRestDB`, `createRestDBFromEnv`. Script shrunk from ~135 to ~80 lines with zero raw SQL and zero `as any`.

### AD-013: Filter matching engine tests (2026-03-01)

**Decision:** Add 33 dedicated unit tests for `matchesFilter()` and export it for testability.
**Reason:** Core business logic for personalized notifications had zero dedicated tests despite supporting 7 filter criteria.
**Impact:** PR #21 adds comprehensive coverage: price range (9), bedrooms (4), cities (5), neighborhoods (4), keywords (6), must-have tags (3), exclude tags (3), combined (2). Total test count: 136.

### AD-012: M2 YAD2 Production Readiness (2026-02-23)

**Decision:** Prioritize M2 completion over M3 Filter Matching Engine. Focus on production-ready YAD2 connector with configurable city selection and mock connector removal.
**Reason:** YAD2 connector has critical issues: (1) 200-result API limit means unfocused fetching misses posts in target cities, (2) Mock connector pollutes production data, (3) Rental endpoint unverified, (4) Hardcoded city list prevents deployment flexibility.
**Trade-off:** Delays Filter Matching Engine (multi-user matching), but ensures single-user deployment works reliably.
**Impact:** Created feature spec at `.specs/features/m2-yad2-production-readiness/`. Will implement configurable city selection (likely database table for future multi-user support), remove mock connector entirely, verify rental API endpoint, add coverage monitoring for 200-result limit.

### AD-011: Hebrew city name normalization (2026-02-23)

**Decision:** Normalize all city names to Hebrew canonical form throughout the system. Created centralized `normalizeCity()` function in `@rentifier/extraction` package.
**Reason:** Database had inconsistent city names (Hebrew/English mix) due to conflicting normalization logic. YAD2 API returns inconsistent language, extraction patterns mapped to English, resulting in mixed data that broke filtering.
**Trade-off:** Requires all future data sources to call `normalizeCity()` in their connector. Single-language (Hebrew) for now; multi-language support deferred.
**Impact:**
- Created `packages/extraction/src/cities.ts` with CITY_VARIANTS mapping (Hebrew + English variants → Hebrew canonical)
- Updated extraction patterns to return Hebrew city names
- YAD2 connector applies normalization with graceful fallback
- Migration 0009 converts existing English city names to Hebrew
- All tests updated and passing (99 tests)
- Future-proofed: all connectors must import and use `normalizeCity()`

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

### M2 - YAD2 Production Readiness (2026-03-01)

Complete YAD2 connector production readiness with full mock data removal. All 15 tasks completed:
- **Database:** monitored_cities table with 3 seeded cities (תל אביב, ירושלים, חיפה)
- **Connector:** Dynamic city fetching from DB, 200-result monitoring and warnings, breaking change to accept DB parameter
- **Mock removal:** Complete removal of all mock data from migrations and seed scripts
- **GitHub Actions:** Yad2 scraper runs every 30min via cron (bypasses Radware IP block)
- **D1 REST Client:** Reusable typed adapter in `@rentifier/db` for scripts running outside Workers
- **CI pipeline:** Fixed pnpm version, workspace deps, DB adapter for GitHub Actions
- **End-to-end:** Full pipeline tested - 1,868 YAD2 listings fetched → normalized → 100 notifications sent
- **Status:** Deployed to production, all PRs merged (#17-#20)

### M3 - Filter Matching Engine (2026-03-01)

Filter matching was already implemented in `notification-service.ts` during M3 bot work. Added dedicated test coverage:
- **matchesFilter():** 7 criteria — price, bedrooms, city, neighborhood, keywords (OR), must-have tags (AND), exclude tags (NOT)
- **Tests:** 33 unit tests covering all matching criteria (PR #21)
- **CI:** Added `.github/workflows/ci.yml` — typecheck + tests on every PR (PR #22)
- **Total tests:** 136 across 8 test files

### Half-Room Support (2026-03-02)

- Support for 3.5-style room counts in filters and listings (PR #24)
- SQLite dynamic typing handles floats without migration
- Zod validation constrains to 0.5 increments

### YAD2 Listing Recency (2026-03-02)

- orderId-based filtering skips old listings (PR #25)
- Image URL date extraction for `rawPostedAt`
- 9 new tests, 151 total

### M4 - Facebook Groups Connector (2026-03-02 → 2026-03-03)

- **Phase 1 (GraphQL, superseded):** Built GraphQL API connector — worked initially but sessions expired every few hours
- **Phase 2 (Playwright, current):** Migrated to headless Chromium browser for stable long-lived sessions
  - Playwright headless scraper: DOM extraction from rendered feed pages
  - "See more" expansion: clicks truncated post buttons before extraction
  - Multi-account cookie rotation with disabled account tracking
  - Collection script with `--local` flag for local D1 testing
  - Admin Telegram notification on cookie expiry
  - GitHub Actions workflow (30-min cron, Chromium install step)
- **Extraction improvements:**
  - Hebrew price patterns: `שכירות`, `שכ'ד`, `ב` prefix (e.g., `ב7,600`)
  - City variant: `ת״א` (Hebrew gershayim)
  - Bedroom abbreviation: `חד'`
  - Negation-aware tags: "בלי מעלית" doesn't match elevator tag
  - Post ID: 4 fallback strategies (timestamp links, group-specific URLs, broad numeric IDs, content hash)
- **Architecture:** `FacebookNormalizer` extracted to prevent Playwright bundling in Workers; connector runs only from GitHub Actions
- **Known limitation:** Sponsored/ad posts get `txt_` hash IDs — Facebook hides post IDs from DOM for sponsored content
- **Status:** PR #32 (7 commits), E2E verified locally (11-13 posts from 3 groups), pending merge
- **Total tests:** 210 across 11 test files

---

## Lessons Learned

- Store full `ListingCandidate` as `raw_json` in `listings_raw`, not just `sourceData` — the processor needs the complete candidate to reconstruct all fields.
- All workers should use the `createDB()` factory consistently — bypassing the DB abstraction leads to data contract mismatches.
- Connector lookup in the processor should be source-name-based (via `db.getSourceById()`), not hardcoded.
- Database operations are shared concerns — use root-level config instead of running through individual apps. The local D1 database is shared at `.wrangler/` (via `--persist-to` flag), so scripts should reflect that architecture.

---

## Preferences

**Model Guidance Shown:** never
