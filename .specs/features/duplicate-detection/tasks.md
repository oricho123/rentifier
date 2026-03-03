# Cross-Source Duplicate Detection — Tasks

## Task 1: Migration + Schema Type

**Files:**
- `packages/db/migrations/0013_duplicate_detection.sql`
- `packages/db/src/schema.ts`

**Work:**
1. Create migration:
   ```sql
   ALTER TABLE listings ADD COLUMN duplicate_of INTEGER REFERENCES listings(id);
   CREATE INDEX idx_listings_dedup ON listings(city, bedrooms, price) WHERE duplicate_of IS NULL;
   ```
2. Add `duplicate_of: number | null` to `ListingRow` interface

**Verification:**
- [ ] `pnpm db:migrate:local` succeeds
- [ ] `pnpm typecheck` passes — any code referencing `ListingRow` without `duplicate_of` must be updated

**Depends on:** nothing

---

## Task 2: Dedup Matching Module

**Files:**
- `packages/extraction/src/dedup.ts` (new)
- `packages/extraction/src/index.ts` (re-export)
- `packages/extraction/src/__tests__/dedup.test.ts` (new)

**Work:**
1. Create `dedup.ts` with:
   - `normalizeStreet(street: string): string` — strip `רחוב`/`רח'` prefix, trim, lowercase
   - `distanceMeters(lat1, lon1, lat2, lon2): number` — flat-earth approximation
   - `DedupFields` interface: `{ street, house_number, neighborhood, latitude, longitude, price }`
   - `matchScore(a: DedupFields, b: DedupFields): number` — scoring per design doc
   - `DEDUP_THRESHOLD = 2.0` constant
2. Re-export from `index.ts`
3. Write tests:
   - Same street + house number → score ≥ 2.0
   - Same street, no house number → score = 1.5
   - Same neighborhood + price within 5% → score ≥ 2.0
   - Same neighborhood only → score = 0.5
   - Coordinates within 50m → score ≥ 2.0
   - Coordinates >50m apart → score = 0
   - Street normalization: `רחוב הרצל` → `הרצל`, `רח' דיזנגוף` → `דיזנגוף`
   - Price within 3% bonus → adds 0.5
   - All nulls → score = 0

**Verification:**
- [ ] All dedup tests pass
- [ ] `pnpm typecheck` passes

**Depends on:** nothing

---

## Task 3: DB Query Methods

**Files:**
- `packages/db/src/queries.ts`

**Work:**
1. Add `findDuplicate()` to `DB` interface and `createDB()`:
   ```typescript
   findDuplicate(listing: {
     city: string | null;
     bedrooms: number | null;
     price: number | null;
     street: string | null;
     house_number: string | null;
     neighborhood: string | null;
     latitude: number | null;
     longitude: number | null;
     source_id: number;
     source_item_id: string;
   }): Promise<{ id: number; sourceId: number; street: string | null; house_number: string | null; neighborhood: string | null; latitude: number | null; longitude: number | null; price: number | null } | null>
   ```
   - Return null if city/bedrooms/price are null (can't match)
   - Query canonical listings with city + bedrooms + price ±10%
   - Import and use `matchScore()` + `DEDUP_THRESHOLD` to filter candidates
   - Return first match above threshold (or null)

2. Add `swapCanonical()` to `DB` interface and `createDB()`:
   ```typescript
   swapCanonical(newCanonicalId: number, oldCanonicalId: number): Promise<void>
   ```
   - Update old canonical: `SET duplicate_of = newCanonicalId`
   - Update any listings pointing to old canonical: `SET duplicate_of = newCanonicalId`

3. Update `getNewListingsSince()` query:
   ```sql
   -- Add: AND duplicate_of IS NULL
   SELECT * FROM listings
   WHERE datetime(ingested_at) > datetime(?)
     AND duplicate_of IS NULL
   ORDER BY ingested_at DESC
   ```

4. Update `upsertListing()`:
   - Add `duplicate_of` to INSERT column list and VALUES
   - Add `duplicate_of = excluded.duplicate_of` to ON CONFLICT UPDATE

**Verification:**
- [ ] `pnpm typecheck` passes
- [ ] Existing tests still pass (upsertListing signature change may require test updates)

**Depends on:** Task 1 (schema type), Task 2 (matchScore import)

---

## Task 4: Processor Pipeline Integration

**Files:**
- `apps/processor/src/pipeline.ts`

**Work:**
1. Import `matchScore`, `DEDUP_THRESHOLD` from `@rentifier/extraction`
2. Define `SOURCE_PRIORITY` constant: `{ yad2: 100, facebook: 50, mock: 0 }`
3. After extraction (step 5) and before upsert (step 6), add dedup step:
   - Skip if city/bedrooms/price are null
   - Call `db.findDuplicate()` with extracted fields
   - If match found:
     - Compare source priorities
     - If new listing has higher priority: upsert first, then `db.swapCanonical(newId, match.id)`
     - If new listing has lower/equal priority: set `listingRow.duplicate_of = match.id`
   - If no match: `duplicate_of` stays null
4. Add `duplicate_of` to the `listingRow` object (default null)
5. Log dedup events:
   ```json
   { "event": "duplicate_found", "sourceItemId": "...", "duplicateOf": 123, "swapped": false }
   { "event": "duplicate_swapped", "newCanonical": 456, "oldCanonical": 123 }
   ```

**Verification:**
- [ ] `pnpm typecheck` passes
- [ ] Processor handles listings without matches (no regression)
- [ ] Processor handles listings with matches (sets duplicate_of)

**Depends on:** Task 1, Task 2, Task 3

---

## Task 5: Integration Tests

**Files:**
- `apps/processor/src/__tests__/pipeline.test.ts` (update or new dedup section)
- `apps/notify/src/__tests__/notification-service.test.ts` (update)

**Work:**
1. Pipeline dedup tests:
   - YAD2 listing processed, then Facebook listing with same city+bedrooms+street+price → Facebook gets `duplicate_of`
   - Facebook listing processed, then YAD2 listing with same fields → swap: YAD2 becomes canonical
   - Two listings, same neighborhood but different street and price >10% apart → both canonical
   - Listing with null city → dedup skipped, stays canonical
   - Listing with null price → dedup skipped, stays canonical

2. Notification service tests:
   - Listing with `duplicate_of IS NOT NULL` → not included in `getNewListingsSince` results
   - Canonical listing → included normally

**Verification:**
- [ ] All new tests pass
- [ ] All existing 267 tests still pass
- [ ] `pnpm typecheck` passes
- [ ] Zero test regressions

**Depends on:** Task 4

---

## Task 6: Update Specs + Deploy

**Files:**
- `.specs/project/STATE.md`
- `.specs/project/ROADMAP.md`

**Work:**
1. Update ROADMAP: Duplicate Detection → COMPLETE
2. Update STATE with completion details
3. Run `pnpm db:migrate:remote` (migration 0013)
4. Deploy processor: `pnpm deploy:processor`
5. Verify in production: check processor logs for dedup events

**Verification:**
- [ ] Migration 0013 applied to production D1
- [ ] Processor deployed with dedup logic
- [ ] No errors in Cloudflare dashboard logs

**Depends on:** Task 5

---

## Summary

| Task | Description | Depends on | Files |
|------|------------|------------|-------|
| 1 | Migration + schema type | — | 2 |
| 2 | Dedup matching module + tests | — | 3 |
| 3 | DB query methods | 1, 2 | 1 |
| 4 | Processor pipeline integration | 1, 2, 3 | 1 |
| 5 | Integration tests | 4 | 2 |
| 6 | Update specs + deploy | 5 | 2 |

Tasks 1 and 2 can run **in parallel** (no dependencies between them). Tasks 3-6 are sequential.
