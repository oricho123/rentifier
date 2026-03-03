# AI-Powered Extraction

## Problem

The regex-based extraction pipeline misses data from listings that don't follow expected patterns. Facebook posts are especially problematic — free-text with no structure, Hebrew slang, run-together text (no newlines), and mixed languages. When extraction fails, listings get `null` fields for price, bedrooms, city, or neighborhood, making them unmatchable against user filters and invisible to users.

### Evidence (from production DB, 2,181 listings)

**Field coverage:**
- Missing price: 29 (1.3%) — some intentionally hidden by seller (no price listed)
- Missing city: 30 (1.4%) — most get city from group defaults
- Missing neighborhood: 269 (12.3%) — biggest gap
- Missing street: 328 (15%) — requires explicit "רחוב/ברחוב" prefix
- Missing bedrooms: 39 (1.8%)

**Confidence distribution is broken:**
- 98% of listings get `relevance_score = 0.7` (price matched without explicit period)
- Only 17 listings get `null` (no price AND no location found)
- The 0.8/0.85/0.9 scores are rare because `overallConfidence = min(price, location)` and price almost always returns 0.7
- A `< 0.5` threshold would only trigger for 17 listings — useless as a gate

**Street extraction was broken** (fixed in PR #35 but production data still has old extractions):
- "בודנהיימר המבוקש דירת 4 חדרים" — captured garbage past street name
- "מלכי ישראל3חד'100 מ'רקו…" — run-together Facebook text captured as street

**Other gaps:**
- Non-rental posts (ads, community announcements) still get processed
- No extraction for: floor number, square meters, entry date
- Some listings intentionally omit price — AI should NOT hallucinate one

### Current Pipeline (processor `pipeline.ts`)

```
ListingRaw → parse JSON → isSearchPost? → connector.normalize() → extractAll() → upsert
```

Extraction runs after normalization. The processor merges regex results with connector draft fields (extraction takes priority when non-null). `overallConfidence` is stored as `relevance_score`.

## Scope

**In scope:**
- AI fallback extraction for: price, bedrooms, city, neighborhood, street, tags
- New field extraction: floor, square meters, entry date
- Rental vs. non-rental classification (replaces/augments regex `isSearchPost`)
- Confidence-gated invocation — only call AI when regex misses critical fields

**Out of scope:**
- AI-generated listing summaries (defer to M6)
- Image analysis / OCR on listing photos
- Replacing regex extraction — AI is a fallback, not a replacement
- Phone number extraction (privacy concerns)

## Requirements

### R1: Field-Gated AI Fallback
Invoke AI extraction when regex `extractAll()` has missing fields that AI could fill. Gate conditions (any triggers AI):
- Neighborhood is null (12% of listings — biggest gap)
- Street is null (15% of listings)
- Price is null AND listing text is long enough to likely contain one (>50 chars)
- City is null (after group default fallback)

Skip AI for YAD2 listings (structured source, regex is sufficient). Note: some listings intentionally omit price — AI must return null for these rather than hallucinate a number.

**Note on call volume:** Because neighborhood and street are missing in 12-15% of listings, AI will trigger for ~85% of Facebook posts. This is intentional — neighborhood and street extraction from free-text without "רחוב" prefix is high-value. The budget cap (R4, default 20 calls/batch) protects against cost overruns. With ~50-100 posts/day and 48 processor batches/day, the budget is sufficient. Monitor AI metrics after deployment and adjust `maxCallsPerBatch` if needed.

### R2: Structured JSON Output
AI must return fields matching `ExtractionResult` shape plus new fields (floor, sqm, entry date). Prompt must enforce JSON-only responses. Parse with validation — reject malformed responses gracefully.

### R3: Field Merging Priority
1. Regex-extracted fields with confidence > 0 (highest priority)
2. AI-extracted fields (fill gaps)
3. Connector draft fields (lowest priority — from normalize())

AI-filled fields get a fixed confidence modifier (e.g., 0.6) to distinguish from regex matches.

### R4: Cost Control
- Cloudflare Workers AI free tier: 10,000 neurons/day
- Budget: max AI calls per processor batch (configurable, default 20)
- Track AI call count in processor metrics
- Graceful degradation: if AI fails or budget exhausted, fall back to regex-only

### R5: Latency Budget
AI adds ~200-500ms per call. Processor batch (50 listings) currently runs in ~2s. With AI on ~60% of Facebook posts (~30 calls), worst case adds ~15s. Parallelize AI calls within batch to keep total under 10s.

### R6: Non-Rental Classification
AI classifies posts as rental/not-rental. Non-rental posts get flagged to skip notification matching. This augments the existing regex `isSearchPost()` which only catches "searching for apartment" posts but misses ads, community posts, etc.

## Success Criteria

- Neighborhood extraction rate: >50% (current: 88% — target closing the 12% gap)
- Street extraction rate: >50% (current: 85% — but many old entries have garbage, target clean extraction)
- Non-rental filtering accuracy: >90%
- No regression on YAD2 extraction (structured data, no AI calls)
- AI calls stay within free tier limits (~50-100 posts/day)
- Processor batch time stays under 15s
- Zero hallucinated prices on intentionally priceless listings
