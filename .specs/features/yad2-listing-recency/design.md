# YAD2 Listing Recency - Design

**Spec**: `.specs/features/yad2-listing-recency/spec.md`
**Status**: Draft

---

## Architecture Overview

Two independent mechanisms feed into the existing pipeline:

```
YAD2 API markers
      │
      ├── orderId filtering ──→ skip old markers before candidate creation
      │
      └── image URL parsing ──→ extract date → set rawPostedAt on candidate
                                                      │
                                              existing pipeline handles the rest
                                              (normalize → postedAt → posted_at → display)
```

The orderId filter is applied in `Yad2Connector.fetchNew()` before creating candidates. The image date extraction is applied in `markerToCandidate()` when building the `ListingCandidate`.

---

## Code Reuse Analysis

### Existing Components to Leverage

| Component | Location | How to Use |
|-----------|----------|------------|
| `Yad2CursorState` | `packages/connectors/src/yad2/types.ts` | Add `minOrderId` field for threshold tracking |
| `markerToCandidate()` | `packages/connectors/src/yad2/index.ts:212` | Add image date extraction here |
| `rawPostedAt` field | `@rentifier/core` types | Already wired through entire pipeline, just needs a value |
| `posted_at` column | `packages/db/src/schema.ts:42` | Already exists, already nullable |
| Message formatter | `apps/notify/src/message-formatter.ts` | Add age display for P3 |

### Integration Points

| System | Integration Method |
|--------|-------------------|
| Collector pipeline | orderId filter runs inside `fetchNew()` before candidate creation |
| Candidate creation | Image date parsed in `markerToCandidate()`, sets `rawPostedAt` |
| Normalize | Already handles `rawPostedAt` → `postedAt` (line 202) |
| Processor | Already handles `postedAt` → `posted_at` (pipeline.ts:92) |
| DB | `posted_at` column already exists and is nullable |

---

## Components

### 1. Image Date Parser (new utility)

- **Purpose**: Extract upload date from YAD2 image URLs
- **Location**: `packages/connectors/src/yad2/image-date.ts`
- **Interface**:
  - `parseImageDate(imageUrl: string): string | null` — returns ISO date string or null
- **Dependencies**: None (pure function)
- **Reuses**: Nothing — new utility

### 2. orderId Recency Filter (modify existing)

- **Purpose**: Skip markers with orderId below the rolling minimum threshold
- **Location**: `packages/connectors/src/yad2/index.ts` (modify `fetchNew`)
- **Logic**:
  - On first run (no state): accept all markers, record `minOrderId` as the lowest orderId seen
  - On subsequent runs: skip markers with `orderId` ≤ `minOrderId` from previous batches
  - After filtering: update `minOrderId` to the lowest orderId in the current batch
  - This creates a rolling window: each fetch only accepts markers newer than the previous batch's oldest
- **Dependencies**: `Yad2CursorState` type update
- **Reuses**: Existing cursor state persistence

### 3. Candidate Date Enrichment (modify existing)

- **Purpose**: Set `rawPostedAt` from image URL date extraction
- **Location**: `packages/connectors/src/yad2/index.ts` (modify `markerToCandidate`)
- **Logic**: Call `parseImageDate(marker.metaData?.coverImage)`, set result as `rawPostedAt`
- **Dependencies**: Image Date Parser
- **Reuses**: Existing `rawPostedAt` pipeline

---

## Data Models

### Updated Yad2CursorState

```typescript
interface Yad2CursorState {
  lastFetchedAt: string | null;
  knownOrderIds: string[];
  consecutiveFailures: number;
  circuitOpenUntil: string | null;
  lastCityIndex: number;
  resultCounts?: Record<number, number>;
  minOrderId?: number;  // NEW: lowest orderId from last batch, skip anything ≤ this
}
```

No DB migration needed — this is stored as JSON in `source_state.cursor`.

---

## Error Handling Strategy

| Error Scenario | Handling | User Impact |
|----------------|----------|-------------|
| Image URL format unrecognized | Return null, fall back to no date | No impact — listing still processed |
| All markers below orderId threshold | Return empty candidates array | No notifications (correct behavior) |
| orderId is not numeric | Parse with `parseInt`, skip if NaN | Marker skipped |
| First run with no prior state | Accept all markers, establish baseline | Normal first-run behavior |

---

## Tech Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| orderId threshold storage | Cursor state JSON | Already persisted per-source, no migration needed |
| Image date extraction | Regex on URL path | Fragile but free — fallback to null is safe |
| orderId type | Parse as number | API returns numeric orderId (e.g. 56650254) |
| Filter location | Inside `fetchNew()` before candidate creation | Prevents unnecessary processing of old listings |
