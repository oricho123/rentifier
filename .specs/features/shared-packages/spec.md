# Shared Packages Specification

## Problem Statement

Three workers (collector, processor, notify) need to share canonical types, database access, connector interfaces, and text extraction logic. Without shared packages, this logic gets duplicated across workers and diverges over time. Each package must be independently importable and have a clear responsibility boundary.

## Goals

- [ ] Four shared packages (`core`, `db`, `connectors`, `extraction`) with well-defined interfaces
- [ ] All canonical types and Zod schemas live in `core` — single source of truth
- [ ] Connector interface is generic enough to support any future source without modification
- [ ] Extraction pipeline is decoupled from any specific data source

## Out of Scope

- Concrete connector implementations (YAD2, Facebook, etc.)
- AI/LLM integration in extraction (deferred; only rule-based in M1)
- Web/API-specific types (deferred to notify worker or web UI)

---

## User Stories

### P1: Core Types and Schemas

**User Story**: As a developer, I want a single `@rentifier/core` package with all canonical types and validation schemas so that every worker operates on the same data contracts.

**Why P1**: Every other package and worker depends on these types.

**Acceptance Criteria**:

1. WHEN I import `Listing` from `@rentifier/core` THEN it SHALL include all canonical fields (id, sourceId, title, description, price, currency, pricePeriod, bedrooms, city, neighborhood, tags, url, postedAt, ingestedAt)
2. WHEN I import `ListingCandidate` THEN it SHALL represent a raw, pre-normalized listing from any source
3. WHEN I import `Filter` THEN it SHALL include match criteria (minPrice, maxPrice, minBedrooms, maxBedrooms, cities, neighborhoods, keywords, mustHaveTags, excludeTags)
4. WHEN I validate a listing with the Zod schema THEN invalid data (e.g., negative price, missing title) SHALL be rejected with descriptive errors
5. WHEN I import shared constants (supported cities, tag enums, currency codes) THEN they SHALL be typed and exhaustive

**Independent Test**: Import all types in a test file, create valid/invalid objects, verify Zod parse/safeParse results.

---

### P1: Database Package

**User Story**: As a developer, I want a `@rentifier/db` package with SQL migrations and typed query helpers so that all workers interact with D1 consistently.

**Why P1**: All workers read from or write to the same D1 database.

**Acceptance Criteria**:

1. WHEN I run migrations THEN all tables (sources, source_state, listings_raw, listings, users, filters, notifications_sent) SHALL be created
2. WHEN I call a query helper (e.g., `insertListing`, `findUnprocessedRaw`, `matchFilters`) THEN it SHALL accept and return typed objects (not raw SQL rows)
3. WHEN I call an upsert function THEN it SHALL use `ON CONFLICT` to avoid duplicates based on `(source_id, source_item_id)`
4. WHEN a migration is added THEN it SHALL be numbered sequentially and applied idempotently

**Independent Test**: Run migrations against a local D1 (via Wrangler), insert a listing, query it back, verify typed result.

---

### P1: Connector Interface

**User Story**: As a developer, I want a `@rentifier/connectors` package defining a generic connector interface so that adding a new source requires only implementing a single contract.

**Why P1**: The collector worker loops over connectors; the interface must exist before any concrete implementation.

**Acceptance Criteria**:

1. WHEN I implement a connector THEN I SHALL implement `fetchNew(cursor: string | null): Promise<FetchResult>` which returns `{ candidates: ListingCandidate[], nextCursor: string | null }`
2. WHEN I implement a connector THEN I SHALL implement `normalize(candidate: ListingCandidate): ListingDraft` to map source-specific fields to canonical schema
3. WHEN the connector interface is defined THEN it SHALL include `sourceId: string` and `sourceName: string` for identification
4. WHEN I create a mock connector THEN it SHALL satisfy the interface and return predictable test data
5. WHEN a connector throws during fetch THEN the error SHALL be catchable by the collector without crashing other connectors

**Independent Test**: Create a mock connector implementing the interface, call `fetchNew` and `normalize`, verify output matches `ListingCandidate` and `ListingDraft` types.

---

### P1: Extraction Package

**User Story**: As a developer, I want a `@rentifier/extraction` package with rule-based extraction functions so that raw listing text can be parsed into structured fields (price, rooms, tags) without AI.

**Why P1**: The processor worker depends on extraction to normalize raw listings.

**Acceptance Criteria**:

1. WHEN I pass Hebrew text containing "4,500 ש״ח" or "4500₪" THEN `extractPrice` SHALL return `{ amount: 4500, currency: 'ILS', period: 'month' }`
2. WHEN I pass text containing "3 חדרים" or "3br" THEN `extractBedrooms` SHALL return `3`
3. WHEN I pass text mentioning "חניה", "מרפסת", "חיות" THEN `extractTags` SHALL return the matching tag identifiers (`parking`, `balcony`, `pets`)
4. WHEN I pass text with a known neighborhood name THEN `extractLocation` SHALL return `{ city, neighborhood }` or `null` if not found
5. WHEN extraction confidence is low (ambiguous text) THEN the result SHALL include a `confidence` score below a configurable threshold
6. WHEN the extraction pipeline runs all extractors THEN it SHALL return an `ExtractionResult` combining all fields with an overall confidence

**Independent Test**: Pass sample Hebrew/English listing texts through each extractor, verify structured output matches expected values.

---

## Edge Cases

- WHEN listing text is entirely in Arabic THEN extraction SHALL gracefully return null/low-confidence rather than crash
- WHEN price includes "לשבוע" (per week) THEN `extractPrice` SHALL set `period: 'week'`
- WHEN bedrooms field says "סטודיו" THEN `extractBedrooms` SHALL return `0` (studio)
- WHEN the same listing appears from two sources THEN the DB upsert SHALL keep the first and not error
- WHEN a connector returns an empty candidate list THEN the system SHALL treat it as "no new listings" and update the cursor normally

---

## Success Criteria

- [ ] All four packages compile independently with `tsc --noEmit`
- [ ] Core Zod schemas correctly validate and reject sample data
- [ ] DB query helpers produce correct SQL and handle D1 return types
- [ ] Connector interface is implementable with a mock that passes type checks
- [ ] Extraction functions correctly parse 10+ sample Hebrew/English listing texts
