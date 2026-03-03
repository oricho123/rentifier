# Cross-Source Duplicate Detection — Design

## Overview

Add a `duplicate_of` column to the `listings` table. During processing, after extraction, query for existing canonical listings with matching fields. If a match is found, mark the new listing as a duplicate. The notify worker filters out duplicates with a single `WHERE` clause change.

## Architecture

```
                          Processor Pipeline (per listing)
                          ┌──────────────────────────────┐
                          │ 1. Parse raw JSON            │
                          │ 2. Skip search posts         │
                          │ 3. Normalize (connector)     │
                          │ 4. Extract (regex + AI)      │
                          │ 5. ★ Find duplicate ★        │
                          │ 6. Upsert listing            │
                          │ 7. Mark raw processed        │
                          └──────────────────────────────┘
                                      │
                                      ▼
                          ┌──────────────────────────────┐
                          │ findDuplicate(db, listing)    │
                          │                              │
                          │ SELECT candidates WHERE      │
                          │   city = ? AND bedrooms = ?  │
                          │   AND price BETWEEN ? AND ?  │
                          │   AND duplicate_of IS NULL   │
                          │                              │
                          │ For each candidate:          │
                          │   score = matchScore(a, b)   │
                          │   if score >= threshold →    │
                          │     return candidate.id      │
                          └──────────────────────────────┘
```

## Schema Changes

### Migration 0013: `duplicate_of` column

```sql
-- Add duplicate tracking to listings
ALTER TABLE listings ADD COLUMN duplicate_of INTEGER REFERENCES listings(id);

-- Partial index for fast candidate lookups (only canonical listings)
CREATE INDEX idx_listings_dedup
  ON listings(city, bedrooms, price)
  WHERE duplicate_of IS NULL;
```

### Schema type update

```typescript
// packages/db/src/schema.ts — ListingRow
export interface ListingRow {
  // ... existing fields ...
  duplicate_of: number | null;  // NEW — null = canonical, non-null = duplicate of listing ID
}
```

## Matching Algorithm

### `findDuplicate()`

New function in `packages/db/src/queries.ts`:

```typescript
interface DuplicateCandidate {
  id: number;
  source_id: number;
  street: string | null;
  house_number: string | null;
  neighborhood: string | null;
  latitude: number | null;
  longitude: number | null;
}

async findDuplicate(listing: {
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
}): Promise<number | null>
```

**Query:**
```sql
SELECT id, source_id, street, house_number, neighborhood, latitude, longitude
FROM listings
WHERE city = ?
  AND bedrooms = ?
  AND price BETWEEN ? AND ?          -- ±10%
  AND duplicate_of IS NULL           -- only match against canonical listings
  AND NOT (source_id = ? AND source_item_id = ?)  -- don't match self
LIMIT 20
```

**Scoring — `matchScore()`:**

Pure function in a new module `packages/extraction/src/dedup.ts`:

```typescript
export interface DedupFields {
  street: string | null;
  house_number: string | null;
  neighborhood: string | null;
  latitude: number | null;
  longitude: number | null;
  price: number | null;
}

export function matchScore(a: DedupFields, b: DedupFields): number
```

Score accumulates points. Threshold to declare duplicate: **2.0**

| Condition | Points | Rationale |
|-----------|--------|-----------|
| Same street (normalized) + same house_number | 3.0 | Strong — exact address match |
| Same street (normalized), no house_number | 1.5 | Partial address |
| Same neighborhood + price within 5% | 1.5 | Strong neighborhood + tight price |
| Same neighborhood only | 0.5 | Weak — many apartments share neighborhood |
| Coordinates within 50m | 2.0 | Strong — geographic proximity |
| Price within 3% (tighter than the 10% gate) | 0.5 | Bonus for very close prices |

**Street normalization** for comparison:
- Strip leading `רחוב`/`רח'` prefix
- Trim whitespace
- Lowercase (for English street names)

**Coordinate distance** — Haversine approximation:
```typescript
function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  // Simplified flat-earth approximation (valid for <1km distances in Israel ~32°N)
  const dlat = (lat2 - lat1) * 111320;
  const dlon = (lon2 - lon1) * 111320 * Math.cos(lat1 * Math.PI / 180);
  return Math.sqrt(dlat * dlat + dlon * dlon);
}
```

### Source Priority — `swapCanonical()`

When a YAD2 listing matches an existing Facebook canonical:

```typescript
async swapCanonical(newCanonicalId: number, oldCanonicalId: number): Promise<void>
```

1. Update old canonical: `SET duplicate_of = newCanonicalId`
2. Update new listing: `SET duplicate_of = NULL` (already the default)
3. Update any other listings pointing to old canonical: `SET duplicate_of = newCanonicalId`

**Source priority constant:**
```typescript
const SOURCE_PRIORITY: Record<string, number> = {
  facebook: 100,
  yad2: 50,
  mock: 0,
};
```

Higher priority wins canonical status.

## Processor Integration

In `apps/processor/src/pipeline.ts`, add step 5a between extraction and upsert:

```typescript
// Step 5a: Check for cross-source duplicate
let duplicateOf: number | null = null;

const dedupFields = {
  city: listingRow.city,
  bedrooms: listingRow.bedrooms,
  price: listingRow.price,
  street: listingRow.street,
  house_number: listingRow.house_number,
  neighborhood: listingRow.neighborhood,
  latitude: listingRow.latitude,
  longitude: listingRow.longitude,
  source_id: raw.source_id,
  source_item_id: raw.source_item_id,
};

// Only run dedup when we have enough fields to match
if (dedupFields.city && dedupFields.bedrooms != null && dedupFields.price != null) {
  const match = await db.findDuplicate(dedupFields);

  if (match) {
    const matchSource = await db.getSourceById(match.sourceId);
    const currentSource = source;

    const matchPriority = SOURCE_PRIORITY[matchSource?.name ?? ''] ?? 0;
    const currentPriority = SOURCE_PRIORITY[currentSource?.name ?? ''] ?? 0;

    if (currentPriority > matchPriority) {
      // New listing has higher priority — swap canonical
      await db.swapCanonical(/* will get ID after upsert */, match.id);
      duplicateOf = null; // new listing becomes canonical
    } else {
      duplicateOf = match.id;
    }
  }
}

// Add to listing row before upsert
listingRow.duplicate_of = duplicateOf;
```

**Swap handling note:** Since `upsertListing` returns the new listing's ID, the swap must happen after upsert:

```typescript
const newId = await db.upsertListing(listingRow);

if (shouldSwapCanonical) {
  await db.swapCanonical(newId, match.id);
}
```

## Notify Worker Changes

### `getNewListingsSince()` — filter duplicates

In `packages/db/src/queries.ts`, update the query:

```sql
-- Before:
SELECT * FROM listings WHERE datetime(ingested_at) > datetime(?) ORDER BY ingested_at DESC

-- After:
SELECT * FROM listings
WHERE datetime(ingested_at) > datetime(?)
  AND duplicate_of IS NULL
ORDER BY ingested_at DESC
```

This single change prevents all duplicate notifications. No changes needed to `matchesFilter()`, `NotificationService`, or the Telegram formatter.

## File Changes Summary

| File | Change |
|------|--------|
| `packages/db/migrations/0013_duplicate_detection.sql` | New migration: `duplicate_of` column + partial index |
| `packages/db/src/schema.ts` | Add `duplicate_of` to `ListingRow` |
| `packages/db/src/queries.ts` | Add `findDuplicate()`, `swapCanonical()`, update `getNewListingsSince()`, update `upsertListing()` |
| `packages/extraction/src/dedup.ts` | New: `matchScore()`, `normalizeStreet()`, `distanceMeters()` |
| `packages/extraction/src/index.ts` | Re-export dedup functions |
| `apps/processor/src/pipeline.ts` | Add dedup step between extraction and upsert |

## Testing Strategy

### Unit tests — `dedup.test.ts`

| Test | Description |
|------|-------------|
| Same street + house number | Score ≥ 2.0 → duplicate |
| Same street, no house number | Score = 1.5 → not duplicate alone |
| Same neighborhood + tight price | Score ≥ 2.0 → duplicate |
| Same neighborhood only | Score = 0.5 → not duplicate |
| Close coordinates (<50m) | Score ≥ 2.0 → duplicate |
| Different city | Not even queried |
| Different bedrooms | Not even queried |
| Price >10% apart | Not even queried |
| Same source | Excluded from candidates |
| Street normalization | `רחוב הרצל` = `הרצל` |

### Integration tests — `pipeline.test.ts`

| Test | Description |
|------|-------------|
| YAD2 then Facebook same apartment | Facebook gets `duplicate_of = yad2_id` |
| Facebook then YAD2 same apartment | YAD2 becomes canonical, Facebook swapped |
| Two Facebook same apartment | Later one gets `duplicate_of` |
| Different apartments same building | Both canonical (different bedrooms/price) |

### Notify tests — `notification-service.test.ts`

| Test | Description |
|------|-------------|
| Duplicate listing not in results | `getNewListingsSince` excludes `duplicate_of IS NOT NULL` |

## Performance Analysis

**Per-listing overhead:**
- 1 SQL query (indexed, ~1ms)
- 0-20 `matchScore()` calls (pure math, <0.1ms each)
- Rare: 1-2 swap UPDATE queries (~1ms each)

**Per-batch (50 listings):**
- ~50ms total added to processor batch
- Well within Workers' CPU limits

**Index usage:**
- `idx_listings_dedup` partial index on `(city, bedrooms, price) WHERE duplicate_of IS NULL`
- Eliminates full table scan; candidate set is small (same city + bedrooms + similar price)
