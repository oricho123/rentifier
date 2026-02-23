# listings_raw Deduplication - FREE TIER OPTIMIZED

**Feature:** Handle listing updates without blowing free tier limits
**Status:** Revised Design
**Created:** 2026-02-22

## Problem: Free Tier Constraints

**Cloudflare D1 Free Tier:**
- 100,000 rows read/day
- 50,000 rows written/day

**Current usage (ON CONFLICT IGNORE):**
- Collector: ~2,400 writes/day (only new listings)
- Processor: ~4,800 writes/day
- Total: ~7,200 writes/day ✅ Safe

**Proposed "always update" approach:**
- Collector: ~9,600 writes/day (every listing, every run)
- Processor: ~19,200 writes/day (re-process everything)
- Total: ~28,800 writes/day ⚠️ Too close to limit!

**Adding more sources (Facebook, etc.):**
- Could easily hit 50k/day limit 🚫

## Solutions Ranked by Efficiency

### Option 1: Use Source's Updated Timestamp ⭐ BEST IF AVAILABLE

**Check if YAD2 API provides `updated_at` or `modified_at` field.**

If yes:
```typescript
// Add to listings_raw schema
ALTER TABLE listings_raw ADD COLUMN source_updated_at TEXT;

// In collector
INSERT INTO listings_raw (source_id, source_item_id, url, raw_json, source_updated_at)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT(source_id, source_item_id) DO UPDATE SET
  url = excluded.url,
  raw_json = excluded.raw_json,
  fetched_at = datetime('now'),
  source_updated_at = excluded.source_updated_at,
  processed_at = CASE
    WHEN listings_raw.source_updated_at != excluded.source_updated_at THEN NULL
    ELSE listings_raw.processed_at
  END
```

**Impact:**
- Only re-processes when source says it changed
- Writes: only changed listings (maybe 5-10% of fetches)
- **Estimated: ~3,000 writes/day** ✅ Excellent!

**Action Required:**
1. Check YAD2 API documentation for `updated_at` field
2. Test if field exists in API response
3. Implement if available

---

### Option 2: Staleness Threshold (No Source Timestamp)

If YAD2 doesn't provide `updated_at`, use time-based refresh:

```typescript
// Add to listings_raw schema
ALTER TABLE listings_raw ADD COLUMN last_refreshed_at TEXT DEFAULT (datetime('now'));

// In collector
INSERT INTO listings_raw (source_id, source_item_id, url, raw_json)
VALUES (?, ?, ?, ?)
ON CONFLICT(source_id, source_item_id) DO UPDATE SET
  url = excluded.url,
  raw_json = excluded.raw_json,
  fetched_at = datetime('now'),
  processed_at = CASE
    -- Only reset if not refreshed in last 7 days
    WHEN datetime(listings_raw.last_refreshed_at, '+7 days') < datetime('now') THEN NULL
    ELSE listings_raw.processed_at
  END,
  last_refreshed_at = CASE
    WHEN datetime(listings_raw.last_refreshed_at, '+7 days') < datetime('now') THEN datetime('now')
    ELSE listings_raw.last_refreshed_at
  END
```

**Impact:**
- Each listing re-processed once every 7 days
- Writes: ~1/7th of listings per day
- **Estimated: ~8,500 writes/day** ✅ Safe

**Trade-off:**
- Users might wait up to 7 days to see price changes
- But rental listings don't change that often anyway

---

### Option 3: Price-Only Quick Check

Check only the price field (most important for users):

```typescript
// Extract price before insert
const price = extractPrice(candidate); // Simple regex

INSERT INTO listings_raw (source_id, source_item_id, url, raw_json, quick_price)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT(source_id, source_item_id) DO UPDATE SET
  url = excluded.url,
  raw_json = excluded.raw_json,
  fetched_at = datetime('now'),
  quick_price = excluded.quick_price,
  processed_at = CASE
    WHEN listings_raw.quick_price != excluded.quick_price THEN NULL
    ELSE listings_raw.processed_at
  END
```

**Impact:**
- Only re-processes on price change (the most important update)
- Writes: ~10-15% of fetches (prices change occasionally)
- **Estimated: ~9,000 writes/day** ✅ Safe

**Trade-off:**
- Misses description updates, image changes
- But users care most about price anyway

---

### Option 4: Keep ON CONFLICT IGNORE + Periodic Cleanup

**Simplest option:**

1. Keep `ON CONFLICT IGNORE` for normal operation
2. Once per week, run a cleanup job:
   ```sql
   DELETE FROM listings_raw WHERE fetched_at < datetime('now', '-30 days');
   DELETE FROM listings WHERE source_id NOT IN (SELECT id FROM sources WHERE enabled=1);
   ```
3. Stale listings get re-fetched fresh next collector run

**Impact:**
- Daily writes: ~7,200 (current)
- Weekly cleanup: minimal
- **Estimated: ~7,200 writes/day** ✅ Very safe

**Trade-off:**
- Never see updates to existing listings
- But old listings eventually age out and get re-fetched

---

## Recommendation

**Step 1:** Check if YAD2 API has `updated_at` field
```bash
# Test YAD2 API response
curl "https://api.yad2.co.il/..." | jq '.'
# Look for: updated_at, modified_at, last_updated, etc.
```

**Step 2:** Based on result:
- **If YES:** Use Option 1 (source timestamp) ⭐ Best
- **If NO:** Use Option 2 (7-day staleness) or Option 4 (keep IGNORE)

**Step 3:** Monitor usage
```bash
# Check D1 metrics in Cloudflare dashboard
# If approaching limits, adjust staleness threshold (7d → 14d)
```

## Implementation Priority

**Do NOT implement "always update" approach** - it wastes free tier quota.

**Instead:**
1. Check YAD2 API for timestamps (10 min)
2. Implement Option 1 or Option 2 (30 min)
3. Monitor for 1 week
4. Adjust threshold if needed

## Cost Analysis

**Current (IGNORE):**
- 7,200 writes/day
- Headroom: 42,800 writes/day remaining
- Safe for adding 5-6 more sources

**Always UPDATE:**
- 28,800 writes/day
- Headroom: 21,200 writes/day remaining
- Can only add 1-2 more sources before hitting limit

**Option 1 (source timestamp):**
- ~3,000 writes/day
- Headroom: 47,000 writes/day remaining
- Safe for adding 10+ sources

**Option 2 (7-day staleness):**
- ~8,500 writes/day
- Headroom: 41,500 writes/day remaining
- Safe for adding 4-5 sources

## Decision

**Reject "always update" approach** - too wasteful for free tier.

**Implement either:**
- **Option 1** if YAD2 API supports it (check first!)
- **Option 2** (7-day staleness) otherwise
- **Option 4** (keep IGNORE) if updates aren't critical

Which option depends on:
1. Does YAD2 API have `updated_at`?
2. How often do listings actually change?
3. How important are updates to users?

Want me to check the YAD2 API to see what fields are available?
