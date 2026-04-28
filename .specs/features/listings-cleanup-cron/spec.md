# Listings Cleanup Cron Specification

## Problem Statement

D1 storage grows unbounded. Listings older than ~1 month are no longer relevant for renters (apartments are taken or relisted) yet stay in `listings`, `listings_raw`, and trail behind in `notifications_sent` and duplicate chains. On the free tier (5 GB D1 cap) we will eventually hit the ceiling, and table scans (e.g. `getNewListingsSince`, `findDuplicate`) get slower the larger the canonical set is. We need an automated daily prune.

## Goals

- [ ] Delete canonical `listings` rows whose effective age (`posted_at` if present, else `ingested_at`) exceeds `RETENTION_DAYS` (default 30) and cascade-clean their `notifications_sent`.
- [ ] Delete `listings_raw` rows whose `fetched_at` exceeds `RETENTION_DAYS`, regardless of processed state (raw is just history once consumed).
- [ ] Cascade-delete listings whose `duplicate_of` points to a now-removed canonical, so duplicate chains never become orphan refs to nothing.
- [ ] Defensive sweep of `notifications_sent` rows whose `listing_id` no longer exists (would be rare given FK CASCADE, but covers any pre-FK rows or edge cases).
- [ ] Run automatically once a day on Cloudflare Cron at 04:00 UTC, with batched deletes that respect D1 query limits.

## Out of Scope

- Cleaning `conversation_state` (handled separately by its `expires_at` index — different lifecycle).
- Cleaning `neighborhood_cache` (cache should persist — re-resolving costs Nominatim quota).
- Soft-delete / archival to R2 (cheap to add later; not needed for v1).
- Retention per source / per city tuning (single global retention for now).
- UI to view / manage retention.

---

## User Stories

### P1: Daily auto-prune of stale canonical listings ⭐ MVP

**User Story**: As the system operator, I want listings older than 30 days automatically removed every night so the D1 database stays well under the free-tier 5 GB limit and core queries stay fast.

**Why P1**: Storage and query-performance ceilings are the only reason this feature exists. Without P1 the project hits a hard cap.

**Acceptance Criteria**:

1. WHEN the daily cron fires at 04:00 UTC THEN the cleanup worker SHALL delete every row from `listings` where `COALESCE(posted_at, ingested_at) < datetime('now', '-' || RETENTION_DAYS || ' days')` AND `duplicate_of IS NULL`.
2. WHEN a canonical listing row is deleted THEN the FK cascade SHALL also delete its `notifications_sent` rows.
3. WHEN `RETENTION_DAYS` env var is set to a positive integer THEN the worker SHALL use that value; WHEN unset THEN the worker SHALL default to 30.
4. WHEN deletion volume is large THEN the worker SHALL execute deletes in batches of ≤500 rows per statement until none remain or a per-run cap (`MAX_DELETES_PER_RUN`, default 50,000) is reached.
5. WHEN the run completes THEN the worker SHALL log a structured summary `{ listings_deleted, listings_raw_deleted, duplicates_deleted, orphan_notifications_deleted, ms }` and update `worker_state` with `worker_name='cleanup'`.

**Independent Test**: Seed listings dated 31, 30, 29 days old; trigger scheduled handler manually via `wrangler triggers cron --test` (or local `npm run dev` + curl `/__scheduled`); assert only the 31-day row is gone and `notifications_sent` rows for it are gone too.

---

### P2: Prune `listings_raw` history & duplicate chains

**User Story**: As the system operator, I want raw payloads and duplicate-pointers to be cleaned up alongside canonical listings so we don't keep megabytes of stale `raw_json` blobs or dangling duplicate refs.

**Why P2**: Same storage motivation, but raw rows are larger (full JSON) so impact is meaningful even though they're not on the hot query path.

**Acceptance Criteria**:

1. WHEN cleanup runs THEN it SHALL delete every row from `listings_raw` where `fetched_at < datetime('now', '-' || RETENTION_DAYS || ' days')`, batched ≤500 per statement.
2. WHEN cleanup runs THEN it SHALL delete every row from `listings` where `duplicate_of IS NOT NULL` AND its referenced canonical no longer exists OR satisfies the same age cutoff (i.e. duplicates of expiring canonicals are removed in the same pass).
3. WHEN the same `(source_id, source_item_id)` exists in both raw and canonical THEN deletion of one SHALL NOT block deletion of the other (independent age checks).

**Independent Test**: Insert raw rows with `fetched_at = -31 days`, run cleanup, confirm those rows are gone and any matching listings duplicates also pruned. Verify `listings_raw` row count drops by exactly the seeded amount.

---

### P3: Defensive orphan-notifications sweep + observability

**User Story**: As the system operator, I want to be confident that no `notifications_sent` rows ever point to a missing listing (defensive cleanup) and to see a tail of recent cleanup runs in `worker_state` for ops debugging.

**Why P3**: FK CASCADE should already handle this. The defensive sweep is cheap insurance against historical pre-FK rows or any future direct-DELETE that bypasses cascade. Observability is operations hygiene.

**Acceptance Criteria**:

1. WHEN cleanup runs THEN it SHALL `DELETE FROM notifications_sent WHERE listing_id NOT IN (SELECT id FROM listings)` and report the count in the run summary.
2. WHEN the run completes successfully THEN `worker_state.worker_name='cleanup'` SHALL be upserted with `last_run_at = now`, `last_status='ok'`, `last_error=NULL`.
3. WHEN the run throws or any batch fails THEN `worker_state` SHALL be updated with `last_status='error'` and `last_error` containing the message, and the worker SHALL `console.error` and re-throw so Cloudflare records the failure.

**Independent Test**: Manually `INSERT INTO notifications_sent (user_id, listing_id, ...) VALUES (1, 999999, ...)` against a non-existent listing; run cleanup; verify the row is gone. Inspect `worker_state` after run — `last_run_at` updated.

---

## Edge Cases

- WHEN `listings` table is empty THEN cleanup SHALL no-op (zero deletes, success status).
- WHEN cron fires while a previous invocation is still running (overlap) THEN the second invocation SHALL still run independently (D1 deletes are idempotent — `DELETE WHERE` against already-deleted rows is a no-op). No locking required for v1.
- WHEN `MAX_DELETES_PER_RUN` is reached THEN the worker SHALL stop the loop, log `{capped: true, remaining_estimate}` based on a follow-up `COUNT(*)`, and rely on the next day's run to continue. Tomorrow's threshold moves another day forward, so backlog catches up exponentially.
- WHEN `posted_at` is malformed / not ISO-8601 THEN `datetime()` returns NULL, COALESCE falls through to `ingested_at` which is always set by `DEFAULT (datetime('now'))` — safe.
- WHEN a duplicate listing's canonical is deleted in the same run as the duplicate THEN deletion order SHALL be: duplicates first (by canonical age cutoff), then canonicals — avoids momentary FK ref to deleted row. Practically D1 enforces FK only on `INSERT`/`UPDATE` of `duplicate_of`, not on canonical delete (no FK declared back from canonical to duplicates), so order is for correctness, not constraint.
- WHEN cleanup is invoked outside the cron (e.g. via dev `wrangler dev` HTTP `/__scheduled` endpoint) THEN it SHALL behave identically.

---

## Success Criteria

- [ ] After 7 consecutive nightly runs in production, `listings` row count plateaus at roughly the steady-state ingestion rate × 30 days, instead of growing linearly.
- [ ] Cleanup run completes in under 30 seconds wall-clock for a backlog of ≤50k rows (free-tier CPU budget headroom).
- [ ] Zero P0 failures (worker always exits with `last_status='ok'` unless D1 itself is down).
- [ ] No regressions in `getNewListingsSince` / `findDuplicate` / `matchesFilter` semantics — only stale rows disappear, fresh rows untouched.
- [ ] No accidental deletion of in-flight raw rows (the `processed_at IS NULL` set inside the retention window).
