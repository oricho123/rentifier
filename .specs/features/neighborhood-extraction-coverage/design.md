# Neighborhood Extraction Coverage — Design

**Spec:** `.specs/features/neighborhood-extraction-coverage/spec.md`
**Spike decision (AD-029):** Strategy B — Nominatim + D1 write-through cache.
**Strategy A (OSM polygons)** demoted to P3 contingency for TLV only.

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│ processor/pipeline.ts — processBatch()                              │
│                                                                     │
│  for each raw listing:                                              │
│    1. parse + normalize (connector)                                 │
│    2. extractAll()        ← regex, sets neighborhood if text says it│
│    3. aiExtract()         ← AI fallback, may set neighborhood       │
│    4. ★ resolveNeighborhood()  ← NEW step 5c (this feature)        │
│    5. duplicate detection                                           │
│    6. upsertListing()     ← neighborhood_source written here        │
└─────────────────────────────────────────────────────────────────────┘

resolveNeighborhood():
  ┌──────────────────────────────────────────────────┐
  │ neighborhood already set?  → source = regex/ai   │
  │                               return early        │
  │                                                   │
  │ has (lat, lng)?  → cache lookup (coords key)      │
  │   hit  → return cached name                       │
  │   miss → call Nominatim (if budget remaining)     │
  │           write through to cache                  │
  │           return name                             │
  │                                                   │
  │ has (street, city)?  → cache lookup (street key)  │
  │   hit  → return cached name                       │
  │   miss → call Nominatim forward geocode           │
  │           write through to cache                  │
  │           return name                             │
  │                                                   │
  │ return null                                       │
  └──────────────────────────────────────────────────┘
```

### Why after AI, not before

The regex+AI pipeline already handles neighborhood for structured sources (YAD2 posts that name the area explicitly). Running geocoding only when both miss prevents unnecessary external calls on self-describing posts. Order: `regex → AI → geocode`.

### Why no KV rate-limiter

Nominatim allows 1 req/sec. `processBatch()` is a sequential `for` loop; each Nominatim call takes ~1.1s (p50 from spike). The natural latency satisfies the policy without any artificial sleep. The **batch budget** (default 30) caps the total calls per run. Cron triggers run one Worker instance at a time — no concurrency problem. KV for rate-limiting adds latency for zero benefit.

---

## 2. Database Changes

### Migration 0015 — `neighborhood_source` column

```sql
-- Add provenance tracking to canonical listings.
-- Values: 'regex' | 'ai' | 'coords_live' | 'street_live' | NULL
ALTER TABLE listings ADD COLUMN neighborhood_source TEXT;

-- Partial index: find unresolved listings efficiently for backfill
CREATE INDEX idx_listings_no_neighborhood
  ON listings(ingested_at)
  WHERE neighborhood IS NULL;
```

File: `packages/db/migrations/0015_add_neighborhood_source.sql`

### Migration 0016 — `neighborhood_cache` table

```sql
-- Write-through cache for geocoder responses.
-- Keyed by a deterministic string; populated by the processor Worker
-- and the backfill script. Hits are free (D1 read); misses call Nominatim.
CREATE TABLE neighborhood_cache (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  cache_key   TEXT    NOT NULL UNIQUE,
  cache_type  TEXT    NOT NULL CHECK(cache_type IN ('coords', 'street')),
  raw_name    TEXT,                         -- exact string from provider
  canonical_name TEXT,                      -- normalized via CITY_NEIGHBORHOODS
  provider    TEXT    NOT NULL,             -- 'nominatim'
  resolved_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_neighborhood_cache_key ON neighborhood_cache(cache_key);
```

File: `packages/db/migrations/0016_neighborhood_cache.sql`

**Cache key format:**

| Type | Format | Example |
|---|---|---|
| Coords | `c:{lat4dp}:{lng4dp}` | `c:32.0577:34.7689` |
| Street | `s:{city}:{street_norm}` | `s:תל אביב:רוטשילד` |

4 decimal places ≈ 11m grid cells — apartments in the same building share one cache entry.
Street normalization: strip Hebrew prefixes (`רחוב `, `רח' `, `שדרות `, `שד' `, `דרך `), trim whitespace.

---

## 3. NominatimResolver Module

### Location

`packages/extraction/src/nominatim-resolver.ts`

Sits alongside `ai-extractor.ts`. The `@rentifier/extraction` package is already imported by `apps/processor` — no new dependency needed.

### Interface

```typescript
export type NeighborhoodSource = 'regex' | 'ai' | 'coords_live' | 'street_live';

export interface ResolvedNeighborhood {
  neighborhood: string;       // canonical Hebrew name (or raw if unknown variant)
  source: NeighborhoodSource;
  fromCache: boolean;
}

export interface NominatimConfig {
  userAgent: string;          // required by Nominatim ToS
  timeoutMs?: number;         // default 10_000
}

export interface NeighborhoodCacheEntry {
  rawName: string | null;
  canonicalName: string | null;
  provider: string;
}

/** Passed in from pipeline — wraps the D1 cache table operations. */
export interface NeighborhoodCache {
  get(key: string): Promise<NeighborhoodCacheEntry | null>;
  set(key: string, type: 'coords' | 'street', entry: NeighborhoodCacheEntry): Promise<void>;
}

export interface NominatimResolverInput {
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  street: string | null;
  houseNumber: string | null;
}

/** Resolves a neighborhood; returns null if unresolvable or budget exhausted. */
export async function resolveNeighborhood(
  input: NominatimResolverInput,
  cache: NeighborhoodCache,
  config: NominatimConfig,
  budgetRemaining: () => number,
  consumeBudget: () => void,
): Promise<ResolvedNeighborhood | null>
```

### Coordination contract with pipeline

The pipeline maintains a **budget counter** per batch:

```typescript
let geocodeBudgetUsed = 0;
const GEOCODE_BUDGET = parseInt(env.NEIGHBORHOOD_GEOCODER_BUDGET ?? '30', 10);

// Passed into resolveNeighborhood:
const budgetRemaining = () => GEOCODE_BUDGET - geocodeBudgetUsed;
const consumeBudget = () => { geocodeBudgetUsed++; };
```

Cache hits do **not** consume budget (they're free D1 reads). Only actual Nominatim calls consume budget.

### Internal flow

```
resolveNeighborhood(input, cache, config, budget, consume):
  if input.city is null → return null

  // Coords path (P1)
  if lat/lng present and non-zero:
    key = "c:{round4(lat)}:{round4(lng)}"
    cached = await cache.get(key)
    if cached:
      return toResolved(cached, 'coords_live', fromCache=true)

    if budget() <= 0:
      log {event: 'geocode_budget_exhausted', listing: ...}
      return null

    consume()
    result = await callNominatimReverse(lat, lng, config)
    normalized = alignToCanonical(result.rawName, input.city)
    if result.rawName and !normalized:
      log {event: 'neighborhood_alias_candidate', rawName, city, provider: 'nominatim'}
    await cache.set(key, 'coords', { rawName: result.rawName, canonicalName: normalized, provider: 'nominatim' })
    if result.rawName:
      return { neighborhood: normalized ?? result.rawName, source: 'coords_live', fromCache: false }
    return null

  // Street path (P2)
  if street present and city present:
    streetNorm = normalizeStreetPrefix(input.street)
    key = "s:{city}:{streetNorm}"
    cached = await cache.get(key)
    if cached:
      return toResolved(cached, 'street_live', fromCache=true)

    if budget() <= 0:
      log {event: 'geocode_budget_exhausted', ...}
      return null

    consume()
    q = `${streetNorm} ${houseNumber ?? ''}, ${city}, Israel`.trim()
    result = await callNominatimForward(q, config)
    normalized = alignToCanonical(result.rawName, input.city)
    if result.rawName and !normalized:
      log {event: 'neighborhood_alias_candidate', rawName, city, provider: 'nominatim'}
    await cache.set(key, 'street', { rawName: result.rawName, canonicalName: normalized, provider: 'nominatim' })
    if result.rawName:
      return { neighborhood: normalized ?? result.rawName, source: 'street_live', fromCache: false }
    return null

  return null
```

### Error handling

- Network timeout → log `geocode_timeout`, return null (do NOT consume budget)
- Non-2xx HTTP → log `geocode_http_error`, return null (do NOT consume budget)
- Empty provider response → cache the miss (key maps to `{ rawName: null, canonicalName: null }`) to avoid re-calling for the same point
- Rate-limit response (HTTP 429) → log `geocode_rate_limited`, stop calling for this batch (set budget = 0)

---

## 4. Pipeline Integration (`apps/processor/src/pipeline.ts`)

### New signature

`processBatch` receives an optional `geocoder` config via a new `ProcessorConfig` object to avoid growing the parameter list:

```typescript
export interface ProcessorConfig {
  ai?: AiProvider;
  aiConfig?: Partial<AiExtractorConfig>;
  geocoderConfig?: {
    userAgent: string;
    budget: number;
  };
}

export async function processBatch(
  db: DB,
  batchSize: number = 50,
  config?: ProcessorConfig,
): Promise<ProcessingResult>
```

The existing callers (`apps/processor/src/index.ts`) pass `ai` and `aiConfig` today; they'll be migrated to the new config object.

### New Step 5c in the pipeline loop

Inserted **after** Step 5a (AI) and **before** Step 5b (duplicate detection):

```typescript
// Step 5c: geocode neighborhood if still null
let neighborhoodSource: string | null = null;

// Determine source of whatever neighborhood we already have
const regexNeighborhood = extraction.location?.neighborhood ?? null;
const neighborhoodFromAI = aiWasUsed && !regexNeighborhood
  ? (extraction.location?.neighborhood ?? null)
  : null;

if (regexNeighborhood) {
  neighborhoodSource = 'regex';
} else if (neighborhoodFromAI) {
  neighborhoodSource = 'ai';
} else if (config?.geocoderConfig && draft.city) {
  // Attempt geocoder resolution
  const resolved = await resolveNeighborhood(
    {
      city: extraction.location?.city ?? draft.city ?? null,
      latitude: draft.latitude ?? null,
      longitude: draft.longitude ?? null,
      street: extraction.street ?? draft.street ?? null,
      houseNumber: draft.houseNumber ?? null,
    },
    dbNeighborhoodCache,  // see §5
    config.geocoderConfig,
    () => geocodeBudget.remaining,
    () => geocodeBudget.consume(),
  );
  if (resolved) {
    extraction = {
      ...extraction,
      location: { ...extraction.location, neighborhood: resolved.neighborhood },
    };
    neighborhoodSource = resolved.source;
  }
}
```

Then in the `listingRow` build (Step 6):

```typescript
neighborhood_source: neighborhoodSource,
```

### Tracking source for regex vs AI

The current code runs regex extraction (Step 5) then AI merge (Step 5a). To distinguish which step set the neighborhood, snapshot the regex result before AI:

```typescript
const regexExtraction = extractAll(draft.title, draft.description);
const regexNeighborhood = regexExtraction.location?.neighborhood ?? null;
let extraction = regexExtraction;
// ... AI merge ...
const aiSetNeighborhood = !regexNeighborhood && (extraction.location?.neighborhood != null);
neighborhoodSource = regexNeighborhood ? 'regex' : (aiSetNeighborhood ? 'ai' : null);
```

### Budget metrics in the result

```typescript
export interface ProcessingResult {
  // ...existing fields...
  geocodeMetrics?: {
    cacheHits: number;
    misses: number;     // actual Nominatim calls made
    budgetExhausted: boolean;
  };
}
```

---

## 5. DB Interface Extensions (`packages/db/src/queries.ts`)

### New methods on `DB`

```typescript
export interface DB {
  // ...existing...
  getCachedNeighborhood(cacheKey: string): Promise<NeighborhoodCacheRow | null>;
  setCachedNeighborhood(
    cacheKey: string,
    cacheType: 'coords' | 'street',
    rawName: string | null,
    canonicalName: string | null,
    provider: string,
  ): Promise<void>;
  updateListingNeighborhood(
    listingId: number,
    neighborhood: string | null,
    neighborhoodSource: string | null,
  ): Promise<void>;
}

export interface NeighborhoodCacheRow {
  cache_key: string;
  cache_type: string;
  raw_name: string | null;
  canonical_name: string | null;
  provider: string;
  resolved_at: string;
}
```

`updateListingNeighborhood` is used by the backfill script only. The processor writes `neighborhood_source` via the existing `upsertListing` path after `ListingRow` gains the new field.

### `NeighborhoodCache` adapter

The `NeighborhoodCache` interface required by `NominatimResolver` is a thin wrapper that the pipeline constructs from `db`:

```typescript
const dbNeighborhoodCache: NeighborhoodCache = {
  get: (key) => db.getCachedNeighborhood(key),
  set: (key, type, entry) =>
    db.setCachedNeighborhood(key, type, entry.rawName, entry.canonicalName, entry.provider),
};
```

This keeps `nominatim-resolver.ts` in `@rentifier/extraction` with no direct D1 dependency — it operates on the `NeighborhoodCache` abstraction, making it easy to unit test with a mock.

---

## 6. Schema Type Changes (`packages/db/src/schema.ts`)

```typescript
export interface ListingRow {
  // ...existing fields...
  neighborhood_source: string | null;  // ADD
}
```

`upsertListing` SQL gains `neighborhood_source` in the INSERT/UPDATE columns.

---

## 7. Configuration (`apps/processor/wrangler.json`)

```json
"vars": {
  "AI_GATEWAY_ID": "rentifier-ai-gateway",
  "NEIGHBORHOOD_GEOCODER_BUDGET": "30",
  "NEIGHBORHOOD_GEOCODER_USER_AGENT": "rentifier-processor/1.0 (+https://github.com/oricho123/rentifier)"
}
```

`NEIGHBORHOOD_GEOCODER_USER_AGENT` is a required field per [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/). The value must identify the project and include a contact/URL.

The geocoder is **opt-in at the Worker level**: if `NEIGHBORHOOD_GEOCODER_USER_AGENT` is absent, the processor skips geocoding (budget = 0). This ensures nothing breaks on deploy before the migration is applied.

---

## 8. Backfill Script (`scripts/backfill-neighborhoods.ts`)

```
Usage:
  pnpm tsx --env-file=.env scripts/backfill-neighborhoods.ts \
    --since=2026-01-26 [--dry-run] [--batch=50] [--delay=1200]

Args:
  --since=YYYY-MM-DD   Process listings ingested on or after this date (required)
  --dry-run            Print what would be updated, write nothing
  --batch=N            Listings per D1 REST page (default 50)
  --delay=N            ms to sleep between Nominatim calls (default 1200 = ~1/sec)

Output:
  Console: running totals + final summary
  Writes: listings.neighborhood, listings.neighborhood_source via D1 REST
```

The script reuses `NominatimResolver` and the same `alignToCanonical` function.  
No hard call cap per script run — operator controls pace via `--delay`.  
Estimated runtime for 90 days of data: ~5k listings × cache miss rate (~40%) × 1.2s = ~40 min. Acceptable; run as a one-off on a weekend.

Backfill does **not** update `notifications_sent` — it only fills the `neighborhood` field. Notification deduplication is keyed on `(user_id, listing_id)` and the row already exists for sent notifications, so no duplicate notifications can be triggered.

---

## 9. New Package Structure

```
packages/extraction/src/
├── cities.ts                  (existing — CITY_NEIGHBORHOODS)
├── extractors.ts              (existing)
├── ai-extractor.ts            (existing)
├── nominatim-resolver.ts      ← NEW (P1/P2)
└── index.ts                   (re-export resolveNeighborhood + NeighborhoodSource)

packages/db/migrations/
├── ...0014_add_region_code.sql (existing)
├── 0015_add_neighborhood_source.sql  ← NEW
└── 0016_neighborhood_cache.sql       ← NEW

packages/db/src/
├── schema.ts                  (ListingRow + NeighborhoodCacheRow updated)
└── queries.ts                 (DB interface + createDB updated)

apps/processor/src/
└── pipeline.ts                (Step 5c added, ProcessorConfig introduced)
└── index.ts                   (pass geocoderConfig from env vars)

scripts/
└── backfill-neighborhoods.ts  ← NEW (P1b)
```

---

## 10. Test Strategy

### Unit tests (new file: `packages/extraction/src/__tests__/nominatim-resolver.test.ts`)

| Test | What it verifies |
|---|---|
| Returns cached coord hit without external call | Cache abstraction works, no budget consumed |
| Returns cached street hit without external call | Same for street path |
| Calls Nominatim on cache miss, writes through, consumes budget | Happy path P1 |
| Forward-geocodes street+city when no coords | Happy path P2 |
| Returns null when budget is 0 | Budget enforcement |
| Returns null and does NOT consume budget on timeout | Error handling |
| Returns null and does NOT consume budget on 429 | Rate-limit handling |
| Stores verbatim raw name when variant not in CITY_NEIGHBORHOODS | Alias-learning |
| Skips geocoding when neighborhood already set (regex) | No-op when upstream handled it |
| Treats (0, 0) coords as missing, falls through to street path | Edge case from spec |

### Integration test (new in `apps/processor/src/__tests__/pipeline.test.ts`)

Extend existing pipeline tests with:
- `geocoderConfig` passed but all neighborhoods resolved by regex → `geocodeMetrics.misses = 0`
- Batch where 3 listings need geocoding and budget = 2 → 2 resolved, 1 skipped with `budgetExhausted = true`

---

## 11. Open Decisions (Defer to Implementation)

| Decision | Options | Recommendation |
|---|---|---|
| `upsertListing` SQL update for `neighborhood_source` | Always overwrite / only set if null | **Always overwrite** — if regex resolved it, `neighborhood_source = 'regex'` replaces any stale null; idempotent on re-run |
| Cache TTL / eviction | None (forever) / 90-day TTL | **No TTL for now** — neighbourhood boundaries don't move; cache grows slowly (~5k entries/month of new unique points). Add TTL column if cache > 100k rows |
| Nominatim `zoom` level | 14 (city), 16 (suburb), 18 (building) | **16** (suburb) — matches the spike. 18 returns street-level objects, not neighbourhood names |
| Forward-geocode ambiguity (street spans multiple neighbourhoods) | Store null / store first result | **Store first result** and log `forward_geocode_first_match` — Nominatim returns the highest-relevance match first; a single ambiguous street is unlikely to cause user-visible errors |
