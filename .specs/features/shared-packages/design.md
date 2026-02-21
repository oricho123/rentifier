# Shared Packages Design

**Spec**: `.specs/features/shared-packages/spec.md`
**Status**: Draft

---

## Architecture Overview

Four packages provide layered abstractions: `core` owns canonical types and validation, `db` owns persistence logic, `connectors` defines the ingestion contract, and `extraction` owns text-to-structured-field transformation. Dependencies flow downward only (no cycles):

```
┌─────────────┐
│ extraction  │  (uses core types, no DB)
└─────────────┘
      ↓
┌─────────────┐
│ connectors  │  (uses core types, no DB)
└─────────────┘
      ↓
┌─────────────┐
│     db      │  (uses core types, owns SQL)
└─────────────┘
      ↓
┌─────────────┐
│    core     │  (no dependencies, pure types + validation)
└─────────────┘
```

All workers import from these packages. No worker-to-worker dependencies exist.

---

## Code Reuse Analysis

**Greenfield — no existing code.**

Patterns to establish:
- **Zod as validation layer**: All runtime data from external sources passes through Zod schemas before business logic
- **Discriminated unions for source-specific data**: `ListingCandidate` has `source: string` and `sourceData: Record<string, unknown>` for raw payloads
- **Typed D1 result wrappers**: Query helpers accept/return domain types, not raw SQL rows
- **Extraction pipeline composition**: Each extractor is a pure function; pipeline combines them with confidence scoring
- **Connector interface genericity**: No YAD2/Facebook-specific logic in the interface; only in concrete implementations

---

## Components

### Package: `@rentifier/core`

#### Canonical Types
- **Purpose**: Single source of truth for domain entities
- **Location**: `packages/core/src/types.ts`
- **Interfaces**:
  ```typescript
  // Fully normalized listing
  export interface Listing {
    id: number;                      // Auto-increment PK from D1
    sourceId: string;                // e.g., "yad2", "facebook"
    sourceItemId: string;            // Original listing ID from source
    title: string;
    description: string;
    price: number;
    currency: 'ILS' | 'USD' | 'EUR';
    pricePeriod: 'month' | 'week' | 'day';
    bedrooms: number;                // 0 = studio
    city: string;
    neighborhood: string | null;
    tags: string[];                  // e.g., ["parking", "balcony", "pets"]
    url: string;
    postedAt: Date;
    ingestedAt: Date;
  }

  // Raw listing before normalization
  export interface ListingCandidate {
    source: string;
    sourceItemId: string;
    rawTitle: string;
    rawDescription: string;
    rawUrl: string;
    rawPostedAt: string | null;      // ISO date string or null
    sourceData: Record<string, unknown>; // Source-specific fields
  }

  // Partially normalized (after extraction, before DB insert)
  export interface ListingDraft {
    sourceId: string;
    sourceItemId: string;
    title: string;
    description: string;
    price: number | null;
    currency: 'ILS' | 'USD' | 'EUR' | null;
    pricePeriod: 'month' | 'week' | 'day' | null;
    bedrooms: number | null;
    city: string | null;
    neighborhood: string | null;
    tags: string[];
    url: string;
    postedAt: Date | null;
  }

  // User filter criteria
  export interface Filter {
    id: number;
    userId: number;
    name: string;
    minPrice: number | null;
    maxPrice: number | null;
    minBedrooms: number | null;
    maxBedrooms: number | null;
    cities: string[];
    neighborhoods: string[];
    keywords: string[];              // Must appear in title or description
    mustHaveTags: string[];
    excludeTags: string[];
    createdAt: Date;
  }
  ```
- **Dependencies**: None

#### Validation Schemas
- **Purpose**: Runtime validation for external data
- **Location**: `packages/core/src/schemas.ts`
- **Interfaces**:
  ```typescript
  import { z } from 'zod';

  export const listingSchema = z.object({
    id: z.number().int().positive(),
    sourceId: z.string().min(1),
    sourceItemId: z.string().min(1),
    title: z.string().min(1),
    description: z.string(),
    price: z.number().positive(),
    currency: z.enum(['ILS', 'USD', 'EUR']),
    pricePeriod: z.enum(['month', 'week', 'day']),
    bedrooms: z.number().int().min(0),
    city: z.string().min(1),
    neighborhood: z.string().nullable(),
    tags: z.array(z.string()),
    url: z.string().url(),
    postedAt: z.date(),
    ingestedAt: z.date(),
  });

  export const listingCandidateSchema = z.object({
    source: z.string().min(1),
    sourceItemId: z.string().min(1),
    rawTitle: z.string(),
    rawDescription: z.string(),
    rawUrl: z.string().url(),
    rawPostedAt: z.string().nullable(),
    sourceData: z.record(z.unknown()),
  });

  export const filterSchema = z.object({
    id: z.number().int().positive(),
    userId: z.number().int().positive(),
    name: z.string().min(1),
    minPrice: z.number().positive().nullable(),
    maxPrice: z.number().positive().nullable(),
    minBedrooms: z.number().int().min(0).nullable(),
    maxBedrooms: z.number().int().min(0).nullable(),
    cities: z.array(z.string()),
    neighborhoods: z.array(z.string()),
    keywords: z.array(z.string()),
    mustHaveTags: z.array(z.string()),
    excludeTags: z.array(z.string()),
    createdAt: z.date(),
  });
  ```
- **Dependencies**: `zod`

#### Constants
- **Purpose**: Enum-like values for cities, tags, currencies
- **Location**: `packages/core/src/constants.ts`
- **Interfaces**:
  ```typescript
  export const SUPPORTED_CITIES = [
    'Tel Aviv',
    'Jerusalem',
    'Haifa',
    'Herzliya',
    'Ramat Gan',
    'Netanya',
    'Beer Sheva',
  ] as const;

  export const LISTING_TAGS = [
    'parking',
    'balcony',
    'pets',
    'furnished',
    'immediate',
    'long-term',
    'accessible',
    'air-conditioning',
  ] as const;

  export const CURRENCIES = ['ILS', 'USD', 'EUR'] as const;
  export const PRICE_PERIODS = ['month', 'week', 'day'] as const;

  export type City = typeof SUPPORTED_CITIES[number];
  export type ListingTag = typeof LISTING_TAGS[number];
  export type Currency = typeof CURRENCIES[number];
  export type PricePeriod = typeof PRICE_PERIODS[number];
  ```
- **Dependencies**: None

---

### Package: `@rentifier/db`

#### Migration Files
- **Purpose**: Versioned SQL schema definitions
- **Location**: `packages/db/migrations/0001_initial.sql`
- **Interfaces**: SQL DDL
  ```sql
  CREATE TABLE sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    enabled INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE source_state (
    source_id INTEGER PRIMARY KEY,
    cursor TEXT,
    last_run_at TEXT,
    last_status TEXT CHECK(last_status IN ('ok', 'error')),
    last_error TEXT,
    FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
  );

  CREATE TABLE listings_raw (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER NOT NULL,
    source_item_id TEXT NOT NULL,
    url TEXT NOT NULL,
    raw_json TEXT NOT NULL,
    fetched_at TEXT DEFAULT (datetime('now')),
    UNIQUE(source_id, source_item_id) ON CONFLICT IGNORE,
    FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
  );

  CREATE TABLE listings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER NOT NULL,
    source_item_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    price REAL,
    currency TEXT,
    price_period TEXT,
    bedrooms INTEGER,
    city TEXT,
    neighborhood TEXT,
    area_text TEXT,
    tags_json TEXT,
    relevance_score REAL,
    url TEXT NOT NULL,
    posted_at TEXT,
    ingested_at TEXT DEFAULT (datetime('now')),
    UNIQUE(source_id, source_item_id) ON CONFLICT DO UPDATE SET
      title = excluded.title,
      description = excluded.description,
      price = excluded.price,
      currency = excluded.currency,
      price_period = excluded.price_period,
      bedrooms = excluded.bedrooms,
      city = excluded.city,
      neighborhood = excluded.neighborhood,
      area_text = excluded.area_text,
      tags_json = excluded.tags_json,
      relevance_score = excluded.relevance_score,
    FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
  );

  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_chat_id TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE filters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    min_price REAL,
    max_price REAL,
    min_bedrooms INTEGER,
    max_bedrooms INTEGER,
    cities TEXT,
    neighborhoods TEXT,
    keywords TEXT,
    must_have_tags TEXT,
    exclude_tags TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE notifications_sent (
    user_id INTEGER NOT NULL,
    listing_id INTEGER NOT NULL,
    sent_at TEXT DEFAULT (datetime('now')),
    channel TEXT NOT NULL DEFAULT 'telegram',
    PRIMARY KEY (user_id, listing_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE
  );

  CREATE INDEX idx_listings_raw_source_item ON listings_raw(source_id, source_item_id);
  CREATE INDEX idx_listings_ingested ON listings(ingested_at DESC);
  CREATE INDEX idx_filters_user_enabled ON filters(user_id, enabled);
  CREATE INDEX idx_notifications_user_listing ON notifications_sent(user_id, listing_id);
  ```
- **Dependencies**: D1 SQLite dialect

#### Query Helpers
- **Purpose**: Type-safe wrappers around D1 SQL operations
- **Location**: `packages/db/src/queries.ts`
- **Interfaces**:
  ```typescript
  import { D1Database } from '@cloudflare/workers-types';
  import { Listing, ListingDraft, Filter } from '@rentifier/core';

  export interface DB {
    // Raw listings
    insertRawListing(params: {
      sourceId: number;
      sourceItemId: string;
      payload: string;
    }): Promise<void>;

    findUnprocessedRaw(limit: number): Promise<Array<{
      id: number;
      sourceId: number;
      sourceItemId: string;
      payload: string;
    }>>;

    markRawAsProcessed(id: number): Promise<void>;

    // Canonical listings
    upsertListing(draft: ListingDraft): Promise<number>; // Returns listing ID

    findListingBySource(
      sourceId: string,
      sourceItemId: string
    ): Promise<Listing | null>;

    findRecentListings(since: Date, limit: number): Promise<Listing[]>;

    // Filters
    findAllFilters(): Promise<Filter[]>;

    matchFilters(listing: Listing, filters: Filter[]): Filter[];

    // Notifications
    // Users
    getUserById(userId: number): Promise<{ id: number; telegramChatId: string; displayName: string } | null>;

    wasNotificationSent(userId: number, listingId: number): Promise<boolean>;

    recordNotification(userId: number, listingId: number): Promise<void>;

    // Source state
    getCursor(sourceId: string): Promise<string | null>;

    updateCursor(sourceId: string, cursor: string): Promise<void>;
  }

  export function createDB(d1: D1Database): DB {
    // Implementation wraps D1 with typed methods
  }
  ```
- **Dependencies**: `@cloudflare/workers-types`, `@rentifier/core`

---

### Package: `@rentifier/connectors`

#### Connector Interface
- **Purpose**: Contract all source connectors must implement
- **Location**: `packages/connectors/src/interface.ts`
- **Interfaces**:
  ```typescript
  import { ListingCandidate, ListingDraft } from '@rentifier/core';

  export interface FetchResult {
    candidates: ListingCandidate[];
    nextCursor: string | null;       // null = no more data
  }

  export interface Connector {
    sourceId: string;                // Unique identifier (e.g., "yad2")
    sourceName: string;              // Human-readable (e.g., "YAD2")

    // Fetch new listings since cursor (cursor=null for initial fetch)
    fetchNew(cursor: string | null): Promise<FetchResult>;

    // Normalize source-specific candidate to draft
    normalize(candidate: ListingCandidate): ListingDraft;
  }
  ```
- **Dependencies**: `@rentifier/core`

#### Mock Connector (for testing)
- **Purpose**: Predictable test data for end-to-end validation
- **Location**: `packages/connectors/src/mock.ts`
- **Interfaces**:
  ```typescript
  import { Connector, FetchResult } from './interface';
  import { ListingCandidate, ListingDraft } from '@rentifier/core';

  export class MockConnector implements Connector {
    sourceId = 'mock';
    sourceName = 'Mock Source';

    async fetchNew(cursor: string | null): Promise<FetchResult> {
      // Returns 3 candidates on first call, empty on subsequent
      if (cursor !== null) {
        return { candidates: [], nextCursor: null };
      }
      return {
        candidates: [
          {
            source: 'mock',
            sourceItemId: 'mock-1',
            rawTitle: 'דירת 3 חדרים בתל אביב',
            rawDescription: 'דירה מרווחת עם חניה ומרפסת, 4500 ש״ח לחודש',
            rawUrl: 'https://example.com/mock-1',
            rawPostedAt: new Date().toISOString(),
            sourceData: {},
          },
          // ... 2 more
        ],
        nextCursor: 'mock-cursor-1',
      };
    }

    normalize(candidate: ListingCandidate): ListingDraft {
      return {
        sourceId: this.sourceId,
        sourceItemId: candidate.sourceItemId,
        title: candidate.rawTitle,
        description: candidate.rawDescription,
        price: null,
        currency: null,
        pricePeriod: null,
        bedrooms: null,
        city: null,
        neighborhood: null,
        tags: [],
        url: candidate.rawUrl,
        postedAt: candidate.rawPostedAt ? new Date(candidate.rawPostedAt) : null,
      };
    }
  }
  ```
- **Dependencies**: `@rentifier/core`

---

### Package: `@rentifier/extraction`

#### Extraction Result Types
- **Purpose**: Typed results for each extractor
- **Location**: `packages/extraction/src/types.ts`
- **Interfaces**:
  ```typescript
  export interface PriceResult {
    amount: number;
    currency: 'ILS' | 'USD' | 'EUR';
    period: 'month' | 'week' | 'day';
    confidence: number;              // 0-1
  }

  export interface LocationResult {
    city: string;
    neighborhood: string | null;
    confidence: number;
  }

  export interface ExtractionResult {
    price: PriceResult | null;
    bedrooms: number | null;
    tags: string[];
    location: LocationResult | null;
    overallConfidence: number;       // Min of all sub-confidences
  }
  ```
- **Dependencies**: None

#### Extraction Functions
- **Purpose**: Rule-based parsing of Hebrew/English listing text
- **Location**: `packages/extraction/src/extractors.ts`
- **Interfaces**:
  ```typescript
  import { PriceResult, LocationResult, ExtractionResult } from './types';

  // Extract price from text like "4,500 ש״ח", "4500₪", "$1200/mo"
  export function extractPrice(text: string): PriceResult | null;

  // Extract bedroom count from "3 חדרים", "3br", "סטודיו"
  export function extractBedrooms(text: string): number | null;

  // Extract tags like "חניה" → "parking", "מרפסת" → "balcony"
  export function extractTags(text: string): string[];

  // Extract city + neighborhood from known patterns
  export function extractLocation(text: string): LocationResult | null;

  // Run all extractors and combine results
  export function extractAll(
    title: string,
    description: string
  ): ExtractionResult;
  ```
- **Dependencies**: None (pure regex/string matching)

#### Patterns and Dictionaries
- **Purpose**: Regex patterns and Hebrew/English keyword mappings
- **Location**: `packages/extraction/src/patterns.ts`
- **Interfaces**:
  ```typescript
  // Price patterns
  export const PRICE_PATTERNS = [
    /(\d{1,3}(?:,\d{3})*)\s*(?:ש״ח|שח|shekel)/i,
    /(\d{1,3}(?:,\d{3})*)\s*₪/,
    /\$(\d{1,3}(?:,\d{3})*)/,
  ];

  // Bedroom patterns
  export const BEDROOM_PATTERNS = [
    /(\d+)\s*(?:חדרים|חדר|rooms?|br)/i,
    /(?:סטודיו|studio)/i,
  ];

  // Tag keywords (Hebrew → English)
  export const TAG_KEYWORDS: Record<string, string[]> = {
    parking: ['חניה', 'parking', 'חנייה'],
    balcony: ['מרפסת', 'balcony', 'מרפסות'],
    pets: ['חיות', 'pets', 'כלבים', 'חתולים'],
    furnished: ['מרוהט', 'furnished', 'מרוהטת'],
    immediate: ['מיידי', 'immediate', 'כניסה מיידית'],
    'long-term': ['לטווח ארוך', 'long-term', 'ארוך'],
    accessible: ['נגיש', 'accessible'],
    'air-conditioning': ['מזגן', 'ac', 'air-conditioning', 'מיזוג'],
  };

  // City/neighborhood mappings
  export const CITY_NEIGHBORHOODS: Record<string, string[]> = {
    'Tel Aviv': ['Florentin', 'Neve Tzedek', 'פלורנטין', 'נווה צדק'],
    Jerusalem: ['Nachlaot', 'German Colony', 'נחלאות', 'המושבה הגרמנית'],
    // ...
  };
  ```
- **Dependencies**: None

---

## Data Models

All data models defined in `@rentifier/core` (see Components > Core Types above).

Key relationships:
- `listings.source_id + listings.source_item_id` → unique constraint (deduplication)
- `filters.user_id` → foreign key to `users.id`
- `notifications_sent.(user_id, listing_id)` → unique constraint (prevent double-send)

---

## Error Handling Strategy

| Scenario | Detection | Handling |
|----------|-----------|----------|
| Invalid listing data from connector | Zod parse fails in `listingCandidateSchema` | Log error with source + sourceItemId, skip candidate, continue processing batch |
| Missing required field in draft | Zod parse fails in `upsertListing` | Return error to caller (processor worker), mark raw listing as failed |
| D1 constraint violation (duplicate listing) | `UNIQUE` constraint error from D1 | Catch in `upsertListing`, return existing listing ID, log as duplicate |
| Extraction returns low confidence (<0.3) | Check `overallConfidence` in `ExtractionResult` | Flag listing for manual review or AI fallback (future), still insert with null fields |
| Connector fetch throws (network/API error) | `fetchNew` promise rejects | Catch in collector worker, log error, preserve last successful cursor, retry next cron |
| Filter matching logic error | Exception in `matchFilters` | Catch in notify worker, log error, skip filter, continue with remaining filters |
| D1 query timeout | D1 throws timeout error | Catch in query helper, return empty result or rethrow with context |

---

## Tech Decisions

| Decision | Rationale | Trade-off |
|----------|-----------|-----------|
| **Zod for runtime validation** | TypeScript types erased at runtime; Zod provides both types and validation | Small bundle size increase (~12KB); acceptable for worker limit |
| **`ListingCandidate` vs `ListingDraft` split** | Separates raw ingestion (unvalidated) from extraction output (partially normalized) | Two types to maintain; clearer data flow boundaries |
| **Connector interface returns cursor** | Supports pagination for APIs with millions of listings | Connectors must implement cursor logic; unavoidable for large sources |
| **Tags as string array, not enum** | Allows future tag additions without schema migration | No compile-time exhaustiveness check; mitigated by `LISTING_TAGS` constant |
| **Extraction confidence scoring** | Enables filtering low-quality extractions | Adds complexity to extractor logic; necessary for Hebrew text ambiguity |
| **D1 stores tags as JSON text** | SQLite has no native array type | Must parse/stringify on read/write; acceptable overhead |
| **No build step for packages** | Wrangler bundles TypeScript; simpler workflow | Can't pre-test package builds independently; relies on worker build to catch errors |
| **Mock connector in core package** | Enables end-to-end testing without real API calls | Test-only code in production package; small footprint, worth the convenience |
| **Hebrew/English dual patterns** | Israeli market has mixed-language listings | More regex patterns to maintain; unavoidable for target market |
| **Separate `normalize` method in connector** | Decouples fetching from normalization; easier to test | Two methods per connector; clearer SRP |

---

## Package Dependency Graph

```
apps/collector     apps/processor    apps/notify
    ↓                   ↓                 ↓
    └───────────────────┴─────────────────┘
                        ↓
        ┌───────────────┼───────────────┐
        ↓               ↓               ↓
  @rentifier/db   @rentifier/       @rentifier/
                  connectors        extraction
        ↓               ↓               ↓
        └───────────────┴───────────────┘
                        ↓
                @rentifier/core
                   (base layer)
```

No cycles; all packages ultimately depend on `core`.

---

## Implementation Checklist

- [ ] Create `packages/core/src/types.ts` with `Listing`, `ListingCandidate`, `ListingDraft`, `Filter`
- [ ] Create `packages/core/src/schemas.ts` with Zod schemas for all core types
- [ ] Create `packages/core/src/constants.ts` with cities, tags, currencies
- [ ] Create `packages/db/migrations/0001_initial.sql` with full DDL
- [ ] Create `packages/db/src/queries.ts` with typed query helpers and `createDB` factory
- [ ] Create `packages/connectors/src/interface.ts` with `Connector` and `FetchResult` types
- [ ] Create `packages/connectors/src/mock.ts` with `MockConnector` implementation
- [ ] Create `packages/extraction/src/types.ts` with `PriceResult`, `LocationResult`, `ExtractionResult`
- [ ] Create `packages/extraction/src/patterns.ts` with regex patterns and keyword dictionaries
- [ ] Create `packages/extraction/src/extractors.ts` with `extractPrice`, `extractBedrooms`, `extractTags`, `extractLocation`, `extractAll`
- [ ] Add Zod dependency to `packages/core/package.json`
- [ ] Add `@cloudflare/workers-types` and `@rentifier/core` to `packages/db/package.json`
- [ ] Add `@rentifier/core` to `packages/connectors/package.json`
- [ ] Verify all packages compile with `pnpm -r exec tsc --noEmit`
- [ ] Write unit tests for extraction functions with sample Hebrew/English text
- [ ] Verify Zod schemas accept valid data and reject invalid data
- [ ] Verify mock connector satisfies `Connector` interface and returns predictable data

---

## References

- Zod documentation: https://zod.dev
- D1 schema reference: https://developers.cloudflare.com/d1/platform/schema/
- D1 query API: https://developers.cloudflare.com/d1/platform/client-api/
- TypeScript utility types: https://www.typescriptlang.org/docs/handbook/utility-types.html
