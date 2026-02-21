# Yad2 Connector — Design

## Architecture

The Yad2 connector lives in `packages/connectors/src/yad2/` and implements the existing `Connector` interface. It is registered in the collector's `ConnectorRegistry` alongside the mock connector.

```
packages/connectors/src/
├── interface.ts          # Existing Connector interface
├── mock.ts               # Existing mock connector
├── index.ts              # Barrel export (add Yad2Connector)
└── yad2/
    ├── index.ts           # Yad2Connector class (implements Connector)
    ├── client.ts          # HTTP client with retry, captcha detection
    ├── types.ts           # Yad2 API response types
    └── constants.ts       # API URL, headers, city codes, config
```

## Component Design

### 1. Yad2 API Types (`yad2/types.ts`)

TypeScript interfaces matching the known Yad2 API response shape:

```typescript
/** Raw Yad2 API response */
export interface Yad2ApiResponse {
  data: {
    markers: Yad2Marker[];
  };
}

/** Single listing marker from the map endpoint */
export interface Yad2Marker {
  orderId: string;
  token: string;
  price: number | null;
  adType: number;
  categoryId: number;
  subcategoryId: number;
  address: {
    city: { text: string; id?: number };
    area: { text: string; id?: number };
    neighborhood: { text: string; id?: number };
    street: { text: string; id?: number };
    house: { number: string | null; floor: number | null };
    coords: { lat: number; lon: number };
  };
  additionalDetails: {
    roomsCount: number | null;
    squareMeter: number | null;
    property: { text: string; id?: number };
    propertyCondition: { id: number | null };
  };
  metaData: {
    coverImage: string | null;
    images: string[];
    squareMeterBuild: number | null;
  };
}

/** Cursor state persisted in source_state.cursor */
export interface Yad2CursorState {
  lastFetchedAt: string | null;          // ISO timestamp of last successful fetch
  knownOrderIds: string[];               // Recently seen IDs for dedup (capped at 500)
  consecutiveFailures: number;           // Circuit breaker counter
  circuitOpenUntil: string | null;       // ISO timestamp when circuit breaker resets
  lastCityIndex: number;                 // Resume multi-city fetching across invocations
}
```

### 2. Constants (`yad2/constants.ts`)

```typescript
export const YAD2_API_BASE = 'https://gw.yad2.co.il/realestate-feed/rent/map';

export const YAD2_HEADERS: Record<string, string> = {
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'he,en-US;q=0.9,en;q=0.7',
  'Origin': 'https://www.yad2.co.il',
  'Referer': 'https://www.yad2.co.il/',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-site',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
};

/** Yad2 city codes for cities we want to track */
export const YAD2_CITY_CODES: Record<string, number> = {
  'תל אביב': 5000,
  'ירושלים': 3000,
  'חיפה': 4000,
  'הרצליה': 6400,
  'רמת גן': 8600,
  'גבעתיים': 6300,
  'באר שבע': 7900,
  'נתניה': 7400,
  'ראשון לציון': 8300,
  'פתח תקווה': 7900,
};

// Circuit breaker config
export const MAX_CONSECUTIVE_FAILURES = 5;
export const CIRCUIT_OPEN_DURATION_MS = 30 * 60 * 1000; // 30 minutes

// Retry config
export const MAX_RETRIES = 3;
export const INITIAL_RETRY_DELAY_MS = 1000;
export const REQUEST_TIMEOUT_MS = 10_000;

// Dedup
export const MAX_KNOWN_ORDER_IDS = 500;
```

### 3. HTTP Client (`yad2/client.ts`)

Wraps `fetch` with retry logic, timeout, and captcha detection.

```typescript
export class Yad2ApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number | null,
    public readonly errorType: 'network' | 'captcha' | 'http' | 'parse' | 'timeout',
    public readonly retryable: boolean,
  ) {
    super(message);
  }
}

export async function fetchYad2Listings(
  cityCode: number,
  signal?: AbortSignal,
): Promise<Yad2ApiResponse> {
  // 1. Build URL with query params (city, priceOnly=1, zoom=11)
  // 2. Call fetch() with YAD2_HEADERS and AbortSignal (for timeout)
  // 3. Check response.ok — throw retryable Yad2ApiError for 5xx
  // 4. Try response.json() — if parse fails, check for captcha string
  // 5. Validate response shape (data.markers exists)
  // 6. Return typed response
}

export async function fetchWithRetry(
  cityCode: number,
  maxRetries: number = MAX_RETRIES,
): Promise<Yad2ApiResponse> {
  // Retry loop with exponential backoff
  // Do NOT retry captcha errors (throw immediately)
  // Log each attempt
}
```

### 4. Yad2Connector (`yad2/index.ts`)

Implements the `Connector` interface:

```typescript
export class Yad2Connector implements Connector {
  sourceId = 'yad2';
  sourceName = 'Yad2';

  async fetchNew(cursor: string | null): Promise<FetchResult> {
    // 1. Parse cursor JSON → Yad2CursorState (or create default)
    // 2. Check circuit breaker — if open, return empty + same cursor
    // 3. Determine which city to fetch (round-robin via lastCityIndex)
    // 4. Call fetchWithRetry(cityCode)
    // 5. Filter out already-known orderIds
    // 6. Map Yad2Marker[] → ListingCandidate[]
    // 7. Update cursor state (knownOrderIds, lastFetchedAt, reset failures)
    // 8. Return { candidates, nextCursor: JSON.stringify(updatedState) }
    //
    // On failure:
    // - Increment consecutiveFailures
    // - If >= MAX_CONSECUTIVE_FAILURES, set circuitOpenUntil
    // - Return { candidates: [], nextCursor: JSON.stringify(updatedState) }
  }

  normalize(candidate: ListingCandidate): ListingDraft {
    // Yad2 provides structured data in sourceData, so we extract directly:
    const sd = candidate.sourceData as Partial<Yad2Marker>;

    return {
      sourceId: this.sourceId,
      sourceItemId: candidate.sourceItemId,
      title: candidate.rawTitle,
      description: candidate.rawDescription,
      price: sd.price ?? null,
      currency: 'ILS',                    // Yad2 is always ILS
      pricePeriod: 'month',               // Yad2 rentals are monthly
      bedrooms: sd.additionalDetails?.roomsCount ?? null,
      city: sd.address?.city?.text ?? null,
      neighborhood: sd.address?.neighborhood?.text ?? null,
      tags: this.extractTags(sd),
      url: candidate.rawUrl,
      postedAt: candidate.rawPostedAt ? new Date(candidate.rawPostedAt) : null,
    };
  }

  private extractTags(marker: Partial<Yad2Marker>): string[] {
    // Derive tags from structured fields:
    // - property type (apartment, garden apt, penthouse, etc.)
    // - property condition
    // - floor (ground floor, high floor)
    // - has images
  }
}
```

### 5. Marker → ListingCandidate Mapping

```
Yad2 Marker field              → ListingCandidate field
─────────────────────────────────────────────────────────
orderId                        → sourceItemId
"yad2"                         → source
"{city} - {rooms} חדרים"       → rawTitle (constructed)
"{street}, {neighborhood}"     → rawDescription (constructed)
/realestate/item/{token}       → rawUrl
null (API doesn't provide)     → rawPostedAt
entire marker object           → sourceData
```

Note: The Yad2 map API does not return a `title` or `description` field. We construct `rawTitle` from city + rooms + price, and `rawDescription` from the address components. The `sourceData` carries the full marker so the `normalize()` method can extract structured fields directly.

### 6. Registration

**Collector registry** (`apps/collector/src/registry.ts`):
```typescript
import { Yad2Connector } from '@rentifier/connectors';
registry.register('yad2', new Yad2Connector());
```

**Processor registry** (`apps/processor/src/pipeline.ts`):
```typescript
import { Yad2Connector } from '@rentifier/connectors';
registry.register('yad2', new Yad2Connector());
```

**Seed migration** (`packages/db/migrations/0004_seed_yad2_source.sql`):
```sql
INSERT INTO sources (name, enabled) VALUES ('yad2', 1)
ON CONFLICT(name) DO NOTHING;
```

### 7. Circuit Breaker Flow

```
                    ┌─────────────┐
          success   │   CLOSED    │  normal operation
         ┌────────▶ │  (fetch OK) │ ◀────────┐
         │          └──────┬──────┘           │
         │                 │ failure          │ success
         │                 ▼                  │
         │          ┌─────────────┐           │
         │          │  COUNTING   │           │
         │          │ failures<N  │           │
         │          └──────┬──────┘           │
         │                 │ failures>=N      │
         │                 ▼                  │
         │          ┌─────────────┐           │
         └──────────│    OPEN     │───────────┘
          cooldown  │ skip fetch  │  cooldown expired,
          expired   │ 30 min wait │  try one request
                    └─────────────┘
```

State is stored as JSON in `source_state.cursor`. The collector already reads/writes cursor via `db.getSourceState()` / `db.updateSourceState()`.

### 8. Error Handling Summary

| Error Type | Retryable? | Circuit Breaker? | Action |
|---|---|---|---|
| Network timeout | Yes (3x) | Yes | Retry with backoff, then count as failure |
| HTTP 5xx | Yes (3x) | Yes | Retry with backoff, then count as failure |
| HTTP 4xx | No | Yes | Log, count as failure |
| Captcha (Radware) | No | Yes | Log prominently, count as failure, abort cycle |
| JSON parse error | No | Yes | Log, count as failure |
| Empty markers | No | No | Normal — no new listings |

### 9. Dependencies

No new npm dependencies. The connector uses only:
- `fetch` (Cloudflare Workers global)
- `AbortController` / `AbortSignal` (Cloudflare Workers global)
- `@rentifier/core` types
- `@rentifier/connectors` interface
