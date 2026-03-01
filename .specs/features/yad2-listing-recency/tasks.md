# YAD2 Listing Recency - Tasks

**Design**: `.specs/features/yad2-listing-recency/design.md`
**Status**: Draft

---

## Execution Plan

### Phase 1: Foundation (Sequential)

```
T1 → T2
```

### Phase 2: Core Implementation (Parallel)

```
T2 complete, then:
  ├── T3 [P]  orderId filtering
  └── T4 [P]  image date extraction
```

### Phase 3: Integration & Tests (Sequential)

```
T3, T4 complete, then:
  T5 → T6 → T7
```

---

## Task Breakdown

### T1: Add `minOrderId` to `Yad2CursorState`

**What**: Add optional `minOrderId: number` field to the cursor state type
**Where**: `packages/connectors/src/yad2/types.ts`
**Depends on**: None
**Reuses**: Existing `Yad2CursorState` interface

**Done when**:

- [ ] `minOrderId?: number` added to `Yad2CursorState`
- [ ] No TypeScript errors

**Verify**: `npx tsc --noEmit`

---

### T2: Create `parseImageDate` utility

**What**: Pure function that extracts a date from a YAD2 image URL. Pattern: `y2_*_YYYYMMDDHHMMSS.jpeg`
**Where**: `packages/connectors/src/yad2/image-date.ts`
**Depends on**: None
**Reuses**: Nothing — new file

**Interface**:
```typescript
export function parseImageDate(imageUrl: string | null | undefined): string | null
```

**Logic**:
- Match regex `_(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\.\w+$` on URL
- Return ISO string `YYYY-MM-DDTHH:MM:SSZ` or null if no match

**Done when**:

- [ ] Function exported from `image-date.ts`
- [ ] Returns ISO string for valid YAD2 image URLs
- [ ] Returns null for invalid/missing URLs
- [ ] No TypeScript errors

**Verify**: `npx tsc --noEmit`

---

### T3: Add orderId filtering to `fetchNew` [P]

**What**: Filter out markers with orderId at or below `minOrderId` from cursor state. Update `minOrderId` after each fetch.
**Where**: `packages/connectors/src/yad2/index.ts` (modify `fetchNew`)
**Depends on**: T1
**Reuses**: Existing `knownOrderIds` filtering pattern (line 79-80)

**Logic**:
1. After fetching markers, parse each `marker.orderId` as number
2. If `state.minOrderId` exists, filter out markers where `numericOrderId <= state.minOrderId`
3. After filtering, set `updatedState.minOrderId` to the minimum orderId in the current accepted batch
4. On first run (`minOrderId` is undefined): accept all, set baseline

**Done when**:

- [ ] Old markers filtered by orderId threshold
- [ ] `minOrderId` updated in cursor state after each fetch
- [ ] First run accepts all markers and establishes baseline
- [ ] Logging added for filtered count
- [ ] No TypeScript errors

**Verify**: `npx tsc --noEmit`

---

### T4: Set `rawPostedAt` from image URL [P]

**What**: Call `parseImageDate` on the marker's cover image and set result as `rawPostedAt`
**Where**: `packages/connectors/src/yad2/index.ts` (modify `markerToCandidate`)
**Depends on**: T2
**Reuses**: Existing `rawPostedAt` field on `ListingCandidate`

**Logic**:
- Replace `rawPostedAt: null` with `rawPostedAt: parseImageDate(marker.metaData?.coverImage)`

**Done when**:

- [ ] `rawPostedAt` populated from image URL when available
- [ ] Falls back to null when no image or unrecognized format
- [ ] No TypeScript errors

**Verify**: `npx tsc --noEmit`

---

### T5: Add unit tests for `parseImageDate`

**What**: Test the image date parser with various URL formats
**Where**: `packages/connectors/src/yad2/__tests__/image-date.test.ts`
**Depends on**: T2
**Reuses**: Existing test patterns in `__tests__/` directory

**Test cases**:
- Valid URL: `https://img.yad2.co.il/Pic/202602/28/2_2/o/y2_1pa_010164_20260228202920.jpeg` → `2026-02-28T20:29:20Z`
- URL without date pattern → `null`
- Null/undefined input → `null`
- Different image extensions (`.jpg`, `.png`) → still parses

**Done when**:

- [ ] All test cases pass
- [ ] Edge cases covered (null, undefined, bad format)

**Verify**: `npx vitest run packages/connectors/src/yad2/__tests__/image-date.test.ts`

---

### T6: Add unit tests for orderId filtering

**What**: Test that orderId filtering works in `fetchNew`
**Where**: `packages/connectors/src/yad2/__tests__/connector.test.ts` (add tests)
**Depends on**: T3
**Reuses**: Existing test setup in connector test file

**Test cases**:
- First run (no minOrderId): all markers accepted, minOrderId set
- Subsequent run: markers below minOrderId filtered out
- All markers below threshold: returns empty candidates

**Done when**:

- [ ] All test cases pass
- [ ] Cursor state correctly updated with minOrderId

**Verify**: `npx vitest run packages/connectors/src/yad2/__tests__/connector.test.ts`

---

### T7: Run full test suite and verify

**What**: Ensure all 142+ tests pass and no regressions
**Where**: Root
**Depends on**: T5, T6

**Done when**:

- [ ] All tests pass: `npx vitest run`
- [ ] TypeScript clean: `npx tsc --noEmit`

---

## Parallel Execution Map

```
Phase 1 (Sequential):
  T1 ──→ T2

Phase 2 (Parallel):
  T1 complete, then:
    ├── T3 [P]  (orderId filter, depends T1)
    └── T4 [P]  (image date, depends T2)

Phase 3 (Sequential):
  T3, T4 complete, then:
    T5 ──→ T6 ──→ T7
```

---

## Task Granularity Check

| Task | Scope | Status |
|------|-------|--------|
| T1: Add minOrderId type | 1 field in 1 interface | Granular |
| T2: Create parseImageDate | 1 function, 1 new file | Granular |
| T3: orderId filtering in fetchNew | 1 logic block in 1 method | Granular |
| T4: Set rawPostedAt in markerToCandidate | 1 line change | Granular |
| T5: Tests for parseImageDate | 1 test file | Granular |
| T6: Tests for orderId filtering | Add to existing test file | Granular |
| T7: Full suite verification | Run commands | Granular |
