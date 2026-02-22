# Design: Data Duplication Bug Fix

**Feature:** Fix processor re-processing and duplicate notification issues
**Status:** Design
**Created:** 2026-02-22

## Solution Overview

Add explicit processing tracking via `processed_at` column in `listings_raw`, and refine notification query to only process listings since last notification run.

### Key Changes

1. **Database Schema**: Add `processed_at` column to `listings_raw` table
2. **Processor Query**: Select only rows where `processed_at IS NULL`
3. **Processor Logic**: Mark `processed_at` after successful upsert to `listings`
4. **Notification Query**: Track last notification run time, query only listings processed since then
5. **Notification State**: Persist last notification run timestamp

## Database Schema Changes

### Migration 0007: Add processed_at tracking

```sql
-- Add processed_at column to listings_raw
ALTER TABLE listings_raw ADD COLUMN processed_at TEXT;

-- Backfill: Mark existing raw listings as processed if they exist in listings
UPDATE listings_raw
SET processed_at = datetime('now')
WHERE EXISTS (
  SELECT 1 FROM listings l
  WHERE l.source_id = listings_raw.source_id
    AND l.source_item_id = listings_raw.source_item_id
);

-- Create index for efficient unprocessed lookup
CREATE INDEX idx_listings_raw_processed ON listings_raw(processed_at)
WHERE processed_at IS NULL;
```

**Rationale:**
- `processed_at` is NULL for unprocessed items, timestamped when processed
- Backfill ensures existing data doesn't get reprocessed
- Partial index on NULL values optimizes the common query (unprocessed items)

### Schema Updates

**Update `ListingRaw` interface:**

```typescript
export interface ListingRaw {
  id: number;
  source_id: number;
  source_item_id: string;
  url: string;
  raw_json: string;
  fetched_at: string;
  processed_at: string | null;  // NEW
}
```

## Processor Changes

### Updated Query: `getUnprocessedRawListings`

**Before:**
```typescript
async getUnprocessedRawListings(limit: number): Promise<ListingRaw[]> {
  const result = await d1.prepare(
    `SELECT lr.* FROM listings_raw lr
     LEFT JOIN listings l ON lr.source_id = l.source_id AND lr.source_item_id = l.source_item_id
     WHERE l.id IS NULL
     LIMIT ?`
  ).bind(limit).all<ListingRaw>();
  return result.results;
}
```

**After:**
```typescript
async getUnprocessedRawListings(limit: number): Promise<ListingRaw[]> {
  const result = await d1.prepare(
    `SELECT * FROM listings_raw
     WHERE processed_at IS NULL
     ORDER BY fetched_at ASC
     LIMIT ?`
  ).bind(limit).all<ListingRaw>();
  return result.results;
}
```

**Rationale:**
- Simpler query, no JOIN required
- Explicit NULL check is deterministic
- ORDER BY fetched_at ensures FIFO processing
- Uses partial index for performance

### New Method: `markRawListingProcessed`

```typescript
async markRawListingProcessed(rawId: number): Promise<void> {
  await d1.prepare(
    'UPDATE listings_raw SET processed_at = datetime(\'now\') WHERE id = ?'
  ).bind(rawId).run();
}
```

**Rationale:**
- Atomic operation to mark processing complete
- Called immediately after successful `upsertListing`

### Updated Pipeline Logic

**File:** `apps/processor/src/pipeline.ts`

**Changes:**
```typescript
// After line 101: await db.upsertListing(listingRow);
await db.markRawListingProcessed(raw.id);
result.processed++;
```

**Error Handling:**
- If `upsertListing` throws, `markRawListingProcessed` is NOT called
- Raw listing remains unprocessed (processed_at = NULL)
- Next processor run will retry

## Notification Service Changes

### Problem with Current Approach

The current query gets ALL listings from last 24 hours:
```typescript
const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
const recentListings = await this.db.getNewListingsSince(since);
```

**Issues:**
- If notify runs every 5 minutes, it processes the same listings 288 times per day
- Relies entirely on `notifications_sent` deduplication
- Wastes CPU checking already-notified listings

### Solution: Notification Cursor

**Option A: Use `processed_at` from listings_raw** (REJECTED)
- Would need to join `listings` back to `listings_raw`
- Adds complexity

**Option B: Add `last_notify_run` to notify worker state** (CHOSEN)
- Store last successful run timestamp in KV or D1 state table
- Query listings where `ingested_at > last_notify_run`
- Much smaller result set (only new listings since last run)

### Implementation: State Table

**Migration 0007 (continued):**
```sql
-- Worker state tracking
CREATE TABLE worker_state (
  worker_name TEXT PRIMARY KEY,
  last_run_at TEXT NOT NULL,
  last_status TEXT CHECK(last_status IN ('ok', 'error')),
  last_error TEXT
);
```

### New DB Methods

```typescript
async getWorkerState(workerName: string): Promise<{ lastRunAt: string | null }> {
  const result = await d1.prepare(
    'SELECT last_run_at FROM worker_state WHERE worker_name = ?'
  ).bind(workerName).first<{ last_run_at: string }>();
  return { lastRunAt: result?.last_run_at ?? null };
}

async updateWorkerState(
  workerName: string,
  lastRunAt: string,
  status: 'ok' | 'error',
  error?: string
): Promise<void> {
  await d1.prepare(
    `INSERT INTO worker_state (worker_name, last_run_at, last_status, last_error)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(worker_name) DO UPDATE SET
       last_run_at = excluded.last_run_at,
       last_status = excluded.last_status,
       last_error = excluded.last_error`
  ).bind(workerName, lastRunAt, status, error ?? null).run();
}
```

### Updated Notification Service

**File:** `apps/notify/src/notification-service.ts`

**Before:**
```typescript
async processNotifications(): Promise<NotificationResult> {
  // ...
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const recentListings = await this.db.getNewListingsSince(since);
  // ...
}
```

**After:**
```typescript
async processNotifications(): Promise<NotificationResult> {
  const result: NotificationResult = { sent: 0, failed: 0, skipped: 0, errors: [] };

  // Get last notification run timestamp
  const state = await this.db.getWorkerState('notify');
  const since = state.lastRunAt ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const currentRunTime = new Date().toISOString();

  const filtersWithUsers = await this.db.getActiveFilters();
  console.log(JSON.stringify({ event: 'notify_start', activeFilters: filtersWithUsers.length, since }));

  if (filtersWithUsers.length === 0) {
    await this.db.updateWorkerState('notify', currentRunTime, 'ok');
    return result;
  }

  const recentListings = await this.db.getNewListingsSince(since);

  if (recentListings.length === 0) {
    await this.db.updateWorkerState('notify', currentRunTime, 'ok');
    return result;
  }

  // ... rest of processing logic ...

  // Update state at the end
  await this.db.updateWorkerState('notify', currentRunTime, 'ok');
  console.log(JSON.stringify({ event: 'notify_complete', ...result }));
  return result;
}
```

**Rationale:**
- First run (no state): defaults to last 24 hours (safe fallback)
- Subsequent runs: only process listings since last successful run
- State updated AFTER successful processing
- If worker fails mid-run, next run will retry from same cursor (at-least-once delivery)

## Error Handling & Edge Cases

### Processor Failures

**Scenario:** Processor fails after processing 30/50 items in a batch

**Behavior:**
- Items 1-30: `processed_at` set, won't be reprocessed
- Items 31-50: `processed_at` NULL, will be retried next run
- Partial progress is preserved

### Notification Failures

**Scenario:** Notify worker fails after sending 10/20 notifications

**Behavior:**
- `worker_state.last_run_at` NOT updated (still points to previous successful run)
- Next run: same 20 listings queried again
- Items 1-10: already in `notifications_sent`, skipped
- Items 11-20: sent successfully
- State updated after all sent

### Duplicate Upserts

**Scenario:** Same listing processed twice (should be impossible with `processed_at`, but defensive check)

**Behavior:**
- First process: UPSERT creates row, sets `ingested_at`
- Second process: UPSERT does UPDATE, `ingested_at` unchanged (NOT in UPDATE clause)
- Notifications: query based on `ingested_at`, so no duplicate notification

## Performance Considerations

### Queries Before & After

**Processor - Before:**
```sql
SELECT lr.* FROM listings_raw lr
LEFT JOIN listings l ON lr.source_id = l.source_id AND lr.source_item_id = l.source_item_id
WHERE l.id IS NULL
LIMIT 50
```
- Full table scan of listings_raw
- JOIN to listings table
- No index utilization

**Processor - After:**
```sql
SELECT * FROM listings_raw
WHERE processed_at IS NULL
ORDER BY fetched_at ASC
LIMIT 50
```
- Uses partial index `idx_listings_raw_processed`
- No JOIN required
- Direct index scan

**Notification - Before:**
- Queries all listings from last 24h every 5 minutes
- 288 queries/day, each processing ~hundreds of rows
- Heavy reliance on notifications_sent deduplication

**Notification - After:**
- Queries only listings since last run (5 min window)
- 288 queries/day, each processing ~0-10 rows (depending on ingestion rate)
- Minimal deduplication checks

### Index Strategy

```sql
-- Existing indexes (from migration 0002)
CREATE INDEX idx_listings_raw_source ON listings_raw(source_id, source_item_id);
CREATE INDEX idx_listings_source ON listings(source_id, source_item_id);
CREATE INDEX idx_listings_ingested ON listings(ingested_at DESC);
CREATE INDEX idx_notifications_sent ON notifications_sent(user_id, listing_id);

-- New index (migration 0007)
CREATE INDEX idx_listings_raw_processed ON listings_raw(processed_at) WHERE processed_at IS NULL;
```

## Testing Strategy

### Unit Tests

**Test: Processor idempotency**
```typescript
test('processor does not reprocess marked items', async () => {
  // Setup: 3 raw listings, 1 already processed
  await db.insertRawListings([...]);
  await db.markRawListingProcessed(1);

  // Run processor
  const result = await processBatch(db, 50);

  // Assert: only 2 items processed
  expect(result.processed).toBe(2);
});
```

**Test: Notification cursor**
```typescript
test('notifications only process new listings', async () => {
  // Setup: insert 5 listings at T0
  await db.upsertListing([...]);

  // Run notify at T1, update state
  await service.processNotifications();
  const sentCount1 = await db.countNotificationsSent();

  // Insert 3 more listings at T2
  await db.upsertListing([...]);

  // Run notify at T3
  await service.processNotifications();
  const sentCount2 = await db.countNotificationsSent();

  // Assert: only 3 new notifications sent
  expect(sentCount2 - sentCount1).toBe(3);
});
```

### Integration Test

**Manual verification steps:**
1. Clear database
2. Run collector (inserts 10 raw listings)
3. Run processor (processes 10, marks all as processed)
4. Run processor again (processes 0, no duplicates)
5. Run notify (sends 10 notifications)
6. Run notify again (sends 0, no duplicates)
7. Verify: 10 rows in listings_raw with processed_at set
8. Verify: 10 rows in listings with unique ingested_at
9. Verify: 10 rows in notifications_sent

## Files Changed

### New Files
- `packages/db/migrations/0007_processing_tracking.sql` (migration)

### Modified Files
- `packages/db/src/schema.ts` (add processed_at to ListingRaw)
- `packages/db/src/queries.ts` (update getUnprocessedRawListings, add markRawListingProcessed, add worker state methods)
- `apps/processor/src/pipeline.ts` (call markRawListingProcessed after upsert)
- `apps/notify/src/notification-service.ts` (cursor-based notification processing)

## Rollout Plan

1. **Deploy migration 0007** to D1 (local and remote)
2. **Deploy updated code** (processor + notify workers)
3. **Verify** via logs and manual testing
4. **Monitor** for 24h to ensure no regressions

## Rollback Plan

If issues arise:
1. Revert code deployment
2. Migration is backward compatible (old code ignores processed_at column)
3. No data loss - can re-run with old logic

## Open Questions

**Q:** Should we add retry logic for failed processing attempts?
**A:** Out of scope for this fix. Current behavior (leave processed_at NULL) is acceptable. Future work can add a `process_attempts` counter.

**Q:** What if worker_state gets out of sync?
**A:** notifications_sent provides final deduplication. Worst case: a few duplicate attempts that get skipped. Can manually reset worker_state if needed.

**Q:** Should we cleanup old processed listings_raw?
**A:** Separate concern. Could add a cleanup job to delete listings_raw older than 30 days. Not part of this fix.
