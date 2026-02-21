# Processor Worker Specification

## Problem Statement

Raw listings stored by the collector are unstructured source-specific payloads. The processor worker reads unprocessed raw listings, runs them through the connector's normalizer and the extraction pipeline, deduplicates against existing canonical listings, and upserts the result into the `listings` table. It bridges raw ingestion and user-facing data.

## Goals

- [ ] Cron-triggered worker that processes all unprocessed raw listings
- [ ] Normalizes each raw listing via its source connector's `normalize` function
- [ ] Runs the extraction pipeline to fill structured fields (price, rooms, tags, location)
- [ ] Deduplicates and upserts into canonical `listings` table
- [ ] Operates within Cloudflare Workers constraints

## Out of Scope

- AI/LLM-based extraction (M1 uses rules only; AI fallback deferred)
- Cross-source deduplication (matching the same apartment from YAD2 and Facebook — deferred to M4)
- Relevance scoring beyond basic is_relevant flag
- Image processing or attachment handling

---

## User Stories

### P1: Process Unprocessed Raw Listings

**User Story**: As the processor, I want to find all raw listings not yet in the canonical `listings` table so that I only process new items.

**Why P1**: The core job of the processor is to move raw data into canonical form.

**Acceptance Criteria**:

1. WHEN the processor runs THEN it SHALL query `listings_raw` for rows where `(source_id, source_item_id)` is NOT in `listings`
2. WHEN there are no unprocessed raw listings THEN the processor SHALL exit cleanly with no errors
3. WHEN there are unprocessed listings THEN the processor SHALL process them in batches (configurable, default 50)

**Independent Test**: Insert 3 raw listings, process — verify 3 canonical listings created. Run again — verify 0 processed.

---

### P1: Normalize via Connector

**User Story**: As the processor, I want to call the source connector's `normalize` function on each raw listing so that source-specific fields are mapped to the canonical schema.

**Why P1**: Each source has different field names and formats; normalization is required before extraction.

**Acceptance Criteria**:

1. WHEN a raw listing's `source_id` maps to a known connector THEN `connector.normalize(candidate)` SHALL be called
2. WHEN normalization succeeds THEN the result SHALL be a `ListingDraft` with at minimum: title, description, url, source_id, source_item_id
3. WHEN normalization fails (bad data) THEN the processor SHALL log the error and skip that listing (not crash)
4. WHEN a raw listing's `source_id` has no registered connector THEN the processor SHALL skip it with a warning

**Independent Test**: Create a mock connector with a normalize function, pass raw data — verify `ListingDraft` output.

---

### P1: Run Extraction Pipeline

**User Story**: As the processor, I want to run rule-based extraction on each normalized listing to fill price, bedrooms, tags, and location fields.

**Why P1**: Users filter on these fields — they must be extracted before notification matching works.

**Acceptance Criteria**:

1. WHEN a `ListingDraft` is passed to the extraction pipeline THEN it SHALL attempt to extract: price (amount + currency + period), bedrooms, tags, and location (city + neighborhood)
2. WHEN extraction finds a price THEN it SHALL populate `price`, `currency`, and `price_period` on the listing
3. WHEN extraction finds tags THEN `tags_json` SHALL be a JSON array of matched tag identifiers
4. WHEN extraction confidence is below threshold for any field THEN that field SHALL remain null (not guessed)
5. WHEN extraction completes THEN an overall `relevance_score` SHALL be computed (e.g., higher when more fields are successfully extracted)

**Independent Test**: Pass sample listing texts, verify extracted fields match expected values.

---

### P1: Upsert Canonical Listings

**User Story**: As the processor, I want to upsert into the `listings` table so that reprocessing the same raw listing updates rather than duplicates.

**Why P1**: Idempotency is a core design requirement.

**Acceptance Criteria**:

1. WHEN a listing is upserted THEN it SHALL use `INSERT ... ON CONFLICT(source_id, source_item_id) DO UPDATE`
2. WHEN a conflict occurs THEN all extracted fields SHALL be updated to the latest values
3. WHEN a listing is inserted for the first time THEN `ingested_at` SHALL be set to the current timestamp
4. WHEN a listing is updated (conflict) THEN `ingested_at` SHALL NOT change (preserve original ingestion time)

**Independent Test**: Insert a listing, then upsert with a different price — verify one row with the new price and original `ingested_at`.

---

### P2: Batch Processing with Limits

**User Story**: As the processor, I want to process raw listings in batches so that I stay within Cloudflare's CPU and wall-clock limits.

**Why P2**: Important for reliability but the system works with small batches initially.

**Acceptance Criteria**:

1. WHEN there are more unprocessed listings than the batch size THEN the processor SHALL process only one batch per cron invocation
2. WHEN a batch is completed THEN the next cron run SHALL pick up where this one left off (since processed items are now in `listings`)
3. WHEN the batch size is configurable THEN it SHALL default to 50

**Independent Test**: Insert 120 raw listings, run processor once — verify 50 processed. Run again — verify next 50.

---

## Edge Cases

- WHEN `raw_json` is malformed (not valid JSON) THEN the processor SHALL log the error and skip that row
- WHEN a listing has no extractable price THEN `price` SHALL be null (not 0)
- WHEN the same listing is collected from two different connectors THEN each SHALL create separate canonical rows (cross-source dedup is out of scope for M1)
- WHEN the processor is interrupted mid-batch THEN re-running SHALL safely re-process unfinished items (idempotent upsert)

---

## Success Criteria

- [ ] All unprocessed raw listings are normalized and upserted into `listings`
- [ ] Extraction correctly populates price, rooms, tags, location from Hebrew/English text
- [ ] Reprocessing the same data produces no duplicates and updates existing rows
- [ ] Processing completes within Cloudflare Workers time limits
- [ ] Errors in one listing do not block processing of others
