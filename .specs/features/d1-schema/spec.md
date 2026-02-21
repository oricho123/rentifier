# D1 Database Schema Specification

## Problem Statement

Rentifier needs persistent storage for source configuration, raw and canonical listings, user filters, and notification tracking. Cloudflare D1 (serverless SQLite) is the chosen database. The schema must support idempotent upserts, efficient querying for unprocessed items, and filter matching — all within D1's constraints (no stored procedures, limited JOIN performance, SQLite type affinity).

## Goals

- [ ] Complete SQL schema covering all M1 tables with proper constraints and indexes
- [ ] Idempotent upsert patterns via `ON CONFLICT` for listings and notifications
- [ ] Efficient queries for the three hot paths: unprocessed raw listings, filter matching, unsent notifications
- [ ] Numbered migration files that can be applied via `wrangler d1 migrations apply`

## Out of Scope

- Full-text search indexes (deferred; keyword matching via LIKE is sufficient for M1)
- Geo-spatial indexes or PostGIS-style queries
- Schema for jobs/operational logging table (optional, can add later)
- Data archival or partitioning strategy

---

## User Stories

### P1: Source Management Tables

**User Story**: As the collector worker, I need `sources` and `source_state` tables so that I can track which connectors are enabled and where each left off.

**Why P1**: Collector cannot run without knowing which sources exist and their cursor positions.

**Acceptance Criteria**:

1. WHEN a source row exists with `enabled = true` THEN the collector SHALL include it in its fetch loop
2. WHEN the collector finishes fetching from a source THEN it SHALL update `source_state.cursor` and `source_state.last_run_at`
3. WHEN a fetch fails THEN `source_state.last_status` SHALL be set to `'error'` and `source_state.last_error` SHALL contain the message
4. WHEN I query sources THEN `source_state` SHALL be joinable via `source_id` foreign key

**Independent Test**: Insert a source, update its state, query back — verify fields match.

---

### P1: Raw Listings Table

**User Story**: As the collector worker, I need a `listings_raw` table to store the original payload from each source before processing.

**Why P1**: Raw storage allows reprocessing if extraction logic changes, and decouples collection from processing.

**Acceptance Criteria**:

1. WHEN the collector inserts a raw listing THEN it SHALL store `source_id`, `source_item_id`, `url`, `raw_json`, and `fetched_at`
2. WHEN the same `(source_id, source_item_id)` is inserted again THEN the insert SHALL be ignored (no duplicate, no error)
3. WHEN the processor queries for unprocessed items THEN it SHALL find raw listings not yet present in `listings` by `(source_id, source_item_id)`
4. WHEN `raw_json` is stored THEN it SHALL preserve the complete original payload as text

**Independent Test**: Insert two raw listings (one duplicate), query unprocessed — verify count is 1.

---

### P1: Canonical Listings Table

**User Story**: As the processor worker, I need a `listings` table with normalized fields so that all downstream consumers (notify, API, web) operate on a consistent schema.

**Why P1**: The canonical table is the central data asset of the entire system.

**Acceptance Criteria**:

1. WHEN a listing is upserted THEN it SHALL contain: title, description, price, currency, price_period, bedrooms, city, neighborhood, area_text, url, posted_at, ingested_at, tags_json, relevance_score
2. WHEN the same `(source_id, source_item_id)` is upserted again THEN the existing row SHALL be updated (not duplicated)
3. WHEN the notify worker queries for new listings THEN it SHALL efficiently find listings with `ingested_at > ?` using an index
4. WHEN tags_json is stored THEN it SHALL be a JSON array of string tag identifiers

**Independent Test**: Upsert a listing twice with updated price, verify only one row exists with the new price.

---

### P1: Users and Filters Tables

**User Story**: As the notify worker, I need `users` and `filters` tables so that I can match new listings against each user's saved preferences.

**Why P1**: Notifications are meaningless without filters to match against.

**Acceptance Criteria**:

1. WHEN a user is created THEN they SHALL have a unique `telegram_chat_id` and a `display_name`
2. WHEN a filter is created for a user THEN it SHALL support: min_price, max_price, min_bedrooms, max_bedrooms, cities_json, neighborhoods_json, keywords_json, must_have_tags_json, exclude_tags_json, enabled
3. WHEN a filter has `enabled = false` THEN the notify worker SHALL skip it during matching
4. WHEN a user has multiple filters THEN each SHALL be matched independently

**Independent Test**: Create a user with two filters, query filters by user_id — verify both returned.

---

### P1: Notification Tracking Table

**User Story**: As the notify worker, I need a `notifications_sent` table so that the same listing is never sent twice to the same user.

**Why P1**: Without dedup tracking, users receive duplicate messages on every notify cycle.

**Acceptance Criteria**:

1. WHEN a notification is sent THEN `(user_id, listing_id)` SHALL be inserted with `sent_at` and `channel`
2. WHEN the same `(user_id, listing_id)` is inserted again THEN the insert SHALL be ignored (unique constraint)
3. WHEN the notify worker checks for unsent matches THEN it SHALL LEFT JOIN against `notifications_sent` and filter WHERE `sent_at IS NULL`

**Independent Test**: Insert a notification record, attempt duplicate — verify no error and count stays 1.

---

### P2: Indexes for Hot Paths

**User Story**: As a developer, I want proper indexes on frequently queried columns so that the three hot-path queries (unprocessed raw, new listings, unsent notifications) execute efficiently.

**Why P2**: Critical for performance but can be tuned after the schema works.

**Acceptance Criteria**:

1. WHEN querying unprocessed raw listings THEN an index on `listings_raw(source_id, source_item_id)` SHALL speed up the anti-join
2. WHEN querying new listings since a timestamp THEN an index on `listings(ingested_at)` SHALL be used
3. WHEN matching filters THEN an index on `filters(user_id, enabled)` SHALL be used
4. WHEN checking sent notifications THEN an index on `notifications_sent(user_id, listing_id)` SHALL support the unique constraint and lookups

**Independent Test**: Run `EXPLAIN QUERY PLAN` on each hot-path query — verify index usage.

---

## Edge Cases

- WHEN D1 enforces a row size limit THEN `raw_json` and `description` columns SHALL use TEXT (no artificial length limits)
- WHEN `posted_at` is not available from a source THEN it SHALL be nullable and not block insertion
- WHEN `price` cannot be extracted THEN it SHALL be nullable (some listings are "call for price")
- WHEN a source is disabled while raw listings exist unprocessed THEN the processor SHALL still process them (source_state is separate from listings_raw)

---

## Success Criteria

- [ ] All migrations apply cleanly via `wrangler d1 migrations apply`
- [ ] All tables have proper foreign keys and unique constraints
- [ ] Upserts are idempotent (running the same insert twice produces no error or duplicate)
- [ ] Hot-path queries execute with index scans (verified via EXPLAIN)
- [ ] Schema matches the canonical types in `@rentifier/core`
