# listings_raw Deduplication Strategy

**Feature:** Improve deduplication logic in listings_raw table
**Status:** Specified
**Created:** 2026-02-22

## Current State

**Existing Deduplication:**
```sql
CREATE TABLE listings_raw (
  -- ...
  UNIQUE(source_id, source_item_id) ON CONFLICT IGNORE
);
```

**How It Works:**
- Collector tries to insert same `(source_id, source_item_id)` twice → second insert ignored
- No duplicates within same source
- Zero storage waste from re-fetching same listings

**What It DOESN'T Handle:**
1. **Updates**: If a listing changes (price updated, description edited), `ON CONFLICT IGNORE` means the raw table never reflects the update
2. **Cross-source duplicates**: Same apartment on YAD2 + Facebook = 2 separate rows (different source_id)
3. **Content-based duplicates**: Different IDs but identical listing (rare but possible)

## Problem Analysis

### Problem 1: Updates Are Ignored

**Scenario:**
```
Day 1: YAD2 listing 12345 - Price: 5000 ILS
Day 2: YAD2 listing 12345 - Price: 4500 ILS (reduced)
```

**Current Behavior:**
- Day 1: Inserted into listings_raw
- Day 2: INSERT ignored due to UNIQUE constraint
- Result: listings_raw still has 5000 ILS, processor never sees the update

**Impact:**
- Users miss price reductions (important!)
- Stale data in canonical listings table
- Description/image updates also missed

### Problem 2: Cross-Source Duplicates

**Scenario:**
```
YAD2 listing #12345: "3br apartment in Tel Aviv, Florentin, 6000 ILS"
Facebook listing #xyz789: "3br apartment in Tel Aviv, Florentin, 6000 ILS" (same physical apartment)
```

**Current Behavior:**
- 2 rows in listings_raw (different source_id)
- 2 rows in canonical listings
- User gets 2 notifications for same apartment

**Impact:**
- Duplicate notifications annoy users
- Wasted storage and processing
- Harder to track "already seen" apartments

## Requirements

### FR-1: Handle Listing Updates
When a listing's content changes, the system should:
- Detect the change
- Either update listings_raw OR trigger re-processing
- Propagate changes to canonical listings table

### FR-2: Cross-Source Deduplication (Optional)
When the same apartment appears on multiple sources:
- Detect similarity (fuzzy matching on address, price, description)
- Link them in canonical table as "same listing, multiple sources"
- OR choose canonical source (prefer YAD2 over Facebook)

### FR-3: Performance Constraints
- Don't break Cloudflare CPU limits
- Minimize D1 query overhead
- Keep collector fast (dedup checks should be cheap)

## Solution Options

### Option 1: Update-on-Change (Replace IGNORE with UPDATE) ⭐ RECOMMENDED

**Change:**
```sql
-- Migration 0008
ALTER TABLE listings_raw DROP CONSTRAINT unique_source_item;

CREATE UNIQUE INDEX idx_listings_raw_unique ON listings_raw(source_id, source_item_id);

-- Then in queries.ts, change insertRawListings:
INSERT INTO listings_raw (source_id, source_item_id, url, raw_json)
VALUES (?, ?, ?, ?)
ON CONFLICT(source_id, source_item_id) DO UPDATE SET
  url = excluded.url,
  raw_json = excluded.raw_json,
  fetched_at = datetime('now'),
  processed_at = NULL  -- IMPORTANT: Mark as unprocessed so processor re-runs
```

**Pros:**
- Listings always reflect latest data
- Price reductions/updates propagate to users
- Simple, deterministic

**Cons:**
- Re-processes listings even if content didn't actually change (JSON might differ due to formatting)
- More processor work (but idempotent, so safe)

**Impact:**
- If listing content changes: processor re-runs, canonical table updated
- If listing unchanged: still re-processed but upsert in canonical table is no-op

---

### Option 2: Hash-Based Change Detection (Smarter)

**Change:**
```sql
-- Migration 0008
ALTER TABLE listings_raw ADD COLUMN content_hash TEXT;

CREATE UNIQUE INDEX idx_listings_raw_unique ON listings_raw(source_id, source_item_id);
```

**Logic:**
```typescript
// In collector, before insert:
const contentHash = hashListing(candidate); // SHA-256 of normalized content

// Insert with hash
INSERT INTO listings_raw (source_id, source_item_id, url, raw_json, content_hash)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT(source_id, source_item_id) DO UPDATE SET
  url = CASE WHEN excluded.content_hash != listings_raw.content_hash THEN excluded.url ELSE listings_raw.url END,
  raw_json = CASE WHEN excluded.content_hash != listings_raw.content_hash THEN excluded.raw_json ELSE listings_raw.raw_json END,
  content_hash = excluded.content_hash,
  fetched_at = datetime('now'),
  processed_at = CASE WHEN excluded.content_hash != listings_raw.content_hash THEN NULL ELSE listings_raw.processed_at END
```

**Pros:**
- Only re-processes when content ACTUALLY changes
- Reduces processor load
- Smarter deduplication

**Cons:**
- More complex
- Hash computation adds CPU cost to collector
- Need to decide what fields to hash (price + description? or full payload?)

**Recommendation:** Defer to future optimization unless you have 1000s of listings

---

### Option 3: Cross-Source Fuzzy Deduplication (Advanced)

**Approach:**
- After processor normalizes listings, run a deduplication pass
- Compare listings by:
  - Address similarity (Levenshtein distance)
  - Price within 5%
  - Same city + neighborhood
- Mark duplicates with a `canonical_listing_id` reference

**Implementation:**
```sql
-- Add to listings table
ALTER TABLE listings ADD COLUMN canonical_listing_id INTEGER REFERENCES listings(id);
ALTER TABLE listings ADD COLUMN is_canonical BOOLEAN DEFAULT 1;

-- Dedup logic (separate worker or post-processor step)
-- Find potential duplicates using:
SELECT l1.id, l2.id
FROM listings l1
JOIN listings l2 ON
  l1.id < l2.id AND
  l1.city = l2.city AND
  l1.neighborhood = l2.neighborhood AND
  ABS(l1.price - l2.price) / l1.price < 0.05 AND
  -- fuzzy address match (requires custom function or external service)
```

**Pros:**
- Solves cross-source duplicates
- Better user experience

**Cons:**
- VERY complex
- Fuzzy matching is CPU-intensive
- Risk of false positives (marking different apartments as same)
- Cloudflare Workers may not have resources for this

**Recommendation:** Defer to M5+ or use external service (Cloudflare AI Workers)

## Recommended Plan

### Phase 1: Update-on-Change (Option 1) - Do This Now

**Scope:** Handle listing updates (price changes, description edits)

**Changes:**
1. Migration 0008: Change `ON CONFLICT IGNORE` to `ON CONFLICT DO UPDATE SET ... processed_at = NULL`
2. Update `insertRawListings` in queries.ts to use UPDATE logic
3. Test: modify a YAD2 listing, re-run collector, verify processor re-processes it

**Files:**
- `packages/db/migrations/0008_update_on_conflict.sql`
- `packages/db/src/queries.ts` (insertRawListings method)

**Effort:** 30 minutes

---

### Phase 2: Cross-Source Deduplication - Defer to M4+

**Reason:** Adds significant complexity, unclear ROI until we have Facebook connector

**When to revisit:**
- After M4 (Facebook connector)
- If users report duplicate notifications
- If storage costs become an issue

---

## Decision

**Implement Phase 1 (Update-on-Change) immediately.** This is a clear improvement with minimal risk.

**Defer Phase 2 (Cross-Source Dedup)** until we have multiple connectors and evidence of user pain.

## Acceptance Criteria (Phase 1)

### AC-1: Listing Updates Are Detected
- [ ] When collector re-fetches a listing with changed content, `processed_at` is reset to NULL
- [ ] Processor re-processes the updated listing
- [ ] Canonical listings table reflects new data

### AC-2: Unchanged Listings Are Skipped
- [ ] When collector re-fetches same listing (no changes), it updates `fetched_at` but keeps `processed_at`
- [ ] Processor skips already-processed items

Wait, this is problematic with Option 1 - we can't tell if content changed without reading the old JSON. So Option 1 always re-processes.

**Revised Recommendation: Use Option 2 (Hash-Based) from the start**

It's only slightly more complex but saves a lot of wasted processing.

## Revised Recommendation: Hash-Based Change Detection

**What to Hash:**
- Price
- Title
- Description
- Key fields (bedrooms, city, neighborhood)

**Not hashed:**
- Metadata (posted_at, internal IDs)
- Image URLs (can change without content change)

**Implementation:**
```typescript
function hashListingContent(candidate: ListingCandidate): string {
  const normalized = {
    title: candidate.title.trim().toLowerCase(),
    price: candidate.price,
    description: candidate.description?.trim().toLowerCase() || '',
    city: candidate.city,
    neighborhood: candidate.neighborhood,
    bedrooms: candidate.bedrooms,
  };
  return sha256(JSON.stringify(normalized));
}
```

This way:
- Price change → new hash → re-process ✅
- Description edit → new hash → re-process ✅
- Image URL change → same hash → skip ✅
- Irrelevant metadata change → same hash → skip ✅
