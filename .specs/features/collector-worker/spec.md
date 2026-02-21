# Collector Worker Specification

## Problem Statement

Rental listings appear continuously across multiple sources. The collector worker runs on a cron schedule, loops through enabled connectors, fetches new listings since the last cursor, stores raw payloads, and advances the cursor. It must be idempotent (safe to re-run), fault-tolerant (one failing connector doesn't block others), and operate within Cloudflare Workers' 10ms CPU / 30s wall-clock limits.

## Goals

- [ ] Cron-triggered Cloudflare Worker that fetches from all enabled connectors
- [ ] Stores raw payloads in `listings_raw` with dedup via unique constraint
- [ ] Maintains per-source cursor in `source_state` for incremental fetching
- [ ] Handles connector errors gracefully without crashing the entire run

## Out of Scope

- Implementing any specific connector (collector uses the generic interface from `@rentifier/connectors`)
- Processing or normalizing listings (that's the processor worker's job)
- Rate limiting or backoff logic beyond basic error handling (can refine in M2)
- Alerting or monitoring when all connectors fail

---

## User Stories

### P1: Scheduled Cron Execution

**User Story**: As the system, I want the collector to run on a cron schedule (every 30 minutes) so that new listings are fetched automatically without manual intervention.

**Why P1**: The entire pipeline starts with scheduled collection.

**Acceptance Criteria**:

1. WHEN the cron trigger fires THEN the collector SHALL query `sources` for all rows with `enabled = true`
2. WHEN no enabled sources exist THEN the collector SHALL log a warning and exit cleanly (no error)
3. WHEN the worker runs THEN it SHALL complete within Cloudflare's wall-clock timeout (30s on free tier)

**Independent Test**: Trigger the worker via `wrangler dev` with a mock source — verify it runs and exits.

---

### P1: Incremental Fetch Loop

**User Story**: As the collector, I want to fetch only new listings since the last cursor so that I don't re-fetch the entire source each run.

**Why P1**: Without cursors, every run fetches everything — wasteful and slow.

**Acceptance Criteria**:

1. WHEN a source has a saved cursor in `source_state` THEN `connector.fetchNew(cursor)` SHALL be called with that cursor
2. WHEN a source has no cursor (first run) THEN `connector.fetchNew(null)` SHALL be called to get the initial batch
3. WHEN the connector returns `nextCursor` THEN `source_state.cursor` SHALL be updated to that value
4. WHEN the connector returns candidates THEN each SHALL be inserted into `listings_raw` with `source_id` and `source_item_id`
5. WHEN a candidate's `(source_id, source_item_id)` already exists in `listings_raw` THEN the insert SHALL be silently skipped

**Independent Test**: Run collector twice with the same mock data — verify no duplicates in `listings_raw` and cursor advanced.

---

### P1: Error Isolation Per Connector

**User Story**: As the collector, I want each connector's fetch to be wrapped in error handling so that one failing source doesn't prevent others from running.

**Why P1**: A single flaky API should not block the entire collection cycle.

**Acceptance Criteria**:

1. WHEN a connector throws during `fetchNew` THEN the collector SHALL catch the error and continue to the next connector
2. WHEN a connector fails THEN `source_state.last_status` SHALL be set to `'error'` and `source_state.last_error` SHALL contain the error message
3. WHEN a connector succeeds THEN `source_state.last_status` SHALL be set to `'ok'` and `source_state.last_error` SHALL be null
4. WHEN all connectors are processed THEN `source_state.last_run_at` SHALL be updated for each (success or failure)

**Independent Test**: Register two mock connectors (one throws, one succeeds) — verify the second still runs and both states are updated correctly.

---

### P2: Connector Registry

**User Story**: As a developer, I want a simple registry that maps source IDs to connector instances so that the collector can dynamically loop over them.

**Why P2**: Needed for the loop but could be a simple map initially.

**Acceptance Criteria**:

1. WHEN the collector starts THEN it SHALL load enabled sources from the `sources` table
2. WHEN a source's `name` matches a registered connector THEN that connector SHALL be instantiated
3. WHEN a source's `name` has no registered connector THEN the collector SHALL log a warning and skip it

**Independent Test**: Register a mock connector, add a source row with matching name — verify it's picked up.

---

## Edge Cases

- WHEN the cron fires while a previous run is still executing THEN Cloudflare SHALL queue or drop the duplicate (Workers handles this; no special code needed)
- WHEN a connector returns zero candidates THEN the collector SHALL still update `last_run_at` and `last_status = 'ok'`
- WHEN the D1 batch insert exceeds 1000 items THEN the collector SHALL batch inserts (D1 has per-request row limits)
- WHEN the Worker approaches the 30s wall-clock limit THEN it SHALL stop processing remaining connectors and log which ones were skipped

---

## Success Criteria

- [ ] Worker triggers on cron and processes all enabled connectors
- [ ] Raw listings are stored with no duplicates across multiple runs
- [ ] Cursors advance correctly — subsequent runs only fetch new data
- [ ] One connector failure does not block others
- [ ] Worker completes within Cloudflare free-tier time limits
