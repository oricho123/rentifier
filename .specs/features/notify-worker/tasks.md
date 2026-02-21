# Notify Worker - Task Breakdown

**Feature**: Notify Worker (Cron-triggered Telegram notification system)
**Spec**: `/Users/orila/Development/rentifier/.specs/features/notify-worker/spec.md`
**Design**: `/Users/orila/Development/rentifier/.specs/features/notify-worker/design.md`

---

## Execution Plan

### Phase 1: Database Layer (Sequential)
T1 → T2 → T3 → T4

### Phase 2: Core Services (Parallel after Phase 1)
T5, T6, T7 [P]

### Phase 3: Integration Layer (Sequential after Phase 2)
T8 → T9

### Phase 4: Worker Entry Point (Sequential after Phase 3)
T10 → T11

### Phase 5: Configuration & Testing (Parallel after Phase 4)
T12, T13 [P]

---

## Tasks

### T1: Create filter matching query

**What**: SQL query helper to find listings matching a filter that haven't been sent
**Where**: `packages/db/src/queries/filters.ts`
**Depends on**: None
**Done when**:
- [ ] Function `matchListingsForFilter(db: D1Database, filter: Filter, userId: number, limit: number): Promise<Listing[]>` exported
- [ ] LEFT JOIN anti-pattern: `listings` LEFT JOIN `notifications_sent` WHERE `notifications_sent.id IS NULL`
- [ ] Implements all filter criteria: minPrice, maxPrice, minBedrooms, maxBedrooms, citiesJson, neighborhoodsJson, keywordsJson, mustHaveTagsJson, excludeTagsJson
- [ ] Uses SQLite `json_each()` for JSON array filtering
- [ ] ORDER BY `ingested_at DESC`
- [ ] Accepts LIMIT parameter (default: 100)
**Verify**: Unit test with filter + matching/non-matching listings → verify only matches returned and unsent only

---

### T2: Create active filters query

**What**: SQL query helper to retrieve all enabled filters
**Where**: `packages/db/src/queries/filters.ts`
**Depends on**: None
**Done when**:
- [ ] Function `findActiveFilters(db: D1Database): Promise<Filter[]>` exported
- [ ] Queries `filters` table WHERE `enabled = true`
- [ ] Returns full filter objects with all criteria fields
**Verify**: Unit test with 2 enabled, 1 disabled filter → verify 2 returned

---

### T3: Create notification tracking query

**What**: SQL query helper to record successful notification sends
**Where**: `packages/db/src/queries/notifications.ts`
**Depends on**: None
**Done when**:
- [ ] Function `recordNotificationSent(db: D1Database, record: { userId: number, listingId: number, channel: string }): Promise<void>` exported
- [ ] Uses `INSERT INTO notifications_sent (user_id, listing_id, sent_at, channel) VALUES (?, ?, CURRENT_TIMESTAMP, ?)`
- [ ] Includes `ON CONFLICT(user_id, listing_id) DO NOTHING` for idempotency
**Verify**: Call twice with same userId/listingId → verify only 1 row in table

---

### T4: Export query helpers from db package

**What**: Re-export notification query functions from main db package index
**Where**: `packages/db/src/index.ts`
**Depends on**: T1, T2, T3
**Done when**:
- [ ] `matchListingsForFilter` exported from package root
- [ ] `findActiveFilters` exported from package root
- [ ] `recordNotificationSent` exported from package root
- [ ] TypeScript builds without errors
**Verify**: Import in external file: `import { matchListingsForFilter } from '@rentifier/db'`

---

### T5: Create MessageFormatter class [P]

**What**: Service that formats listings into readable Telegram HTML messages
**Where**: `workers/notify/src/message-formatter.ts`
**Depends on**: T4
**Done when**:
- [ ] Class `MessageFormatter` with method `format(listing: Listing): string`
- [ ] Returns HTML-formatted string with bold title, price, bedrooms, location, link
- [ ] Helper method `formatPrice(amount, currency, period)` with ₪ symbol for ILS
- [ ] Helper method `escapeHtml(text)` to prevent injection
- [ ] Omits optional fields (neighborhood, tags) when null/undefined
**Verify**: Unit test with full listing → verify HTML includes all fields; test with missing fields → verify graceful omission

---

### T6: Create TelegramClient class [P]

**What**: Service that wraps Telegram Bot API with error handling
**Where**: `workers/notify/src/telegram-client.ts`
**Depends on**: T4
**Done when**:
- [ ] Class `TelegramClient` with constructor accepting `botToken: string`
- [ ] Method `sendMessage(chatId: string, text: string, parseMode: 'HTML' | 'MarkdownV2'): Promise<TelegramSendResult>`
- [ ] Interface `TelegramSendResult` with: `{ success: boolean, messageId?: number, error?: string, retryable?: boolean }`
- [ ] Detects HTTP 429 (rate limit) → returns `{ success: false, retryable: true }`
- [ ] Detects HTTP 400 with "chat not found" → returns `{ success: false, retryable: false }`
- [ ] Catches network errors → returns `{ success: false, retryable: true }`
**Verify**: Unit test with mock fetch: success → verify messageId returned; 429 → verify retryable=true; 400 → verify retryable=false

---

### T7: Create NotificationService class [P]

**What**: Core orchestration service for notification loop
**Where**: `workers/notify/src/notification-service.ts`
**Depends on**: T4
**Done when**:
- [ ] Class `NotificationService` with constructor: `(db: D1Database, telegram: TelegramClient, formatter: MessageFormatter)`
- [ ] Method `processNotifications(): Promise<NotificationResult>`
- [ ] Interface `NotificationResult` with: `{ sent: number, failed: number, errors: NotificationError[] }`
- [ ] Interface `NotificationError` with: `{ userId: number, listingId: number, filterId: number, error: string }`
- [ ] Skeleton loop: fetch active filters → for each filter, fetch matches → placeholder send logic
**Verify**: Unit test with mock dependencies → verify loop structure correct

---

### T8: Integrate send + record flow in NotificationService

**What**: Wire MessageFormatter, TelegramClient, and recordNotificationSent into notification loop
**Where**: `workers/notify/src/notification-service.ts`
**Depends on**: T5, T6, T7
**Done when**:
- [ ] For each match: call `formatter.format(listing)` to get message text
- [ ] Fetch user's `telegram_chat_id` from DB (query helper needed: `getUserById`)
- [ ] Call `telegram.sendMessage(chatId, message, 'HTML')`
- [ ] If `sendResult.success === true`, call `recordNotificationSent()`
- [ ] If `sendResult.retryable === true`, increment failed count but don't record (will retry next cron)
- [ ] If `sendResult.retryable === false`, increment failed and skip user permanently
- [ ] Per-match try/catch isolation
**Verify**: Integration test: mock successful send → verify recordNotificationSent called; mock rate limit → verify not recorded

---

### T9: Add structured logging to NotificationService

**What**: Add contextual logging with userId, listingId, filterId, send stats
**Where**: `workers/notify/src/notification-service.ts`
**Depends on**: T8
**Done when**:
- [ ] Log at start: `{ event: 'notify_start', activeFilters }`
- [ ] Log per-filter: `{ event: 'filter_processed', filterId, matchCount }`
- [ ] Log per-send success: `{ event: 'notification_sent', userId, listingId, messageId }`
- [ ] Log per-send failure: `{ event: 'notification_failed', userId, listingId, error, retryable }`
- [ ] Log at end: `{ event: 'notify_complete', sent, failed, errors }`
**Verify**: Run service with 1 success, 1 failure → verify 5+ log lines with correct context

---

### T10: Create worker scheduled handler

**What**: Cloudflare Workers scheduled entry point that orchestrates notifications
**Where**: `workers/notify/src/index.ts`
**Depends on**: T9
**Done when**:
- [ ] Default export with `scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void>`
- [ ] Interface `Env` with: `DB: D1Database`, `TELEGRAM_BOT_TOKEN: string`
- [ ] Instantiates `TelegramClient` with `env.TELEGRAM_BOT_TOKEN`
- [ ] Instantiates `MessageFormatter`
- [ ] Instantiates `NotificationService` with DB, telegram, formatter
- [ ] Calls `service.processNotifications()` and logs result
- [ ] Returns void
**Verify**: Mock ScheduledEvent + Env → verify service.processNotifications() called

---

### T11: Add getUserById query helper

**What**: SQL query helper to fetch user with telegram_chat_id
**Where**: `packages/db/src/queries/users.ts`
**Depends on**: T10
**Done when**:
- [ ] Function `getUserById(db: D1Database, userId: number): Promise<User>` exported
- [ ] Queries `users` table for row with matching id
- [ ] Returns user object with `{ id, telegram_chat_id, ... }`
- [ ] Throws error if user not found
**Verify**: Unit test with existing userId → verify user returned; test with non-existent → verify error thrown

---

### T12: Create wrangler.toml configuration [P]

**What**: Cloudflare Workers configuration for notify worker
**Where**: `workers/notify/wrangler.toml`
**Depends on**: T11
**Done when**:
- [ ] `name = "rentifier-notify"`
- [ ] `main = "src/index.ts"`
- [ ] `compatibility_date = "2024-01-01"`
- [ ] D1 binding: `[[d1_databases]]` with `binding = "DB"` (same database_id as processor)
- [ ] Cron trigger: `crons = ["*/5 * * * *"]` (every 5 minutes)
- [ ] Comment indicating TELEGRAM_BOT_TOKEN is a secret (set via CLI)
**Verify**: `wrangler dev` starts without errors (with mocked secret)

---

### T13: Create worker package.json [P]

**What**: Package manifest for notify worker with dependencies
**Where**: `workers/notify/package.json`
**Depends on**: T11
**Done when**:
- [ ] `name: "@rentifier/notify-worker"`
- [ ] Dependencies: `@rentifier/core`, `@rentifier/db`
- [ ] DevDependencies: `wrangler`, `vitest`, `@cloudflare/workers-types`
- [ ] Scripts: `dev`, `deploy`, `test`
**Verify**: `npm install` completes without errors

---

## Parallel Execution Map

```
T1 ─┐
T2 ─┤─→ T4 ─┬─→ T5 ─┐
T3 ─┘       ├─→ T6 ─┤─→ T8 ─→ T9 ─→ T10 ─→ T11 ─┬─→ T12
            └─→ T7 ─┘                            └─→ T13
```

**Sequential bottlenecks**: T4 (query exports), T8 (integration), T9 (logging), T10 (handler), T11 (getUserById)
**Parallel opportunities**: Phase 2 (T5, T6, T7 can run simultaneously), Phase 5 (T12, T13 can run simultaneously)

**Total tasks**: 13
**Estimated parallelizable**: 5 tasks (T5, T6, T7, T12, T13)
**Critical path length**: 9 tasks (T1→T4→T7→T8→T9→T10→T11→T12)

---

## Cross-Feature Dependencies

**Processor ➔ Notify**: Notify worker assumes canonical `listings` table is populated by processor
**Shared**: Both workers use `@rentifier/db` package and same D1 database binding

**Recommended build order**:
1. Build processor worker first (establishes canonical listings)
2. Test processor with sample raw listings
3. Build notify worker (consumes canonical listings)
4. Test end-to-end: raw listing → processor → notify → Telegram message
