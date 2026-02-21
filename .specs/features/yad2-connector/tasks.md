# Yad2 Connector — Tasks

## T1: Create Yad2 API types

**File:** `packages/connectors/src/yad2/types.ts`
**Depends on:** None

Create TypeScript interfaces for the Yad2 API response:
- `Yad2ApiResponse` — top-level response with `data.markers[]`
- `Yad2Marker` — single listing marker with `orderId`, `token`, `price`, `address` (city/area/neighborhood/street/house/coords), `additionalDetails` (roomsCount, squareMeter, property, propertyCondition), `metaData` (coverImage, images)
- `Yad2CursorState` — persisted cursor state with `lastFetchedAt`, `knownOrderIds` (string[], capped at 500), `consecutiveFailures`, `circuitOpenUntil`, `lastCityIndex`

**Verify:** File exists and exports all three interfaces. `pnpm typecheck` passes.

---

## T2: Create Yad2 constants

**File:** `packages/connectors/src/yad2/constants.ts`
**Depends on:** None

Define constants:
- `YAD2_API_BASE` — `'https://gw.yad2.co.il/realestate-feed/rent/map'`
- `YAD2_HEADERS` — Record of required HTTP headers (Accept, Origin, Referer, User-Agent, Sec-Fetch-*)
- `YAD2_CITY_CODES` — Record mapping Hebrew city names to Yad2 numeric city IDs (start with Tel Aviv, Jerusalem, Haifa, Herzliya, Ramat Gan, Givatayim, Beer Sheva, Netanya, Rishon LeZion, Petah Tikva)
- `MAX_CONSECUTIVE_FAILURES` — `5`
- `CIRCUIT_OPEN_DURATION_MS` — `30 * 60 * 1000` (30 minutes)
- `MAX_RETRIES` — `3`
- `INITIAL_RETRY_DELAY_MS` — `1000`
- `REQUEST_TIMEOUT_MS` — `10_000`
- `MAX_KNOWN_ORDER_IDS` — `500`

**Verify:** File exists and exports all constants. `pnpm typecheck` passes.

---

## T3: Implement Yad2 HTTP client

**File:** `packages/connectors/src/yad2/client.ts`
**Depends on:** T1, T2

Implement the HTTP client layer:

1. `Yad2ApiError` class extending `Error` with fields: `statusCode` (number | null), `errorType` ('network' | 'captcha' | 'http' | 'parse' | 'timeout'), `retryable` (boolean)
2. `fetchYad2Listings(cityCode: number)` function:
   - Build URL: `YAD2_API_BASE` + query params (`city={cityCode}`, `priceOnly=1`, `zoom=11`)
   - Create `AbortController` with `REQUEST_TIMEOUT_MS` timeout
   - Call `fetch()` with `YAD2_HEADERS` and abort signal
   - On non-OK response: throw `Yad2ApiError` with `retryable: status >= 500`
   - Parse JSON — if parse fails, check response text for `"Radware Bot Manager Captcha"` → throw captcha error (not retryable)
   - Validate `data.markers` exists in response
   - Return typed `Yad2ApiResponse`
   - On fetch error (network): throw `Yad2ApiError` with `retryable: true`
   - On abort: throw `Yad2ApiError` with `errorType: 'timeout'`, `retryable: true`
3. `fetchWithRetry(cityCode: number, maxRetries?: number)` function:
   - Loop up to `maxRetries` attempts
   - On retryable error: wait `INITIAL_RETRY_DELAY_MS * 2^attempt` ms, then retry
   - On non-retryable error (captcha, 4xx): throw immediately
   - Log each attempt and failure as structured JSON

**Verify:** `pnpm typecheck` passes. Unit test with mocked fetch (T8).

---

## T4: Implement Yad2Connector class

**File:** `packages/connectors/src/yad2/index.ts`
**Depends on:** T1, T2, T3

Implement `Yad2Connector` class:

1. `sourceId = 'yad2'`, `sourceName = 'Yad2'`
2. `fetchNew(cursor: string | null): Promise<FetchResult>`:
   - Parse `cursor` as `Yad2CursorState` (or create default state if null)
   - **Circuit breaker check:** if `circuitOpenUntil` is in the future, log and return `{ candidates: [], nextCursor: cursor }` (skip this source)
   - If circuit was open but cooldown expired, reset `consecutiveFailures` to 0
   - Determine which city to fetch: use `lastCityIndex` to round-robin through `Object.values(YAD2_CITY_CODES)`, increment modulo city count
   - Call `fetchWithRetry(cityCode)`
   - Filter markers: remove any with `orderId` in `knownOrderIds`
   - Map new markers to `ListingCandidate[]`:
     - `source: 'yad2'`
     - `sourceItemId: marker.orderId`
     - `rawTitle`: construct from city + rooms + price (e.g., "דירת 3 חדרים בתל אביב - 5,000 ₪")
     - `rawDescription`: construct from street + neighborhood + sqm
     - `rawUrl`: `https://www.yad2.co.il/realestate/item/${marker.token}`
     - `rawPostedAt: null` (API doesn't provide post date)
     - `sourceData`: full marker object
   - Update cursor state: add new orderIds to `knownOrderIds` (cap at `MAX_KNOWN_ORDER_IDS`, FIFO), set `lastFetchedAt`, reset `consecutiveFailures` to 0, clear `circuitOpenUntil`
   - Return `{ candidates, nextCursor: JSON.stringify(updatedState) }`
   - **On error:** increment `consecutiveFailures`, if >= `MAX_CONSECUTIVE_FAILURES` set `circuitOpenUntil` to now + `CIRCUIT_OPEN_DURATION_MS`. Return `{ candidates: [], nextCursor: JSON.stringify(updatedState) }`
3. `normalize(candidate: ListingCandidate): ListingDraft`:
   - Cast `candidate.sourceData` to `Partial<Yad2Marker>`
   - Extract price directly (always ILS, always monthly for rentals)
   - Extract rooms from `additionalDetails.roomsCount`
   - Extract city from `address.city.text`
   - Extract neighborhood from `address.neighborhood.text`
   - Derive tags from property type, condition, floor, image count
   - Return `ListingDraft`
4. Private `extractTags(marker)` helper:
   - Property type mapping (דירה, גן, פנטהאוז, etc.) → tags
   - Condition mapping (id 1-5) → "new"/"renovated"/"needs-renovation" tags
   - Floor-based tags: ground floor, high floor (>5)
   - "has-images" if images array is non-empty

**Verify:** `pnpm typecheck` passes. Connector can be instantiated and methods called.

---

## T5: Update barrel exports

**File:** `packages/connectors/src/index.ts`
**Depends on:** T4

Add `Yad2Connector` to the barrel export:

```typescript
export { Yad2Connector } from './yad2';
```

**Verify:** `import { Yad2Connector } from '@rentifier/connectors'` resolves. `pnpm typecheck` passes.

---

## T6: Register Yad2 in collector and processor

**Files:** `apps/collector/src/registry.ts`, `apps/processor/src/pipeline.ts`
**Depends on:** T5

1. In `apps/collector/src/registry.ts` `createDefaultRegistry()`:
   - Import `Yad2Connector` from `@rentifier/connectors`
   - Add `registry.register('yad2', new Yad2Connector())`
2. In `apps/processor/src/pipeline.ts` `createDefaultRegistry()`:
   - Import `Yad2Connector` from `@rentifier/connectors`
   - Add `registry.register('yad2', new Yad2Connector())`

**Verify:** `pnpm typecheck` passes across all workspaces.

---

## T7: Add Yad2 seed migration

**File:** `packages/db/migrations/0004_seed_yad2_source.sql`
**Depends on:** None

```sql
INSERT INTO sources (name, enabled) VALUES ('yad2', 1)
ON CONFLICT(name) DO NOTHING;
```

**Verify:** Migration file exists with valid SQL. Can be applied with `wrangler d1 migrations apply`.

---

## T8: Add Yad2 connector tests

**Files:** `packages/connectors/src/yad2/__tests__/client.test.ts`, `packages/connectors/src/yad2/__tests__/connector.test.ts`
**Depends on:** T4

### client.test.ts
1. Test `fetchYad2Listings` with mocked `fetch`:
   - Success case: returns valid `Yad2ApiResponse`
   - HTTP 500: throws retryable `Yad2ApiError`
   - HTTP 403: throws non-retryable `Yad2ApiError`
   - Captcha response: throws captcha `Yad2ApiError`
   - Network error: throws retryable `Yad2ApiError`
   - Timeout: throws timeout `Yad2ApiError`
2. Test `fetchWithRetry`:
   - Retries on retryable errors up to max
   - Does not retry captcha
   - Succeeds on second attempt after transient failure

### connector.test.ts
1. Test `fetchNew`:
   - With null cursor: creates default state, fetches first city
   - With existing cursor: resumes from `lastCityIndex`
   - Filters out known orderIds
   - Maps markers to ListingCandidate correctly
   - Circuit breaker: skips when open, resets after cooldown
   - On error: increments failure count, opens circuit after threshold
2. Test `normalize`:
   - Maps structured fields to ListingDraft
   - Handles missing optional fields (null price, null rooms)
   - Extracts tags from property type and condition
3. Test `extractTags`:
   - Derives correct tags from various marker configurations

**Verify:** All tests pass. `pnpm test` (or `vitest run`) exits 0.

---

## T9: Set up test infrastructure (if needed)

**Files:** `packages/connectors/package.json`, `packages/connectors/vitest.config.ts` (if not exists)
**Depends on:** None

If test runner is not yet configured:
1. Add `vitest` as devDependency to the connectors package (or root)
2. Add `"test": "vitest run"` script to `packages/connectors/package.json`
3. Create minimal `vitest.config.ts` if needed

**Verify:** `pnpm --filter @rentifier/connectors test` runs (even if no tests exist yet).

---

## T10: Update fetch-source to handle connector errors gracefully

**File:** `apps/collector/src/fetch-source.ts`
**Depends on:** T4

Review and update `fetchSource()` to ensure:
1. If the connector's `fetchNew()` throws, the error is caught and stored in `source_state.last_error`
2. If `fetchNew()` returns empty candidates (circuit breaker open), the fetch is still considered "successful" (no error state) but `fetchedCount` is 0
3. The cursor returned by the connector (which includes circuit breaker state) is always persisted via `db.updateSourceState()`, even on partial failure

**Verify:** `pnpm typecheck` passes. Collector handles both success and failure paths.

---

## Implementation Order

```
T1 (types) ──┐
T2 (constants)┼──▶ T3 (client) ──▶ T4 (connector) ──▶ T5 (exports) ──▶ T6 (registration)
              │                                                            │
T7 (migration)│                                                            ▼
              │                                              T10 (fetch-source update)
T9 (test infra)──────────────────▶ T8 (tests)
```

Tasks T1, T2, T7, and T9 can run in parallel (no dependencies).
T3 depends on T1+T2. T4 depends on T3. T5 depends on T4. T6 and T10 depend on T5.
T8 depends on T4 and T9.

---

## T11: Confirm actual Yad2 rental API endpoint — MANUAL

**Depends on:** T4
**Owner:** User (manual research)

The current implementation uses `https://gw.yad2.co.il/realestate-feed/rent/map` as the API base URL. This is inferred from the known sales endpoint (`/forsale/map`) — the actual rental endpoint may differ.

**Steps:**
1. Open Yad2 rental search in a browser: `https://www.yad2.co.il/realestate/rent`
2. Open browser DevTools → Network tab
3. Search for apartments in any city
4. Find the API call to `gw.yad2.co.il` and note the exact URL path
5. Update `YAD2_API_BASE` in `packages/connectors/src/yad2/constants.ts`
6. Verify the response shape matches `Yad2ApiResponse` — adjust field mappings if needed

**Verify:** Connector fetches real rental listings after endpoint update.

---

## T12: Add AI fallback for location extraction — FUTURE

**Files:** `packages/extraction/src/extractors.ts`, `apps/processor/src/pipeline.ts`
**Depends on:** T6

When the Yad2 connector provides listings without structured address data (or when the address fields are empty), and the rules-based extraction in `extractLocation()` also fails to find a city/neighborhood, attempt AI-based extraction from the description text.

**Approach:**
1. In the processor pipeline, after extraction: if `city` is null, invoke an AI classifier
2. Use Cloudflare Workers AI (free tier) or a simple keyword-frequency heuristic as a lightweight fallback
3. Parse description text for street names, landmark references, or area descriptions
4. Set a lower `relevance_score` for AI-extracted locations (confidence penalty)

**Note:** This is a future enhancement. The current implementation relies on Yad2's structured `address.city.text` field which should cover most listings. AI fallback is for edge cases where listings have location info only in free-text descriptions.

**Verify:** Listings with missing structured location data get location extracted from description text.
