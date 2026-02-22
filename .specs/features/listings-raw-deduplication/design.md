# listings_raw Deduplication - Design

**Feature:** Handle listing updates in listings_raw
**Status:** Design
**Created:** 2026-02-22

## The Simple Solution: Always Update and Re-Process ⭐ RECOMMENDED

**Approach:**
```sql
INSERT INTO listings_raw (source_id, source_item_id, url, raw_json)
VALUES (?, ?, ?, ?)
ON CONFLICT(source_id, source_item_id) DO UPDATE SET
  url = excluded.url,
  raw_json = excluded.raw_json,
  fetched_at = datetime('now'),
  processed_at = NULL  -- Always reset, always re-process
```

### Why This Works

**The key insight:** The processor's upsert to canonical `listings` is already idempotent!

```sql
-- In processor (queries.ts:76-100)
INSERT INTO listings (source_id, source_item_id, title, price, ...)
VALUES (?, ?, ?, ?, ...)
ON CONFLICT(source_id, source_item_id) DO UPDATE SET
  title = excluded.title,
  price = excluded.price,
  ...
```

**What happens:**
1. Collector re-fetches listing → UPDATE listings_raw, reset processed_at=NULL
2. Processor processes it → upserts to canonical listings
3. If content unchanged: upsert updates row with same values (harmless)
4. If content changed: upsert updates row with new values ✅

**"Waste" analysis:**
- Processor re-runs extraction even if listing unchanged
- With 50 items per batch, ~10-20 API calls from same source per run
- Most are probably unchanged (listings don't update daily)
- So maybe 40/50 are "wasted" re-processing

**But:**
- Each extraction is <1ms (regex matching)
- Total "waste": ~40ms per processor run
- Cost: negligible
- Benefit: Zero complexity, guaranteed correctness

## Alternative: Smart Detection (More Complex)

If you really want to skip re-processing unchanged listings, here are simpler options than SHA-256:

### Option A: Simple Concatenation Hash

```typescript
function makeContentKey(candidate: ListingCandidate): string {
  return `${candidate.price}_${candidate.title}_${candidate.bedrooms}`;
}
```

**Pros:**
- Super simple
- No crypto library needed
- Fast

**Cons:**
- Need to add `content_key` column to DB
- More code in collector

### Option B: JSON String Comparison

```sql
ON CONFLICT(source_id, source_item_id) DO UPDATE SET
  url = excluded.url,
  raw_json = excluded.raw_json,
  fetched_at = datetime('now'),
  processed_at = CASE
    WHEN listings_raw.raw_json = excluded.raw_json THEN listings_raw.processed_at
    ELSE NULL
  END
```

**Pros:**
- No extra column needed
- Works at SQL level

**Cons:**
- JSON formatting matters (whitespace, key order)
- May miss changes if source changes JSON format
- May detect "changes" that aren't real (reformatting)

### Option C: Use Source's Updated Timestamp (If Available)

Some APIs provide "updated_at":
```json
{
  "id": "12345",
  "updated_at": "2026-02-22T10:30:00Z",
  "title": "3br apartment",
  "price": 4500
}
```

**Approach:**
- Store `source_updated_at` in listings_raw
- Only reset processed_at if source_updated_at changed

**Pros:**
- Authoritative (source tells us when it changed)
- Zero false positives

**Cons:**
- Not all sources provide this (YAD2 API might not have it)
- Requires schema change

## Recommendation

**Use the Simple Solution: Always Update and Re-Process**

**Rationale:**
1. **Simplicity:** Zero additional code, zero new columns, zero complexity
2. **Correctness:** Guaranteed to catch all changes
3. **Performance:** "Waste" is <40ms per run, totally negligible
4. **Maintenance:** Less code = less bugs
5. **Cloudflare-friendly:** Total processing time still well under CPU limits

**When to revisit:**
- If processing 1000s of listings per run and hitting CPU limits
- If extraction becomes expensive (e.g., adding AI-based extraction)
- For now: YAGNI (You Aren't Gonna Need It)

## Implementation

### Migration 0008

**Not needed!** We already have the UNIQUE constraint. Just change the conflict resolution.

### Code Change: queries.ts

**Before:**
```typescript
async insertRawListings(listings: Omit<ListingRaw, 'id' | 'fetched_at' | 'processed_at'>[]): Promise<void> {
  if (listings.length === 0) return;

  const stmt = d1.prepare(
    'INSERT INTO listings_raw (source_id, source_item_id, url, raw_json) VALUES (?, ?, ?, ?)'
  );

  const batch = listings.map(l => stmt.bind(l.source_id, l.source_item_id, l.url, l.raw_json));
  await d1.batch(batch);
}
```

**After:**
```typescript
async insertRawListings(listings: Omit<ListingRaw, 'id' | 'fetched_at' | 'processed_at'>[]): Promise<void> {
  if (listings.length === 0) return;

  const stmt = d1.prepare(
    `INSERT INTO listings_raw (source_id, source_item_id, url, raw_json)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(source_id, source_item_id) DO UPDATE SET
       url = excluded.url,
       raw_json = excluded.raw_json,
       fetched_at = datetime('now'),
       processed_at = NULL`
  );

  const batch = listings.map(l => stmt.bind(l.source_id, l.source_item_id, l.url, l.raw_json));
  await d1.batch(batch);
}
```

**That's it!** No migration needed, just change the INSERT statement.

## Testing

**Test Case 1: New Listing**
- Collector fetches listing #12345 (first time)
- listings_raw: 1 row inserted, processed_at=NULL
- Processor: processes it, sets processed_at
- ✅ Expected behavior

**Test Case 2: Unchanged Listing**
- Collector re-fetches #12345 (no changes)
- listings_raw: UPDATE (url, raw_json, fetched_at updated, processed_at=NULL)
- Processor: re-processes, upserts to listings with same values
- ✅ Result: canonical table unchanged, but re-processing happened (harmless)

**Test Case 3: Updated Listing (Price Change)**
- Collector re-fetches #12345 (price 5000→4500)
- listings_raw: UPDATE, processed_at=NULL
- Processor: re-processes, upserts to listings with new price
- ✅ Result: canonical table updated, users see new price

**Test Case 4: Multiple Re-Fetches**
- Collector runs 3 times, same listing
- Each run: UPDATE, processed_at=NULL
- Processor runs after each: re-processes each time
- ✅ Result: works correctly, some wasted cycles but harmless

## Performance Impact

**Before (ON CONFLICT IGNORE):**
- Collector: 200 listings → 200 INSERT attempts → 150 ignored (already exist) → 50 new rows
- Processor: processes 50 new rows

**After (ON CONFLICT UPDATE):**
- Collector: 200 listings → 200 UPSERT → 50 INSERT, 150 UPDATE
- Processor: processes 200 rows (50 new + 150 updated)

**Difference:**
- Processor does 150 extra items per run
- At <1ms per item: +150ms per processor run
- Still well under CPU limits

**Trade-off:** +150ms processing time vs guaranteed update detection = worth it!

## Future Optimization (If Needed)

If processing becomes a bottleneck later:

**Phase 2: Add last_modified tracking**
1. Add `source_last_modified` column (if source provides it)
2. Only reset processed_at if source_last_modified changed
3. Saves re-processing unchanged listings

**Phase 3: Content hash**
1. Add `content_hash` column
2. Compute simple hash: `${price}_${title}`
3. Only reset processed_at if hash changed

**For now: Ship the simple solution!**
