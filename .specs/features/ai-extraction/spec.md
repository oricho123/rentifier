# AI-Powered Extraction

## Problem

Regex-based extraction is brittle for Hebrew Facebook posts:
- Price formats vary wildly (`מחיר 8650`, `8,650 ש"ח`, `8650₪`, just `8650` with no label)
- Bedrooms use many abbreviations (`3 ח'`, `3 חד'`, `3.5 חדרים`, `שלושה חדרים`)
- City/neighborhood often implied by context, not stated explicitly
- Street names have many formats (`ברח' יעל`, `רח יעל`, `ברחוב יעל`)
- Non-rental posts (fitness classes, ads) get processed as listings
- Phone numbers, entry dates, floor numbers not extracted

## Solution: Cloudflare Workers AI

Use Cloudflare's built-in AI binding (`@cf/meta/llama-3.1-8b-instruct` or similar) to extract structured data from post text. The free tier includes 10,000 neurons/day — sufficient for our volume.

## Approach: Hybrid regex + AI

1. **Regex first** (cheap, fast) — extract what we can with existing patterns
2. **AI second** (only when regex misses fields) — send to LLM for structured extraction
3. **AI as relevance filter** — classify post as rental/not-rental before processing

### AI extraction prompt (structured output)

```
Given this Hebrew Facebook post from a rental group, extract:
- is_rental: boolean (is this a rental listing?)
- price: number | null
- currency: ILS/USD/EUR | null
- bedrooms: number | null
- city: string | null
- neighborhood: string | null
- street: string | null
- floor: number | null
- square_meters: number | null
- entry_date: string | null
- phone: string | null
- tags: string[] (parking, balcony, pets, furnished, elevator, etc.)

Post: {text}

Respond as JSON only.
```

## Architecture

```
PostText
  → regexExtract()          // existing, free
  → if (missing fields || low confidence)
      → aiExtract(env.AI)   // Cloudflare Workers AI binding
  → mergeResults()          // prefer AI when regex is null/low-confidence
  → ListingDraft
```

## Implementation Plan

### 1. Add AI binding to processor worker
- `wrangler.toml`: add `[ai]` binding
- `Env` interface: add `AI: Ai`

### 2. Create `packages/extraction/src/ai-extractor.ts`
- `aiExtract(text: string, ai: Ai): Promise<AiExtractionResult>`
- Structured prompt with JSON schema
- Timeout + fallback to regex-only

### 3. Update processor pipeline
- After regex extraction, check for missing critical fields (price, bedrooms, city)
- If missing, call AI extractor
- Merge results: AI fills gaps, regex values take precedence when confident

### 4. Add relevance filtering
- AI classifies posts as rental/not-rental
- Non-rental posts skipped before normalization
- Saves processing time and reduces noise

## Cloudflare Workers AI Free Tier

- 10,000 neurons/day (free)
- Models: `@cf/meta/llama-3.1-8b-instruct`, `@cf/mistral/mistral-7b-instruct-v0.2`
- No API keys needed — native Worker binding
- Latency: ~200-500ms per call

## Estimated Volume

- ~50-100 posts/day across all groups
- AI only called when regex misses fields (~60-70% of Facebook posts)
- Well within free tier limits

## Risks

- AI hallucination (mitigated by regex-first approach + validation)
- Latency increase in processor (mitigated by only calling AI when needed)
- Model quality for Hebrew (test with real posts before deploying)

## Success Criteria

- Price extraction rate: >90% (currently ~50% for Facebook)
- City extraction rate: >95% (currently ~30% for Facebook)
- Non-rental filtering: >95% accuracy
- No regression on YAD2 extraction (structured data, doesn't use AI)
