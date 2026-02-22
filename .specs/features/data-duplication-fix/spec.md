# Data Duplication Bug Fix

**Feature:** Fix processor re-processing and duplicate notification issues
**Status:** Specified
**Created:** 2026-02-22

## Problem Statement

The system currently has a critical bug where:
1. **Processor re-processes all data**: Each time the processor runs, it processes ALL items from `listings_raw`, even those already processed
2. **Duplicate notifications**: Users receive notifications for the same listings multiple times

### Root Causes

#### 1. No Explicit Processing Tracker in `listings_raw`
- Current approach uses LEFT JOIN to detect unprocessed items:
  ```sql
  SELECT lr.* FROM listings_raw lr
  LEFT JOIN listings l ON lr.source_id = l.source_id AND lr.source_item_id = l.source_item_id
  WHERE l.id IS NULL
  ```
- This is fragile and doesn't handle edge cases (data type mismatches, updates, etc.)
- No way to tell if a raw listing was processed successfully, failed, or never attempted

#### 2. `ingested_at` Semantics Are Ambiguous
- Currently `ingested_at` has dual meaning:
  - Timestamp when listing was first created in canonical table
  - Timestamp used to determine "new" listings for notifications
- The UPSERT correctly doesn't update `ingested_at` on conflict, BUT:
  - If the processor somehow creates duplicate rows (UNIQUE constraint not working)
  - Or if there's a bug causing `ingested_at` to reset
  - Notifications will be sent again

#### 3. No Idempotency Guarantee
- If the processor runs multiple times on the same data, behavior is undefined
- The notification service processes ALL listings from last 24h every time, relying solely on `notifications_sent` table for deduplication

## Requirements

### Functional Requirements

**FR-1:** Processor must process each raw listing exactly once
**FR-2:** Re-running the processor on the same data must be a no-op
**FR-3:** Notifications must be sent exactly once per (user, listing) pair
**FR-4:** The system must be resilient to processor failures (partial batches)
**FR-5:** Failed processing attempts should be distinguishable from successful ones

### Non-Functional Requirements

**NFR-1:** Changes must not require data migration of existing listings
**NFR-2:** Performance must not degrade (indexed queries)
**NFR-3:** Backward compatibility with existing queries where possible

## Acceptance Criteria

### AC-1: Explicit Processing Tracking
- [ ] `listings_raw` has a `processed_at` timestamp column (nullable)
- [ ] `processed_at` is NULL for unprocessed items
- [ ] `processed_at` is set to current timestamp when processing succeeds
- [ ] Failed processing attempts do NOT set `processed_at`

### AC-2: Clear Notification Semantics
- [ ] Only listings processed since last notify run trigger notifications
- [ ] `notifications_sent` table prevents duplicates
- [ ] Re-running notify worker on same time window is idempotent

### AC-3: Idempotent Processor
- [ ] Running processor twice on same raw data processes each item once
- [ ] Already-processed items (processed_at IS NOT NULL) are skipped
- [ ] UPSERT in listings table works correctly with UNIQUE constraint

### AC-4: Verification
- [ ] Unit tests confirm processor idempotency
- [ ] Integration test confirms no duplicate notifications
- [ ] Manual test: run collector → processor → processor → notify → notify, verify counts

## Out of Scope

- Processing retry logic for failed items (deferred to future work)
- Notification retry for failed sends (already handled by `retryable` flag)
- Historical data correction (only new data will use `processed_at`)

## Success Metrics

- **Zero duplicate notifications** when running notify worker multiple times
- **Zero re-processing** when running processor worker multiple times
- **Same performance** as current implementation (indexed queries)

## Dependencies

- Database migration to add `processed_at` column
- Update to `DB` interface and `createDB` implementation
- Update to processor pipeline logic
- Update to notify service to use last-processed-time cursor instead of ingested_at window

## Risks

**Risk:** Existing data in `listings_raw` has no `processed_at` value
**Mitigation:** Backfill processed_at for items that exist in listings table during migration

**Risk:** Notification cursor state needs persistence
**Mitigation:** Use notify worker's cron schedule (5min) as implicit cursor, or add `last_notify_run` tracking
