# AI Extraction — Design

## Architecture Overview

```
                        Processor Pipeline (pipeline.ts)
                        ================================

ListingRaw
  → parse JSON → ListingCandidate
  → isSearchPost()?                    // regex check (existing)
  → connector.normalize()              // → ListingDraft
  → extractAll(title, description)     // → ExtractionResult (regex)
  → shouldInvokeAI(extraction, source)?
      YES → aiExtract(text)            // → AiExtractionResult
          → mergeResults(regex, ai)    // → ExtractionResult (enhanced)
      NO  → use regex result as-is
  → build listing row → upsert
```

AI extraction is inserted **after** regex extraction and **before** the listing row build. It's a single additional step in the existing pipeline, gated by a decision function.

## Component Design

### 1. AI Extractor Module

**File:** `packages/extraction/src/ai-extractor.ts`

```typescript
export interface AiExtractionResult {
  isRental: boolean;
  price: { amount: number; currency: 'ILS' | 'USD' | 'EUR'; period: 'month' | 'week' | 'day' } | null;
  bedrooms: number | null;
  city: string | null;
  neighborhood: string | null;
  street: string | null;
  tags: string[];
  floor: number | null;
  squareMeters: number | null;
  entryDate: string | null;  // ISO date or Hebrew month description
}

export interface AiExtractorConfig {
  maxCallsPerBatch: number;    // default: 20
  timeoutMs: number;           // default: 5000
  model: string;               // default: '@cf/meta/llama-3.1-8b-instruct'
}

export interface AiExtractorMetrics {
  called: number;
  succeeded: number;
  failed: number;
  skippedBudget: number;
  avgLatencyMs: number;
}
```

**Key function:**
```typescript
export async function aiExtract(
  text: string,
  ai: Ai,
  config?: Partial<AiExtractorConfig>,
): Promise<AiExtractionResult | null>
```

- Sends structured prompt to Workers AI
- Parses JSON response with validation (Zod schema)
- Returns `null` on timeout, parse failure, or non-rental classification
- Normalizes city names via `normalizeCity()` from `cities.ts`

### 2. Gate Function

**File:** `packages/extraction/src/ai-extractor.ts`

```typescript
export function shouldInvokeAI(
  extraction: ExtractionResult,
  sourceName: string,
  textLength: number,
): boolean
```

Returns `true` when:
- Source is NOT `yad2` (structured data doesn't need AI)
- AND at least one of:
  - `extraction.location?.neighborhood` is null (12% gap — biggest value)
  - `extraction.street` is null (15% gap)
  - `extraction.price` is null AND `textLength > 50` (likely has price but regex missed it; short posts may intentionally omit price)
  - `extraction.location` is null (no city even after group default)

Note: `overallConfidence` is NOT used as a gate — current calculation is effectively binary (0.7 for 98% of listings) and doesn't reflect actual extraction quality. A separate task should fix confidence scoring to be more granular.

### 3. Merge Function

**File:** `packages/extraction/src/ai-extractor.ts`

```typescript
export function mergeExtractionResults(
  regex: ExtractionResult,
  ai: AiExtractionResult,
): ExtractionResult
```

Merge rules:
| Field | Rule |
|-------|------|
| price | Use regex if non-null, else AI |
| bedrooms | Use regex if non-null, else AI |
| location (city) | Use regex if non-null, else AI (normalized via `normalizeCity()`) |
| neighborhood | Use regex if non-null, else AI |
| street | Use regex if non-null, else AI |
| tags | Union of regex + AI tags (deduplicated) |
| isSearchPost | Regex `true` takes priority; AI `isRental: false` also sets it |
| overallConfidence | Recalculate: min of all field confidences. AI-filled fields get 0.6 |

New fields from AI (floor, squareMeters, entryDate) are returned separately and merged into the listing row in `pipeline.ts`.

### 4. Prompt Design

```
You are a Hebrew real estate listing parser. Extract structured data from this Facebook group post.

Rules:
- Respond with JSON only, no explanation
- If a field is not mentioned or cannot be determined, use null
- Do NOT guess or invent values — only extract what is explicitly stated
- Some listings intentionally hide the price — if no price is mentioned, return null
- Price is monthly rent unless stated otherwise
- Street names: extract even without "רחוב" prefix (e.g., "באברבנאל" → "אברבנאל", "דיזנגוף 5" → "דיזנגוף")
- City names in Hebrew (e.g., תל אביב, not Tel Aviv)
- Tags: only use these values: parking, balcony, pets, furnished, immediate, long-term, accessible, air-conditioning, elevator, storage, renovated
- is_rental: false for searching/wanted posts, ads, community announcements, non-rental content

Post text:
"""
{text}
"""

JSON schema:
{
  "is_rental": boolean,
  "price": number | null,
  "currency": "ILS" | "USD" | "EUR" | null,
  "price_period": "month" | "week" | "day" | null,
  "bedrooms": number | null,
  "city": string | null,
  "neighborhood": string | null,
  "street": string | null,
  "floor": number | null,
  "square_meters": number | null,
  "entry_date": string | null,
  "tags": string[]
}
```

### 5. Pipeline Integration

**File:** `apps/processor/src/pipeline.ts`

Changes to `processBatch()`:
1. Accept optional `ai` parameter (`Ai | null`)
2. Initialize `AiExtractorMetrics` counter at batch start
3. After `extractAll()`, check `shouldInvokeAI()` and budget
4. If AI invoked, merge results before building listing row
5. Log AI metrics at batch end
6. New fields (floor, sqm) flow through to listing row

```typescript
export async function processBatch(
  db: DB,
  batchSize?: number,
  ai?: Ai | null,
): Promise<ProcessingResult>
```

The `ai` parameter is optional — when null/undefined, pipeline behaves exactly as today (no AI). This makes AI opt-in and keeps backward compatibility.

### 6. Wrangler Configuration

**File:** `apps/processor/wrangler.toml`

```toml
[ai]
binding = "AI"
```

**File:** `apps/processor/src/index.ts`

```typescript
interface Env {
  DB: D1Database;
  AI: Ai;  // new
}

export default {
  async scheduled(event, env, ctx) {
    const db = createDB(env.DB);
    await processBatch(db, 50, env.AI);
  },
};
```

## Database Changes

New columns on `listings` table (migration):
- `floor INTEGER` — already exists in schema
- `square_meters INTEGER` — already exists in schema
- `entry_date TEXT` — new column, ISO date string
- `ai_extracted BOOLEAN DEFAULT 0` — tracks whether AI was used

These columns already exist in `ListingRow` type and `ListingDraft` type (floor, squareMeters). Only `entry_date` and `ai_extracted` are truly new.

## Testing Strategy

### Unit Tests
- `ai-extractor.test.ts`:
  - `shouldInvokeAI()`: various extraction results, source names
  - `mergeExtractionResults()`: regex-only, AI-only, mixed, tag dedup
  - Prompt response parsing: valid JSON, malformed, missing fields
  - City normalization on AI output

### Integration Tests
- Mock `Ai` binding in processor pipeline tests
- Verify AI is called only when gate function returns true
- Verify AI budget exhaustion falls back to regex-only
- Verify AI timeout doesn't break pipeline

### Manual Validation
- Run against 50 real Facebook posts with known expected values
- Compare regex-only vs regex+AI extraction rates
- Measure latency impact on processor batch

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| AI hallucination (invents price/city) | Validate against known ranges (price 500-50000, known city list) |
| Hebrew quality of small models | Test Llama 3.1 8B vs Mistral 7B on real posts; can swap model |
| Latency spike in processor | Parallelize AI calls; budget cap prevents unbounded cost |
| Free tier exhaustion | Monitor neuron usage; budget cap at 20 calls/batch × 48 batches/day = 960 max |
| Model deprecation | Provider-agnostic interface; model name is configurable |

## File Summary

| File | Change |
|------|--------|
| `packages/extraction/src/ai-extractor.ts` | New — AI extraction, gate, merge |
| `packages/extraction/src/index.ts` | Export new functions |
| `apps/processor/src/pipeline.ts` | Add optional AI parameter, gate + merge step |
| `apps/processor/src/index.ts` | Pass `env.AI` to pipeline |
| `apps/processor/wrangler.toml` | Add `[ai]` binding |
| `packages/extraction/src/__tests__/ai-extractor.test.ts` | New — unit tests |
| Migration | Add `entry_date`, `ai_extracted` columns |
