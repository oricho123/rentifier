# Shared Packages - Task Breakdown

## Overview
This document breaks down the shared packages implementation into atomic, executable tasks. Each task is one file, one interface, or one function.

---

## Tasks

### T1: Create core types file [P]

**What**: Define canonical TypeScript interfaces for all domain entities
**Where**: `packages/core/src/types.ts`
**Depends on**: None
**Done when**:
- [ ] Listing, ListingCandidate, ListingDraft, Filter interfaces are defined
- [ ] All fields match the design spec exactly
- [ ] File exports all interfaces
**Verify**: `cat packages/core/src/types.ts | grep -E "(interface Listing|interface Filter)"`

---

### T2: Create core constants file [P]

**What**: Define supported cities, tags, currencies, and price periods as typed constants
**Where**: `packages/core/src/constants.ts`
**Depends on**: None
**Done when**:
- [ ] SUPPORTED_CITIES array includes all Israeli cities
- [ ] LISTING_TAGS includes parking, balcony, pets, furnished, immediate, long-term, accessible, air-conditioning
- [ ] CURRENCIES and PRICE_PERIODS enums are defined
- [ ] Type exports (City, ListingTag, Currency, PricePeriod) are created
**Verify**: `cat packages/core/src/constants.ts | grep -E "(SUPPORTED_CITIES|LISTING_TAGS)"`

---

### T3: Create core Zod schemas file

**What**: Define runtime validation schemas for Listing, ListingCandidate, and Filter
**Where**: `packages/core/src/schemas.ts`
**Depends on**: T1
**Done when**:
- [ ] listingSchema validates all Listing fields with correct types
- [ ] listingCandidateSchema validates ListingCandidate
- [ ] filterSchema validates Filter
- [ ] All schemas use appropriate Zod validators (uuid, min, positive, enum, url, date)
**Verify**: `cat packages/core/src/schemas.ts | grep "z.object"`

---

### T4: Update core package exports

**What**: Export all types, schemas, and constants from core package index
**Where**: `packages/core/src/index.ts`
**Depends on**: T1, T2, T3
**Done when**:
- [ ] Exports all from types.ts, schemas.ts, constants.ts
**Verify**: `cat packages/core/src/index.ts | grep "export"`

---

### T5: Add zod dependency to core package

**What**: Add zod to core package dependencies
**Where**: `packages/core/package.json`
**Depends on**: None
**Done when**:
- [ ] zod is in dependencies (not devDependencies)
- [ ] Version is ^3.0.0 or latest
**Verify**: `cat packages/core/package.json | grep zod`

---

### T6: Create DB migration file [P]

**What**: SQL DDL for all tables (sources, source_state, listings_raw, listings, users, filters, notifications_sent)
**Where**: `packages/db/migrations/0001_initial.sql`
**Depends on**: None
**Done when**:
- [ ] All 7 tables created with correct schemas
- [ ] UNIQUE constraints on (source_id, source_item_id) in listings_raw and listings
- [ ] Foreign key constraints defined
- [ ] Indexes created for listings_raw.processed, listings.ingested_at, notifications_sent
**Verify**: `cat packages/db/migrations/0001_initial.sql | grep "CREATE TABLE"`

---

### T7: Create DB query interface types

**What**: Define TypeScript interface for all DB query helper methods
**Where**: `packages/db/src/queries.ts`
**Depends on**: None
**Done when**:
- [ ] DB interface includes all methods: insertRawListing, findUnprocessedRaw, markRawAsProcessed, upsertListing, findListingBySource, findRecentListings, findAllFilters, matchFilters, wasNotificationSent, recordNotification, getCursor, updateCursor
- [ ] All methods have proper type signatures
- [ ] Import types from @rentifier/core
**Verify**: `cat packages/db/src/queries.ts | grep "export interface DB"`

---

### T8: Implement insertRawListing query helper

**What**: Function to insert raw listing into listings_raw table
**Where**: `packages/db/src/queries.ts`
**Depends on**: T7
**Done when**:
- [ ] Accepts id, sourceId, sourceItemId, payload
- [ ] Handles UNIQUE constraint violations gracefully
- [ ] Returns Promise<void>
**Verify**: `cat packages/db/src/queries.ts | grep "insertRawListing"`

---

### T9: Implement findUnprocessedRaw query helper

**What**: Function to fetch unprocessed raw listings
**Where**: `packages/db/src/queries.ts`
**Depends on**: T7
**Done when**:
- [ ] Queries listings_raw WHERE processed = 0
- [ ] Accepts limit parameter
- [ ] Returns typed array with id, sourceId, payload
**Verify**: `cat packages/db/src/queries.ts | grep "findUnprocessedRaw"`

---

### T10: Implement markRawAsProcessed query helper

**What**: Function to mark raw listing as processed
**Where**: `packages/db/src/queries.ts`
**Depends on**: T7
**Done when**:
- [ ] Updates listings_raw SET processed = 1 WHERE id = ?
- [ ] Returns Promise<void>
**Verify**: `cat packages/db/src/queries.ts | grep "markRawAsProcessed"`

---

### T11: Implement upsertListing query helper

**What**: Function to insert or update canonical listing
**Where**: `packages/db/src/queries.ts`
**Depends on**: T7
**Done when**:
- [ ] Accepts ListingDraft
- [ ] Uses INSERT ... ON CONFLICT to handle duplicates
- [ ] Returns listing ID (UUID)
- [ ] Tags stored as JSON text
**Verify**: `cat packages/db/src/queries.ts | grep "upsertListing"`

---

### T12: Implement findListingBySource query helper

**What**: Function to find listing by source and source item ID
**Where**: `packages/db/src/queries.ts`
**Depends on**: T7
**Done when**:
- [ ] Queries listings WHERE source_id = ? AND source_item_id = ?
- [ ] Returns Listing | null
- [ ] Parses tags from JSON
**Verify**: `cat packages/db/src/queries.ts | grep "findListingBySource"`

---

### T13: Implement findRecentListings query helper

**What**: Function to fetch recent listings since a date
**Where**: `packages/db/src/queries.ts`
**Depends on**: T7
**Done when**:
- [ ] Queries listings WHERE ingested_at >= ? ORDER BY ingested_at DESC LIMIT ?
- [ ] Returns Listing[]
- [ ] Parses tags from JSON
**Verify**: `cat packages/db/src/queries.ts | grep "findRecentListings"`

---

### T14: Implement findAllFilters query helper

**What**: Function to fetch all user filters
**Where**: `packages/db/src/queries.ts`
**Depends on**: T7
**Done when**:
- [ ] Queries all filters
- [ ] Returns Filter[]
- [ ] Parses JSON arrays (cities, neighborhoods, keywords, tags)
**Verify**: `cat packages/db/src/queries.ts | grep "findAllFilters"`

---

### T15: Implement matchFilters query helper

**What**: Function to match a listing against all filters
**Where**: `packages/db/src/queries.ts`
**Depends on**: T7
**Done when**:
- [ ] Accepts Listing and Filter[]
- [ ] Returns Filter[] of matches
- [ ] Implements price range, bedroom range, city/neighborhood, keyword, tag logic
**Verify**: `cat packages/db/src/queries.ts | grep "matchFilters"`

---

### T16: Implement wasNotificationSent query helper

**What**: Function to check if notification was already sent
**Where**: `packages/db/src/queries.ts`
**Depends on**: T7
**Done when**:
- [ ] Queries notifications_sent WHERE user_id = ? AND listing_id = ?
- [ ] Returns boolean
**Verify**: `cat packages/db/src/queries.ts | grep "wasNotificationSent"`

---

### T17: Implement recordNotification query helper

**What**: Function to record sent notification
**Where**: `packages/db/src/queries.ts`
**Depends on**: T7
**Done when**:
- [ ] Inserts into notifications_sent
- [ ] Handles UNIQUE constraint (idempotent)
- [ ] Returns Promise<void>
**Verify**: `cat packages/db/src/queries.ts | grep "recordNotification"`

---

### T18: Implement getCursor query helper

**What**: Function to get last cursor for a source
**Where**: `packages/db/src/queries.ts`
**Depends on**: T7
**Done when**:
- [ ] Queries source_state WHERE source_id = ?
- [ ] Returns string | null
**Verify**: `cat packages/db/src/queries.ts | grep "getCursor"`

---

### T19: Implement updateCursor query helper

**What**: Function to update cursor for a source
**Where**: `packages/db/src/queries.ts`
**Depends on**: T7
**Done when**:
- [ ] Upserts into source_state
- [ ] Updates last_cursor and last_fetched_at
- [ ] Returns Promise<void>
**Verify**: `cat packages/db/src/queries.ts | grep "updateCursor"`

---

### T20: Implement createDB factory function

**What**: Factory function that wraps D1Database with typed query helpers
**Where**: `packages/db/src/queries.ts`
**Depends on**: T8-T19
**Done when**:
- [ ] Accepts D1Database parameter
- [ ] Returns object implementing DB interface
- [ ] All query helpers implemented
**Verify**: `cat packages/db/src/queries.ts | grep "export function createDB"`

---

### T21: Update db package exports

**What**: Export createDB and DB interface from db package index
**Where**: `packages/db/src/index.ts`
**Depends on**: T20
**Done when**:
- [ ] Exports createDB function and DB type
- [ ] Re-exports migration path or instructions
**Verify**: `cat packages/db/src/index.ts | grep "export"`

---

### T22: Add dependencies to db package

**What**: Add @cloudflare/workers-types and @rentifier/core to db package
**Where**: `packages/db/package.json`
**Depends on**: None
**Done when**:
- [ ] @cloudflare/workers-types in devDependencies
- [ ] @rentifier/core in dependencies (workspace:*)
**Verify**: `cat packages/db/package.json | grep -E "(workers-types|@rentifier/core)"`

---

### T23: Create connector interface file [P]

**What**: Define Connector interface and FetchResult type
**Where**: `packages/connectors/src/interface.ts`
**Depends on**: None
**Done when**:
- [ ] FetchResult type with candidates and nextCursor
- [ ] Connector interface with sourceId, sourceName, fetchNew, normalize methods
- [ ] Imports from @rentifier/core
**Verify**: `cat packages/connectors/src/interface.ts | grep "export interface Connector"`

---

### T24: Create mock connector implementation

**What**: MockConnector class implementing Connector interface for testing
**Where**: `packages/connectors/src/mock.ts`
**Depends on**: T23
**Done when**:
- [ ] Implements Connector interface
- [ ] fetchNew returns 3 Hebrew test candidates on first call, empty on subsequent
- [ ] normalize returns ListingDraft with null fields
- [ ] Sample data includes Hebrew text with price, bedrooms, tags
**Verify**: `cat packages/connectors/src/mock.ts | grep "class MockConnector"`

---

### T25: Update connectors package exports

**What**: Export Connector interface, FetchResult, and MockConnector
**Where**: `packages/connectors/src/index.ts`
**Depends on**: T23, T24
**Done when**:
- [ ] Exports all from interface.ts and mock.ts
**Verify**: `cat packages/connectors/src/index.ts | grep "export"`

---

### T26: Add dependencies to connectors package

**What**: Add @rentifier/core dependency
**Where**: `packages/connectors/package.json`
**Depends on**: None
**Done when**:
- [ ] @rentifier/core in dependencies (workspace:*)
**Verify**: `cat packages/connectors/package.json | grep "@rentifier/core"`

---

### T27: Create extraction result types [P]

**What**: Define PriceResult, LocationResult, ExtractionResult types
**Where**: `packages/extraction/src/types.ts`
**Depends on**: None
**Done when**:
- [ ] PriceResult includes amount, currency, period, confidence
- [ ] LocationResult includes city, neighborhood, confidence
- [ ] ExtractionResult includes price, bedrooms, tags, location, overallConfidence
**Verify**: `cat packages/extraction/src/types.ts | grep "export interface"`

---

### T28: Create extraction patterns file [P]

**What**: Define regex patterns and keyword dictionaries for Hebrew/English
**Where**: `packages/extraction/src/patterns.ts`
**Depends on**: None
**Done when**:
- [ ] PRICE_PATTERNS array with ₪, ש״ח, $ patterns
- [ ] BEDROOM_PATTERNS array with חדרים, rooms, br, סטודיו patterns
- [ ] TAG_KEYWORDS map with Hebrew/English keywords for all tags
- [ ] CITY_NEIGHBORHOODS map with city → neighborhood mappings
**Verify**: `cat packages/extraction/src/patterns.ts | grep -E "(PRICE_PATTERNS|TAG_KEYWORDS)"`

---

### T29: Implement extractPrice function

**What**: Extract price amount, currency, and period from text
**Where**: `packages/extraction/src/extractors.ts`
**Depends on**: T27, T28
**Done when**:
- [ ] Parses Hebrew (₪, ש״ח) and English ($) price formats
- [ ] Detects period keywords (לחודש, /mo, weekly)
- [ ] Returns PriceResult with confidence score
- [ ] Returns null if no price found
**Verify**: `cat packages/extraction/src/extractors.ts | grep "export function extractPrice"`

---

### T30: Implement extractBedrooms function

**What**: Extract bedroom count from text
**Where**: `packages/extraction/src/extractors.ts`
**Depends on**: T27, T28
**Done when**:
- [ ] Parses Hebrew (חדרים, חדר) and English (rooms, br)
- [ ] Returns 0 for studio (סטודיו)
- [ ] Returns number | null
**Verify**: `cat packages/extraction/src/extractors.ts | grep "export function extractBedrooms"`

---

### T31: Implement extractTags function

**What**: Extract listing tags from text using keyword matching
**Where**: `packages/extraction/src/extractors.ts`
**Depends on**: T27, T28
**Done when**:
- [ ] Matches Hebrew/English keywords from TAG_KEYWORDS
- [ ] Returns string[] of tag identifiers
- [ ] Returns empty array if no tags found
**Verify**: `cat packages/extraction/src/extractors.ts | grep "export function extractTags"`

---

### T32: Implement extractLocation function

**What**: Extract city and neighborhood from text
**Where**: `packages/extraction/src/extractors.ts`
**Depends on**: T27, T28
**Done when**:
- [ ] Matches city names from SUPPORTED_CITIES
- [ ] Matches neighborhoods from CITY_NEIGHBORHOODS
- [ ] Returns LocationResult with confidence score
- [ ] Returns null if no location found
**Verify**: `cat packages/extraction/src/extractors.ts | grep "export function extractLocation"`

---

### T33: Implement extractAll pipeline function

**What**: Combine all extractors and calculate overall confidence
**Where**: `packages/extraction/src/extractors.ts`
**Depends on**: T29, T30, T31, T32
**Done when**:
- [ ] Calls all extractors with title + description
- [ ] Returns ExtractionResult
- [ ] overallConfidence is minimum of all sub-confidences
**Verify**: `cat packages/extraction/src/extractors.ts | grep "export function extractAll"`

---

### T34: Update extraction package exports

**What**: Export all types and extractor functions
**Where**: `packages/extraction/src/index.ts`
**Depends on**: T27, T28, T29, T30, T31, T32, T33
**Done when**:
- [ ] Exports all from types.ts, patterns.ts, extractors.ts
**Verify**: `cat packages/extraction/src/index.ts | grep "export"`

---

### T35: Add dependencies to extraction package

**What**: Add @rentifier/core dependency
**Where**: `packages/extraction/package.json`
**Depends on**: None
**Done when**:
- [ ] @rentifier/core in dependencies (workspace:*)
**Verify**: `cat packages/extraction/package.json | grep "@rentifier/core"`

---

### T36: Install all package dependencies

**What**: Run pnpm install to resolve workspace dependencies
**Where**: Root directory
**Depends on**: T5, T22, T26, T35
**Done when**:
- [ ] pnpm install completes without errors
- [ ] All workspace packages linked
**Verify**: `pnpm install`

---

### T37: Verify core package compiles

**What**: TypeCheck core package
**Where**: `packages/core/`
**Depends on**: T1, T2, T3, T4, T5, T36
**Done when**:
- [ ] `cd packages/core && tsc --noEmit` exits with code 0
**Verify**: `cd packages/core && tsc --noEmit`

---

### T38: Verify db package compiles

**What**: TypeCheck db package
**Where**: `packages/db/`
**Depends on**: T6, T7, T8-T20, T21, T22, T36
**Done when**:
- [ ] `cd packages/db && tsc --noEmit` exits with code 0
**Verify**: `cd packages/db && tsc --noEmit`

---

### T39: Verify connectors package compiles

**What**: TypeCheck connectors package
**Where**: `packages/connectors/`
**Depends on**: T23, T24, T25, T26, T36
**Done when**:
- [ ] `cd packages/connectors && tsc --noEmit` exits with code 0
**Verify**: `cd packages/connectors && tsc --noEmit`

---

### T40: Verify extraction package compiles

**What**: TypeCheck extraction package
**Where**: `packages/extraction/`
**Depends on**: T27, T28, T29-T33, T34, T35, T36
**Done when**:
- [ ] `cd packages/extraction && tsc --noEmit` exits with code 0
**Verify**: `cd packages/extraction && tsc --noEmit`

---

### T41: Test Zod schema validation

**What**: Create test file to verify schemas accept/reject sample data
**Where**: `packages/core/src/__tests__/schemas.test.ts`
**Depends on**: T3, T36
**Done when**:
- [ ] Test valid Listing passes listingSchema.parse()
- [ ] Test invalid Listing (negative price) throws ZodError
- [ ] Test valid Filter passes filterSchema.parse()
**Verify**: `cat packages/core/src/__tests__/schemas.test.ts | grep "test\\|expect"`

---

### T42: Test extraction functions with Hebrew text

**What**: Create test file with sample Hebrew listing texts
**Where**: `packages/extraction/src/__tests__/extractors.test.ts`
**Depends on**: T29-T33, T36
**Done when**:
- [ ] Test extractPrice with "4,500 ש״ח לחודש" returns correct amount/currency/period
- [ ] Test extractBedrooms with "3 חדרים" returns 3
- [ ] Test extractTags with "חניה ומרפסת" returns ['parking', 'balcony']
- [ ] Test extractLocation with "תל אביב - פלורנטין" returns correct city/neighborhood
**Verify**: `cat packages/extraction/src/__tests__/extractors.test.ts | grep "test\\|expect"`

---

### T43: Test mock connector implementation

**What**: Create test file to verify MockConnector satisfies interface
**Where**: `packages/connectors/src/__tests__/mock.test.ts`
**Depends on**: T24, T36
**Done when**:
- [ ] Test fetchNew(null) returns 3 candidates
- [ ] Test fetchNew(cursor) returns empty candidates
- [ ] Test normalize returns ListingDraft with correct structure
**Verify**: `cat packages/connectors/src/__tests__/mock.test.ts | grep "test\\|expect"`

---

### T44: Test db query helpers (unit)

**What**: Create test file with mock D1Database to verify query helpers
**Where**: `packages/db/src/__tests__/queries.test.ts`
**Depends on**: T20, T36
**Done when**:
- [ ] Test insertRawListing with valid params
- [ ] Test upsertListing with ListingDraft
- [ ] Test matchFilters with sample listing and filters
**Verify**: `cat packages/connectors/src/__tests__/queries.test.ts | grep "test\\|expect"`

---

### T45: Run all package tests

**What**: Execute test suite across all packages
**Where**: Root directory
**Depends on**: T41, T42, T43, T44
**Done when**:
- [ ] All tests pass
- [ ] No runtime errors
**Verify**: `pnpm -r test` (if test script exists) or manual test execution

---

### T46: Cross-package integration test

**What**: Create integration test importing from all packages
**Where**: `packages/core/src/__tests__/integration.test.ts`
**Depends on**: T37, T38, T39, T40
**Done when**:
- [ ] Import types from @rentifier/core
- [ ] Import createDB from @rentifier/db
- [ ] Import Connector from @rentifier/connectors
- [ ] Import extractAll from @rentifier/extraction
- [ ] All imports resolve without errors
**Verify**: `cat packages/core/src/__tests__/integration.test.ts | grep "import"`

---

## Execution Plan

### Phase 1: Core Package (Parallel)
Independent core files can be created simultaneously:
- T1 (types), T2 (constants), T5 (add zod dependency)
- Then T3 (schemas - depends on T1)
- Then T4 (exports - depends on T1, T2, T3)

### Phase 2: Other Packages Foundation (Parallel)
All packages can start in parallel:
- **DB**: T6 (migration) [P], then T7 (interface) [P]
- **Connectors**: T23 (interface) [P]
- **Extraction**: T27 (types) [P], T28 (patterns) [P]
- **Dependencies**: T22, T26, T35 [P]

### Phase 3: DB Implementation (Sequential within, parallel across functions)
- T8-T19: Query helper implementations (each depends on T7, but independent of each other)
- T20: createDB factory (depends on T8-T19)
- T21: exports (depends on T20)

### Phase 4: Connectors Implementation
- T24: MockConnector (depends on T23)
- T25: exports (depends on T23, T24)

### Phase 5: Extraction Implementation (Sequential within function, parallel across)
- T29-T32: Individual extractors (depend on T27, T28, independent of each other)
- T33: extractAll pipeline (depends on T29-T32)
- T34: exports (depends on all)

### Phase 6: Installation
- T36: Install dependencies (depends on all package.json updates)

### Phase 7: Verification (Parallel)
- T37, T38, T39, T40: TypeCheck each package
- T41, T42, T43, T44: Unit tests (parallel)
- T45: Run all tests
- T46: Integration test

---

## Parallel Execution Map

```
Phase 1 - Core (4 tasks, partially sequential):
  [T1] [T2] [T5]
    ↓    ↓
   [T3]──┘
    ↓
   [T4]

Phase 2 - Foundations (8 parallel tasks):
  [T6] [T7] [T22]  [T23] [T26]  [T27] [T28] [T35]
         ↓               ↓              ↓
Phase 3 - DB Queries (13 tasks):
  [T8] [T9] [T10] [T11] [T12] [T13] [T14] [T15] [T16] [T17] [T18] [T19]
    └────────────────────────┴────────────────────────┘
                             ↓
                          [T20]
                             ↓
                          [T21]

Phase 4 - Connectors (2 tasks):
  [T24]
    ↓
  [T25]

Phase 5 - Extraction (6 tasks):
  [T29] [T30] [T31] [T32]
    └──────┴─────┴────┘
            ↓
         [T33]
            ↓
         [T34]

Phase 6 - Install (1 task):
  [T36] (depends on T5, T22, T26, T35)

Phase 7 - Verification (10 parallel tasks):
  [T37] [T38] [T39] [T40]
    ↓     ↓     ↓     ↓
  [T41] [T42] [T43] [T44]
    └─────┴─────┴─────┘
            ↓
         [T45]
            ↓
         [T46]
```

**Total Tasks**: 46
**Parallelizable**: 28 tasks (61%)
**Sequential**: 18 tasks (39%)
**Estimated Time**: ~30-40 minutes (10 min setup + 10 min implementation + 5 min install + 10 min testing)

---

## Success Criteria Checklist

- [ ] All 46 tasks completed
- [ ] All four packages compile independently with `tsc --noEmit`
- [ ] Core Zod schemas validate and reject sample data (T41)
- [ ] DB query helpers produce correct typed results (T44)
- [ ] Mock connector passes interface type checks (T43)
- [ ] Extraction functions parse 10+ Hebrew/English texts correctly (T42)
- [ ] Cross-package imports resolve (T46)
- [ ] All tests pass (T45)

---

## Notes

- **Hebrew Text Support**: Extraction patterns must handle mixed Hebrew/English text, RTL characters, and various currency symbols (₪, ש״ח, $)
- **Confidence Scoring**: Low confidence (<0.3) should flag listings for manual review or future AI processing
- **Database Constraints**: UNIQUE constraints on (source_id, source_item_id) prevent duplicate listings from same source
- **Workspace Protocol**: All internal dependencies use `workspace:*` for real-time cross-package development
