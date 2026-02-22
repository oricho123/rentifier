# Tasks: Data Duplication Bug Fix

**Feature:** Fix processor re-processing and duplicate notification issues
**Status:** Ready for Implementation
**Created:** 2026-02-22

## Task List

### Phase 1: Database Schema (Foundation)

#### Task 1.1: Create migration 0007
**File:** `packages/db/migrations/0007_processing_tracking.sql`
**Dependencies:** None
**Estimated Lines:** 25

**Acceptance Criteria:**
- [ ] Create new migration file
- [ ] Add `processed_at` column to `listings_raw` (nullable TEXT)
- [ ] Backfill processed_at for existing raw listings that exist in listings
- [ ] Create partial index `idx_listings_raw_processed` on `processed_at` WHERE NULL
- [ ] Create `worker_state` table with worker_name, last_run_at, last_status, last_error
- [ ] Migration runs successfully on local D1 database

**Verification:**
```bash
wrangler d1 migrations apply DB --local --config wrangler.migrations.json
sqlite3 .wrangler/state/v3/d1/miniflare-D1DatabaseObject/db.sqlite \
  "PRAGMA table_info(listings_raw);" # should show processed_at column
```

---

#### Task 1.2: Update schema types
**File:** `packages/db/src/schema.ts`
**Dependencies:** Task 1.1
**Estimated Lines:** 10

**Acceptance Criteria:**
- [ ] Add `processed_at: string | null` to `ListingRaw` interface
- [ ] Add new `WorkerState` interface with worker_name, last_run_at, last_status, last_error
- [ ] TypeScript compiles with no errors

**Verification:**
```bash
pnpm --filter @rentifier/db build
```

---

### Phase 2: Database Layer Updates

#### Task 2.1: Update getUnprocessedRawListings query
**File:** `packages/db/src/queries.ts`
**Dependencies:** Task 1.2
**Estimated Lines:** 10 (net -5, replacing LEFT JOIN)

**Acceptance Criteria:**
- [ ] Replace LEFT JOIN query with simple `WHERE processed_at IS NULL`
- [ ] Add `ORDER BY fetched_at ASC` for FIFO processing
- [ ] Keep LIMIT parameter
- [ ] Return type unchanged (Promise<ListingRaw[]>)

**Before:**
```typescript
SELECT lr.* FROM listings_raw lr
LEFT JOIN listings l ON lr.source_id = l.source_id AND lr.source_item_id = l.source_item_id
WHERE l.id IS NULL
LIMIT ?
```

**After:**
```typescript
SELECT * FROM listings_raw
WHERE processed_at IS NULL
ORDER BY fetched_at ASC
LIMIT ?
```

**Verification:**
- [ ] TypeScript compiles
- [ ] Method signature unchanged

---

#### Task 2.2: Add markRawListingProcessed method
**File:** `packages/db/src/queries.ts`
**Dependencies:** Task 1.2
**Estimated Lines:** 8

**Acceptance Criteria:**
- [ ] Add method to DB interface: `markRawListingProcessed(rawId: number): Promise<void>`
- [ ] Implementation uses UPDATE with datetime('now')
- [ ] Atomic single-row update

**Code:**
```typescript
async markRawListingProcessed(rawId: number): Promise<void> {
  await d1.prepare(
    'UPDATE listings_raw SET processed_at = datetime(\'now\') WHERE id = ?'
  ).bind(rawId).run();
}
```

**Verification:**
- [ ] TypeScript compiles
- [ ] Method added to both interface and implementation

---

#### Task 2.3: Add worker state methods
**File:** `packages/db/src/queries.ts`
**Dependencies:** Task 1.2
**Estimated Lines:** 35

**Acceptance Criteria:**
- [ ] Add `getWorkerState(workerName: string): Promise<{ lastRunAt: string | null }>` to DB interface
- [ ] Add `updateWorkerState(workerName: string, lastRunAt: string, status: 'ok' | 'error', error?: string): Promise<void>` to DB interface
- [ ] getWorkerState returns null for lastRunAt if no record exists
- [ ] updateWorkerState uses INSERT ... ON CONFLICT DO UPDATE
- [ ] Both methods implemented in createDB

**Verification:**
- [ ] TypeScript compiles
- [ ] Methods added to both interface and implementation

---

### Phase 3: Processor Worker Updates

#### Task 3.1: Update processor pipeline to mark processed items
**File:** `apps/processor/src/pipeline.ts`
**Dependencies:** Task 2.2
**Estimated Lines:** 3 (addition)

**Acceptance Criteria:**
- [ ] After successful `await db.upsertListing(listingRow)`, call `await db.markRawListingProcessed(raw.id)`
- [ ] Placement: immediately after line 101, before `result.processed++`
- [ ] Error handling: if upsertListing throws, markRawListingProcessed is NOT called (existing try/catch)

**Code change (around line 101):**
```typescript
await db.upsertListing(listingRow);
await db.markRawListingProcessed(raw.id);  // NEW LINE
result.processed++;
```

**Verification:**
- [ ] TypeScript compiles
- [ ] Processor worker builds successfully
- [ ] Logic: successful upsert → mark processed, failed upsert → don't mark

---

### Phase 4: Notification Service Updates

#### Task 4.1: Update notification service to use cursor-based processing
**File:** `apps/notify/src/notification-service.ts`
**Dependencies:** Task 2.3
**Estimated Lines:** 20 (net +15)

**Acceptance Criteria:**
- [ ] At start of `processNotifications`, get last run time via `await this.db.getWorkerState('notify')`
- [ ] Use `state.lastRunAt ?? 24-hour-fallback` as `since` parameter
- [ ] Store current run time: `const currentRunTime = new Date().toISOString()`
- [ ] After successful processing (end of method), call `await this.db.updateWorkerState('notify', currentRunTime, 'ok')`
- [ ] On early return (no filters or no listings), still update worker state
- [ ] If method throws error, state is NOT updated (cursor preserved for retry)

**Key changes:**
```typescript
async processNotifications(): Promise<NotificationResult> {
  const result: NotificationResult = { sent: 0, failed: 0, skipped: 0, errors: [] };

  // NEW: Get last run time
  const state = await this.db.getWorkerState('notify');
  const since = state.lastRunAt ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const currentRunTime = new Date().toISOString();

  const filtersWithUsers = await this.db.getActiveFilters();
  console.log(JSON.stringify({ event: 'notify_start', activeFilters: filtersWithUsers.length, since }));

  if (filtersWithUsers.length === 0) {
    await this.db.updateWorkerState('notify', currentRunTime, 'ok'); // NEW
    return result;
  }

  const recentListings = await this.db.getNewListingsSince(since);

  if (recentListings.length === 0) {
    await this.db.updateWorkerState('notify', currentRunTime, 'ok'); // NEW
    return result;
  }

  // ... existing processing logic ...

  // NEW: Update state at end
  await this.db.updateWorkerState('notify', currentRunTime, 'ok');
  console.log(JSON.stringify({ event: 'notify_complete', ...result }));
  return result;
}
```

**Verification:**
- [ ] TypeScript compiles
- [ ] Notify worker builds successfully
- [ ] State updated on success, not updated on error

---

### Phase 5: Testing & Verification

#### Task 5.1: Run migration locally
**Dependencies:** Task 1.1
**Commands:**
```bash
wrangler d1 migrations apply DB --local --config wrangler.migrations.json
```

**Acceptance Criteria:**
- [ ] Migration runs without errors
- [ ] `listings_raw` table has `processed_at` column
- [ ] Partial index `idx_listings_raw_processed` exists
- [ ] `worker_state` table exists
- [ ] Existing data backfilled (processed_at set for rows with matching listings)

**Verification:**
```bash
sqlite3 .wrangler/state/v3/d1/miniflare-D1DatabaseObject/db.sqlite << EOF
PRAGMA table_info(listings_raw);
PRAGMA table_info(worker_state);
SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%';
SELECT COUNT(*) as total, COUNT(processed_at) as processed FROM listings_raw;
EOF
```

---

#### Task 5.2: Build all packages
**Dependencies:** Tasks 1.2, 2.1, 2.2, 2.3, 3.1, 4.1
**Commands:**
```bash
pnpm build
```

**Acceptance Criteria:**
- [ ] All packages build without TypeScript errors
- [ ] No type mismatches
- [ ] All workers compile successfully

---

#### Task 5.3: Manual integration test - Processor idempotency
**Dependencies:** Task 5.1, 5.2
**Commands:**
```bash
# Run collector to get fresh data
pnpm --filter @rentifier/collector dev

# In separate terminal, trigger processor
curl http://localhost:8787/__scheduled

# Check processed count
sqlite3 .wrangler/state/v3/d1/miniflare-D1DatabaseObject/db.sqlite \
  "SELECT COUNT(*) FROM listings_raw WHERE processed_at IS NOT NULL;"

# Run processor AGAIN
curl http://localhost:8787/__scheduled

# Verify count unchanged (no re-processing)
sqlite3 .wrangler/state/v3/d1/miniflare-D1DatabaseObject/db.sqlite \
  "SELECT COUNT(*) FROM listings_raw WHERE processed_at IS NOT NULL;"
```

**Acceptance Criteria:**
- [ ] First processor run: processes N items (N > 0)
- [ ] Second processor run: processes 0 items (all already marked processed)
- [ ] Logs show "unprocessedCount: 0" on second run
- [ ] Zero duplicates in `listings` table

---

#### Task 5.4: Manual integration test - Notification idempotency
**Dependencies:** Task 5.3
**Commands:**
```bash
# Start notify worker
pnpm --filter @rentifier/notify dev

# Trigger notify
curl http://localhost:8788/__scheduled

# Check sent count
sqlite3 .wrangler/state/v3/d1/miniflare-D1DatabaseObject/db.sqlite \
  "SELECT COUNT(*) FROM notifications_sent;"

# Trigger notify AGAIN
curl http://localhost:8788/__scheduled

# Verify count unchanged (no duplicate notifications)
sqlite3 .wrangler/state/v3/d1/miniflare-D1DatabaseObject/db.sqlite \
  "SELECT COUNT(*) FROM notifications_sent;"
```

**Acceptance Criteria:**
- [ ] First notify run: sends N notifications (N > 0 if listings exist)
- [ ] Second notify run: sends 0 notifications (all already sent)
- [ ] Logs show notification skipped due to `alreadySent` check
- [ ] `worker_state` table has entry for 'notify' with recent last_run_at

---

#### Task 5.5: Verify worker_state tracking
**Dependencies:** Task 5.4

**Commands:**
```bash
sqlite3 .wrangler/state/v3/d1/miniflare-D1DatabaseObject/db.sqlite \
  "SELECT * FROM worker_state;"
```

**Acceptance Criteria:**
- [ ] worker_state contains 'notify' entry
- [ ] last_run_at is recent timestamp (within last minute)
- [ ] last_status is 'ok'
- [ ] last_error is NULL

---

#### Task 5.6: End-to-end smoke test
**Dependencies:** Task 5.5
**Scenario:** Full pipeline from collector → processor → notify

**Commands:**
```bash
# 1. Clear database
rm -rf .wrangler/state/v3/d1/miniflare-D1DatabaseObject/db.sqlite
wrangler d1 migrations apply DB --local --config wrangler.migrations.json

# 2. Seed test user and filter
sqlite3 .wrangler/state/v3/d1/miniflare-D1DatabaseObject/db.sqlite << EOF
INSERT INTO users (telegram_chat_id, display_name) VALUES ('123456', 'Test User');
INSERT INTO filters (user_id, name, min_price, max_price, enabled)
  VALUES (1, 'Test Filter', 1000, 5000, 1);
EOF

# 3. Run collector
pnpm --filter @rentifier/collector dev
# Trigger: curl http://localhost:8786/__scheduled

# 4. Run processor
pnpm --filter @rentifier/processor dev
# Trigger: curl http://localhost:8787/__scheduled

# 5. Run notify
pnpm --filter @rentifier/notify dev
# Trigger: curl http://localhost:8788/__scheduled

# 6. Verify results
sqlite3 .wrangler/state/v3/d1/miniflare-D1DatabaseObject/db.sqlite << EOF
SELECT 'Raw Listings:', COUNT(*) FROM listings_raw;
SELECT 'Processed:', COUNT(*) FROM listings_raw WHERE processed_at IS NOT NULL;
SELECT 'Canonical Listings:', COUNT(*) FROM listings;
SELECT 'Notifications Sent:', COUNT(*) FROM notifications_sent;
SELECT 'Worker State:', * FROM worker_state;
EOF
```

**Acceptance Criteria:**
- [ ] Collector inserts raw listings
- [ ] Processor processes all raw listings (processed_at set)
- [ ] Canonical listings table populated
- [ ] Notifications sent to test user
- [ ] notifications_sent table has entries
- [ ] worker_state has 'notify' entry
- [ ] Re-running processor → 0 items processed
- [ ] Re-running notify → 0 notifications sent

---

### Phase 6: Documentation & Cleanup

#### Task 6.1: Update STATE.md with decision record
**File:** `.specs/project/STATE.md`
**Dependencies:** Task 5.6

**Acceptance Criteria:**
- [ ] Add new decision record AD-010: Processing tracking with processed_at
- [ ] Document the bug, solution, and trade-offs
- [ ] Note migration 0007 details

**Content:**
```markdown
### AD-010: Processing tracking with processed_at (2026-02-22)

**Decision:** Add explicit `processed_at` timestamp to `listings_raw` table and cursor-based notification tracking via `worker_state`.
**Reason:** The original LEFT JOIN approach for detecting unprocessed listings was fragile and led to re-processing all data on every run. Notifications were being sent multiple times due to lack of cursor tracking.
**Trade-off:** Adds complexity with worker_state table, but guarantees idempotent operations and prevents duplicate notifications.
**Impact:** Processor and notify workers are now fully idempotent. Partial index on `processed_at` improves query performance. Migration includes backfill of existing data.
```

---

#### Task 6.2: Update ROADMAP.md
**File:** `.specs/project/ROADMAP.md`
**Dependencies:** Task 6.1

**Acceptance Criteria:**
- [ ] Mark "Filter Matching Engine" (M2) as COMPLETE
- [ ] Note data duplication bug fix as part of M2

---

## Summary

**Total Tasks:** 16
**Phases:** 6
**Estimated Total Lines Changed:** ~150 lines

**Critical Path:**
1.1 → 1.2 → 2.1, 2.2, 2.3 → 3.1, 4.1 → 5.1 → 5.2 → 5.3 → 5.4 → 5.5 → 5.6 → 6.1 → 6.2

**Risk Areas:**
- Migration backfill (Task 1.1): Test on a copy of production data if available
- Worker state tracking (Task 4.1): Ensure error handling doesn't skip state updates incorrectly

**Time Estimate:**
- Phase 1-2: 1 hour (schema and DB layer)
- Phase 3-4: 30 minutes (worker updates)
- Phase 5: 1 hour (testing and verification)
- Phase 6: 15 minutes (documentation)
- **Total: ~2.5 hours**
