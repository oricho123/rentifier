# AI Extraction — Tasks

## Task 1: Create AI extractor module
**File:** `packages/extraction/src/ai-extractor.ts`
**Depends on:** None

Create the core AI extraction module with:
- `AiExtractionResult` interface (isRental, price, bedrooms, city, neighborhood, street, tags, floor, squareMeters, entryDate)
- `AiExtractorConfig` interface (maxCallsPerBatch, timeoutMs, model)
- `AiExtractorMetrics` interface (called, succeeded, failed, skippedBudget, avgLatencyMs)
- `shouldInvokeAI(extraction, sourceName, textLength)` — gate function (see design.md section 2)
- `aiExtract(text, ai, config?)` — calls Workers AI with structured prompt, parses JSON response with Zod validation, normalizes city via `normalizeCity()`
- `mergeExtractionResults(regex, ai)` — merge function (see design.md section 3)
- Export from `packages/extraction/src/index.ts`

The `ai` parameter type should be the Cloudflare Workers AI `Ai` type. Since this package doesn't depend on Cloudflare types, use a generic interface: `{ run(model: string, input: any): Promise<any> }`.

## Task 2: Database migration
**File:** `migrations/0010_add_ai_extraction_columns.sql`
**Depends on:** None

Add columns to `listings` table:
- `entry_date TEXT` — ISO date or Hebrew description from AI
- `ai_extracted INTEGER DEFAULT 0` — boolean flag: was AI used for this listing

Update `ListingRow` type in `packages/db/src/types.ts` to include new fields.
Update `upsertListing` in `packages/db/src/queries.ts` to handle new columns.

## Task 3: Unit tests for AI extractor
**File:** `packages/extraction/src/__tests__/ai-extractor.test.ts`
**Depends on:** Task 1

Test:
- `shouldInvokeAI()`: returns false for yad2, true when neighborhood/street/price/city null, false when all fields present
- `mergeExtractionResults()`: regex takes priority, AI fills gaps, tag dedup, city normalization
- `aiExtract()`: valid JSON response parsing, malformed response returns null, timeout handling, non-rental classification
- Validate no hallucination: AI returning null price is preserved, not overridden

## Task 4: Integrate AI into processor pipeline
**Files:** `apps/processor/src/pipeline.ts`, `apps/processor/src/index.ts`
**Depends on:** Task 1, Task 2

Update `processBatch()`:
- Add optional `ai` parameter (`{ run(model: string, input: any): Promise<any> } | null`)
- After `extractAll()`, check `shouldInvokeAI()` with source name from connector
- If AI gate passes and budget not exhausted, call `aiExtract()`
- Merge AI results with regex results via `mergeExtractionResults()`
- Set `ai_extracted = 1` on listing row when AI was used
- Map new fields (floor, squareMeters, entryDate) to listing row
- Track and log `AiExtractorMetrics` at batch end

Update `index.ts`:
- Add `AI` to Env interface
- Pass `env.AI` to `processBatch()`

## Task 5: Wrangler configuration
**File:** `apps/processor/wrangler.toml`
**Depends on:** Task 4

Add AI binding:
```toml
[ai]
binding = "AI"
```

## Task 6: Pipeline integration tests
**File:** `apps/processor/src/__tests__/pipeline.test.ts`
**Depends on:** Task 3, Task 4

Add tests:
- AI is NOT called for yad2 source listings
- AI is called when neighborhood is null (Facebook listing)
- AI is called when street is null (Facebook listing)
- AI is NOT called when all fields are present
- AI budget exhaustion falls back to regex-only
- AI failure (timeout/parse error) doesn't break pipeline
- AI results merged correctly into listing row
- `ai_extracted` flag set correctly
