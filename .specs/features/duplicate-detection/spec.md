# Cross-Source Duplicate Detection

## Problem

The same apartment is often listed on both YAD2 and Facebook Groups. Currently each source creates a separate row in the `listings` table (different `source_id` + `source_item_id`), so users receive duplicate notifications for the same physical apartment. This degrades the user experience and erodes trust in the bot's value.

### Evidence

With both YAD2 and Facebook connectors live, overlap is expected in Tel Aviv, Jerusalem, and Haifa — the three monitored cities. Landlords commonly cross-post on multiple platforms. A single apartment generating 2 notifications (one per source) is the most common duplicate scenario.

### Current Deduplication

The system already handles **within-source** dedup via `UNIQUE(source_id, source_item_id) ON CONFLICT IGNORE` in `listings_raw`. The `notifications_sent` table prevents the same `listing_id` from being sent twice to the same user. But two different `listing_id` rows for the same physical apartment bypass both checks.

## Goals

1. Detect when listings from different sources represent the same physical apartment
2. Prevent duplicate notifications — user sees the same apartment at most once
3. Keep the better/richer listing data (prefer structured YAD2 over free-text Facebook)
4. Minimal CPU overhead — must work within Cloudflare Workers' 10ms CPU limit

## Non-Goals

- Within-source dedup (already handled by UNIQUE constraint)
- Listing update detection (covered by `listings-raw-deduplication` spec)
- Fuzzy text matching / NLP similarity (too expensive for Workers)
- Merging listing data from multiple sources into a single enriched record (future)

## Detection Strategy

### Field-Based Matching (Phase 1)

Match listings across sources using deterministic field comparison. Two listings are considered duplicates when they share:

**Required match (ALL):**
- Same `city` (after normalization)
- Same `bedrooms` count (exact)
- Price within 10% tolerance (to account for rounding, fee inclusion)

**Plus at least ONE of:**
- Same `street` (after normalization) + same `house_number`
- Same `neighborhood` + price within 5%
- Same `latitude`/`longitude` within 50m radius (when available from YAD2)

### Why Not Text Similarity?

Content-based matching (Levenshtein, cosine similarity, embeddings) is attractive but:
- CPU-intensive — violates Workers' 10ms limit
- Hebrew text complicates tokenization
- Facebook posts are free-text vs. YAD2 structured → text looks very different even for the same apartment
- Field-based matching covers the most common case (same apartment, same basic facts)

### Edge Cases

| Scenario | Handling |
|----------|----------|
| Same apartment, different prices | 10% tolerance covers broker markup / rounding |
| Same apartment, missing fields on Facebook | Can't match if city/bedrooms/price are all null — no action |
| Different apartments at same address | Different bedrooms/price distinguishes them |
| Sublet re-listed as long-term | Different listing — allow both (different `listing_type` once M5 sublet classification ships) |

## Schema Changes

### `listings` table

```sql
-- Migration 0013
ALTER TABLE listings ADD COLUMN duplicate_of INTEGER REFERENCES listings(id);
-- NULL = canonical (original), non-NULL = points to the canonical listing
-- Canonical listing is the one with the richest data (prefer yad2 > facebook)
```

### Index

```sql
-- Speed up duplicate lookups during processing
CREATE INDEX idx_listings_dedup ON listings(city, bedrooms, price) WHERE duplicate_of IS NULL;
```

## Processing Flow

Duplicate detection runs in the **processor pipeline** after extraction, before the listing is written:

```
1. Extract fields (regex + AI)
2. Check for duplicate:
   a. Query canonical listings matching city + bedrooms + price (±10%)
   b. For each candidate, check secondary criteria (street, neighborhood, coordinates)
   c. If match found → set duplicate_of = matched listing ID
   d. If no match → leave duplicate_of = NULL (this is the canonical)
3. Upsert listing (with duplicate_of populated)
```

### Source Priority

When a duplicate is found, the **earlier** listing is canonical. The newer one gets `duplicate_of` set. If the earlier one is Facebook and the newer is YAD2, we update the canonical pointer to prefer YAD2 (richer data):

| Existing | New | Action |
|----------|-----|--------|
| YAD2 | Facebook | New Facebook listing gets `duplicate_of = yad2_id` |
| Facebook | YAD2 | Swap: update old Facebook `duplicate_of = yad2_id`, new YAD2 gets `duplicate_of = NULL` |
| Facebook | Facebook | Later one gets `duplicate_of = earlier_id` |
| YAD2 | YAD2 | Shouldn't happen (same source_item_id), but later gets `duplicate_of = earlier_id` |

### Notification Impact

The notify worker already queries `listings` to find unnotified listings. Add a filter:

```sql
WHERE duplicate_of IS NULL  -- Only notify for canonical listings
```

This single `WHERE` clause prevents all duplicate notifications with zero changes to the filter matching logic.

## Telegram Integration

No user-facing changes needed in Phase 1. Duplicates are silently suppressed.

**Future (Phase 2):** Show "Also listed on: YAD2, Facebook" badge on notifications when a listing has duplicates, giving users multiple source links.

## Performance Considerations

### Query Cost

The dedup query per listing:
```sql
SELECT id, street, house_number, neighborhood, latitude, longitude, source_id
FROM listings
WHERE city = ? AND bedrooms = ? AND price BETWEEN ? AND ?
  AND duplicate_of IS NULL
LIMIT 20
```

With the `idx_listings_dedup` partial index, this is an indexed lookup. Expected candidates per query: 0-5 (same city + bedrooms + similar price). Well within Workers CPU budget.

### Batch Size

Current processor batch size is 50. Each listing adds one dedup query (~1ms each). Total added cost per batch: ~50ms — acceptable.

## Dependencies

- None (can implement independently)
- Benefits from `street` and `house_number` fields (already in schema from PR #12)
- Benefits from `latitude`/`longitude` (available from YAD2 since M2)
- Enhanced by future coordinate extraction from Facebook (not available yet)

## Acceptance Criteria

### AC-1: Cross-Source Duplicates Detected
- [ ] When the same apartment exists on YAD2 and Facebook with matching city + bedrooms + price (±10%) + street, the Facebook listing gets `duplicate_of` set to the YAD2 listing ID

### AC-2: Notifications Not Sent for Duplicates
- [ ] Notify worker skips listings where `duplicate_of IS NOT NULL`
- [ ] User receives exactly one notification per physical apartment

### AC-3: Source Priority Respected
- [ ] YAD2 is always the canonical listing when both sources have the same apartment
- [ ] If Facebook listing was canonical and YAD2 arrives later, the canonical pointer is swapped

### AC-4: No False Positives on Different Apartments
- [ ] Two apartments in the same building (same street, different bedrooms/price) are NOT marked as duplicates
- [ ] Two apartments in the same neighborhood at different prices (>10% apart) are NOT marked as duplicates

### AC-5: Performance Within Budget
- [ ] Processor batch of 50 listings completes within Workers CPU limits
- [ ] Dedup query uses the partial index (verified via EXPLAIN)

### AC-6: Tests
- [ ] Unit tests for duplicate matching logic (match/no-match scenarios)
- [ ] Unit tests for source priority swapping
- [ ] Integration test: two listings from different sources → only one notification sent
