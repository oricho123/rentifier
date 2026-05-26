# Neighborhood Extraction Coverage — Tasks

**Spec:** `.specs/features/neighborhood-extraction-coverage/spec.md`
**Design:** `.specs/features/neighborhood-extraction-coverage/design.md`
**Spike:** `.specs/features/neighborhood-extraction-coverage/spike-results.md`

Tasks are ordered by dependency. Each task is independently implementable and has a concrete verification step.

---

## Group 1 — Schema & DB Layer (no logic, just structure)

### T01 — Migration 0015: add `neighborhood_source` column

**File:** `packages/db/migrations/0015_add_neighborhood_source.sql`

```sql
ALTER TABLE listings ADD COLUMN neighborhood_source TEXT;

CREATE INDEX idx_listings_no_neighborhood
  ON listings(ingested_at)
  WHERE neighborhood IS NULL;
```

**Verify:** `pnpm db:migrate:local` succeeds. `pnpm db:query:local "PRAGMA table_info(listings)"` shows `neighborhood_source` column.

---

### T02 — Migration 0016: create `neighborhood_cache` table

**File:** `packages/db/migrations/0016_neighborhood_cache.sql`

```sql
CREATE TABLE neighborhood_cache (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  cache_key      TEXT    NOT NULL UNIQUE,
  cache_type     TEXT    NOT NULL CHECK(cache_type IN ('coords', 'street')),
  raw_name       TEXT,
  canonical_name TEXT,
  provider       TEXT    NOT NULL,
  resolved_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_neighborhood_cache_key ON neighborhood_cache(cache_key);
```

**Verify:** `pnpm db:migrate:local` succeeds. `pnpm db:query:local "SELECT name FROM sqlite_master WHERE type='table' AND name='neighborhood_cache'"` returns the table name.

---

### T03 — Schema types: add `neighborhood_source` to `ListingRow`

**File:** `packages/db/src/schema.ts`

Add `neighborhood_source: string | null;` to `ListingRow` after `duplicate_of`.

Add new interface:
```typescript
export interface NeighborhoodCacheRow {
  id: number;
  cache_key: string;
  cache_type: 'coords' | 'street';
  raw_name: string | null;
  canonical_name: string | null;
  provider: string;
  resolved_at: string;
}
```

**Verify:** `pnpm typecheck` passes with zero errors.

---

### T04 — DB queries: `getCachedNeighborhood`, `setCachedNeighborhood`, `updateListingNeighborhood`

**File:** `packages/db/src/queries.ts`

Add to `DB` interface:

```typescript
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
```

Implement all three in `createDB()`.

`setCachedNeighborhood` uses `INSERT OR REPLACE` (not `INSERT OR IGNORE`) so a miss-entry can be overwritten if a later call returns a real name.

`updateListingNeighborhood` used only by the backfill script — updates `neighborhood` and `neighborhood_source` where `id = ?`.

Also update `upsertListing` INSERT and UPDATE SQL to include `neighborhood_source`.

**Verify:** `pnpm typecheck` passes. All existing tests pass (`pnpm test`).

---

## Group 2 — NominatimResolver module

### T05 — `nominatim-resolver.ts`: interfaces, cache-key helpers, street normalizer

**File:** `packages/extraction/src/nominatim-resolver.ts`

Implement:
- `NeighborhoodSource` type
- `ResolvedNeighborhood` interface
- `NeighborhoodCache` interface (pure abstraction, no D1 import)
- `NominatimConfig` interface
- `buildCoordsKey(lat, lng): string` — rounds to 4dp, returns `"c:{lat}:{lng}"`
- `buildStreetKey(city, street): string` — normalizes street prefix, returns `"s:{city}:{streetNorm}"`
- `normalizeStreetPrefix(street): string` — strips `רחוב `, `רח' `, `שדרות `, `שד' `, `דרך ` from the start, trims

**Verify:** Unit tests for `buildCoordsKey` (4dp rounding), `buildStreetKey` (prefix stripping), and `normalizeStreetPrefix`.

---

### T06 — `nominatim-resolver.ts`: Nominatim HTTP calls

**File:** `packages/extraction/src/nominatim-resolver.ts`

Implement two internal functions (not exported):
- `callNominatimReverse(lat, lng, config)`: calls `/reverse?format=json&lat=&lon=&zoom=16&addressdetails=1`, extracts `address.neighbourhood ?? address.suburb ?? address.quarter ?? address.city_district`
- `callNominatimForward(q, config)`: calls `/search?format=jsonv2&q=&addressdetails=1&limit=1`, same field extraction from `[0].address`

Both return `{ rawName: string | null; error?: string }`. Timeout = `config.timeoutMs ?? 10_000`. On HTTP 429 they return `{ rawName: null, error: 'rate_limited' }`.

**Verify:** Unit tests with `fetch` mocked — successful reverse geocode, successful forward geocode, timeout (AbortController), 429 rate-limit response.

---

### T07 — `nominatim-resolver.ts`: `resolveNeighborhood` main function

**File:** `packages/extraction/src/nominatim-resolver.ts`

Implement `resolveNeighborhood()` per design §3. Full flow:
1. Early return if `city` null
2. Coords path: cache lookup → Nominatim call → normalize via `alignToCanonical` → log alias candidates → cache write → return
3. Street path: same, using forward geocode
4. Budget enforcement: cache hits don't consume budget; errors don't consume budget; 429 sets budget to 0
5. Cache "negative" entries: when provider returns no name, write `{ rawName: null, canonicalName: null }` to avoid re-calling the same coord/street

Export from `packages/extraction/src/index.ts`:
```typescript
export { resolveNeighborhood, type ResolvedNeighborhood, type NeighborhoodSource, type NeighborhoodCache, type NominatimConfig } from './nominatim-resolver';
```

**Verify:** Unit tests (10 cases from design §10):
1. Cache hit → no external call, budget unchanged
2. Cache miss, Nominatim returns known name → `hit_canonical`, budget -1
3. Cache miss, Nominatim returns unknown name → stored verbatim, alias-candidate logged
4. Budget = 0 → null returned, no fetch
5. Fetch timeout → null, budget NOT consumed
6. HTTP 429 → null, budget set to 0
7. `(0, 0)` coords → treated as missing, falls through to street path
8. Regex already set neighborhood → caller skips (tested indirectly via pipeline test)
9. No coords, no street → null
10. Negative cache entry (rawName=null) → null returned, no fetch

---

## Group 3 — Pipeline integration

### T08 — `ProcessorConfig` type + migrate callers

**File:** `apps/processor/src/pipeline.ts` and `apps/processor/src/index.ts`

Introduce `ProcessorConfig`:
```typescript
export interface ProcessorConfig {
  ai?: AiProvider;
  aiConfig?: Partial<AiExtractorConfig>;
  geocoderConfig?: { userAgent: string; budget: number; };
}
```

Change `processBatch(db, batchSize, ai?, aiConfig?)` → `processBatch(db, batchSize, config?)`. Update `index.ts` to pass the new shape. Update any test that calls `processBatch` directly.

**Verify:** `pnpm typecheck` passes. `pnpm test` passes.

---

### T09 — Pipeline: snapshot regex neighborhood, track `neighborhoodSource`

**File:** `apps/processor/src/pipeline.ts`

Before the AI merge step, snapshot the regex neighborhood:
```typescript
const regexNeighborhood = extraction.location?.neighborhood ?? null;
```

After the AI merge, determine source:
```typescript
const aiSetNeighborhood = !regexNeighborhood && !!(extraction.location?.neighborhood);
let neighborhoodSource: string | null =
  regexNeighborhood ? 'regex' : (aiSetNeighborhood ? 'ai' : null);
```

Add `neighborhoodSource` to the `listingRow` build: `neighborhood_source: neighborhoodSource`.

Add `geocodeMetrics` to `ProcessingResult` interface.

**Verify:** `pnpm test` passes. In the test where a listing has a regex-extracted neighborhood, the result's `neighborhood_source` is `'regex'`. (Add a new assertion to an existing pipeline test.)

---

### T10 — Pipeline: Step 5c geocoder call

**File:** `apps/processor/src/pipeline.ts`

After the AI merge and before duplicate detection:

1. If `config.geocoderConfig` is set AND `neighborhoodSource` is still null:
   - Construct `dbNeighborhoodCache` adapter from `db` (wraps `getCachedNeighborhood` / `setCachedNeighborhood`)
   - Call `resolveNeighborhood(...)` with budget counter
   - If resolved: update `extraction.location.neighborhood`, set `neighborhoodSource = resolved.source`
   - If 429 response signalled (budget forcibly zeroed): log `geocode_rate_limited_batch_stop`

2. Add per-batch budget counter to `processBatch`:
```typescript
let geocodeBudgetUsed = 0;
const budget = config.geocoderConfig?.budget ?? 0;
```

3. Add `geocodeMetrics` to result.

**Verify:** Two new pipeline tests:
- Batch of 3 listings needing geocoding with budget=2 → 2 resolved, 1 skipped (`geocodeMetrics.misses = 2`, `budgetExhausted = true`)
- Geocoder disabled (no `geocoderConfig`) → zero fetch calls, all pass through

---

### T11 — `apps/processor/src/index.ts`: wire geocoder config from env

**File:** `apps/processor/src/index.ts`

Read `NEIGHBORHOOD_GEOCODER_BUDGET` and `NEIGHBORHOOD_GEOCODER_USER_AGENT` from `env`. If `NEIGHBORHOOD_GEOCODER_USER_AGENT` is set, build `geocoderConfig`; otherwise leave undefined (feature is off).

**Verify:** `pnpm typecheck` passes. Local `wrangler dev` starts without errors.

---

### T12 — `apps/processor/wrangler.json`: add geocoder env vars

```json
"NEIGHBORHOOD_GEOCODER_BUDGET": "30",
"NEIGHBORHOOD_GEOCODER_USER_AGENT": "rentifier-processor/1.0 (+https://github.com/oricho123/rentifier)"
```

**Verify:** `pnpm typecheck` passes. `wrangler deploy --dry-run` (if available) shows the new vars.

---

## Group 4 — Backfill script

### T13 — `scripts/backfill-neighborhoods.ts`

Implements P1b from the spec. Uses D1 REST client (for remote) or local proxy.

CLI args: `--since=YYYY-MM-DD` (required), `--dry-run`, `--batch=50`, `--delay=1200`

Flow:
1. Fetch page of listings where `neighborhood IS NULL AND ingested_at >= since` via D1 REST
2. For each: call `resolveNeighborhood()` with an in-memory cache backed by a local Map (pre-warm from `neighborhood_cache` table at start), then write through to D1 `neighborhood_cache`
3. If not `--dry-run`: `updateListingNeighborhood(id, neighborhood, source)`
4. Sleep `--delay` ms between external calls
5. Print running counters every 100 listings; final summary: total scanned, filled_coords, filled_street, still_null

**Verify:**
- `pnpm tsx --env-file=.env scripts/backfill-neighborhoods.ts --since=2026-01-01 --dry-run` prints summary, no D1 writes.
- `pnpm typecheck` passes on the script.

---

## Group 5 — Tests, cleanup, deploy

### T14 — Full test suite green

Run `pnpm test` after T01–T13 are complete.

Expected additions to test counts:
- `nominatim-resolver.test.ts`: ~10 unit tests
- `pipeline.test.ts`: ~2 new integration tests
- Total: all previously passing tests + ~12 new

**Verify:** `pnpm test` shows all tests passing. Zero TypeScript errors from `pnpm typecheck`.

---

### T15 — Apply migrations to production D1

```bash
pnpm db:migrate:remote
```

Then verify:
```bash
pnpm db:query:remote "PRAGMA table_info(listings)" | grep neighborhood_source
pnpm db:query:remote "SELECT name FROM sqlite_master WHERE type='table' AND name='neighborhood_cache'"
```

**Verify:** Both queries return the expected output.

---

### T16 — Deploy processor Worker

```bash
pnpm deploy:processor
```

Monitor the first cron run (~15 min after deploy) in Cloudflare dashboard logs for:
- `event: "batch_start"` present
- `event: "geocode_cache_miss"` entries (expected on cold cache)
- No `event: "item_failed"` errors caused by new code

**Verify:** After first cron, query production:
```sql
SELECT neighborhood_source, COUNT(*) FROM listings
WHERE ingested_at > datetime('now', '-1 hour')
GROUP BY 1;
```
Expect `coords_live` and/or `street_live` rows to appear.

---

### T17 — Run backfill against production

```bash
# Dry run first
pnpm tsx --env-file=.env scripts/backfill-neighborhoods.ts --since=2026-01-26 --dry-run

# Execute (takes ~30-60 min depending on cache hit rate)
pnpm tsx --env-file=.env scripts/backfill-neighborhoods.ts --since=2026-01-26
```

**Verify:** Final summary printed. Then query:
```sql
SELECT
  neighborhood_source,
  COUNT(*) AS n,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct
FROM listings
WHERE ingested_at >= '2026-01-26'
GROUP BY 1
ORDER BY n DESC;
```

---

### T18 — Measure coverage against spec targets

7 days after deploy, run the baseline query for the success criteria:

```sql
SELECT
  s.name AS source,
  COUNT(*) AS total,
  SUM(CASE WHEN l.neighborhood IS NOT NULL THEN 1 ELSE 0 END) AS with_neighborhood,
  ROUND(100.0 * SUM(CASE WHEN l.neighborhood IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 1) AS pct
FROM listings l
JOIN sources s ON s.id = l.source_id
WHERE l.ingested_at >= datetime('now', '-7 days')
GROUP BY s.name;
```

**Spec targets:** Yad2 ≥ 90%, Facebook ≥ 70%.

If either target is missed: check `neighborhood_alias_candidate` log events in Cloudflare dashboard; add missing aliases to `CITY_NEIGHBORHOODS`; re-run backfill.

---

## Dependency Order

```
T01 → T02 → T03 → T04
                   ↓
T05 → T06 → T07
                   ↓
T08 → T09 → T10 → T11 → T12
                   ↓
                  T13
                   ↓
                  T14 → T15 → T16 → T17 → T18
```

T01–T04 (schema) and T05–T07 (resolver) can be worked in parallel since they have no shared files.
T08–T12 (pipeline) depend on both groups finishing.
