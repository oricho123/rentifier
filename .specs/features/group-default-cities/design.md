# Design: Group Default Cities

## Overview

Pass group-level default cities through the extraction pipeline so that Facebook posts without an explicit city mention inherit the group's default city. The change flows through 3 layers: config → collector → normalizer/processor.

## Architecture

```
MONITORED_GROUPS (constants.ts)
  ↓ defaultCities: ["תל אביב"]
FacebookConnector.fetchNew()
  ↓ stores groupId in ListingCandidate.sourceData
collect-facebook.ts → raw_listings.raw_json
  ↓ raw_json contains sourceData.groupId
Processor pipeline
  ↓ reads groupId from candidate
FacebookNormalizer.normalize(candidate)
  ↓ looks up group config → gets defaultCities
  ↓ passes defaultCities to extractAll() or applies post-extraction
ListingDraft / ListingRow
  ↓ city filled from default when extraction returns null
```

## Changes

### 0. Fix substring matching with word boundaries

**File:** `packages/extraction/src/extractors.ts`

Replace `text.includes(variant)` with a word-boundary-aware helper:

```typescript
/**
 * Check if a Hebrew/English term appears as a whole word/phrase in text.
 * Prevents "הדר" from matching inside "נהדר" or "יפו" inside "יפות".
 */
function includesWord(text: string, word: string): boolean {
  const idx = text.indexOf(word);
  if (idx === -1) {
    // Try case-insensitive for English
    const lowerIdx = text.toLowerCase().indexOf(word.toLowerCase());
    if (lowerIdx === -1) return false;
    return checkBoundaries(text, lowerIdx, word.length);
  }
  return checkBoundaries(text, idx, word.length);
}

function checkBoundaries(text: string, idx: number, len: number): boolean {
  // Character before must be start-of-string, space, or punctuation
  if (idx > 0) {
    const before = text[idx - 1];
    if (/\p{L}/u.test(before)) return false; // preceded by a letter = substring
  }
  // Character after must be end-of-string, space, or punctuation
  const afterIdx = idx + len;
  if (afterIdx < text.length) {
    const after = text[afterIdx];
    if (/\p{L}/u.test(after)) return false; // followed by a letter = substring
  }
  return true;
}
```

Update `extractLocation()` to use `includesWord()` instead of `text.includes()` for both city and neighborhood matching.

### 0b. Add missing neighborhoods

**File:** `packages/extraction/src/cities.ts`

Add to Tel Aviv neighborhoods:
```typescript
'התקווה': 'התקווה',
'שכונת התקווה': 'התקווה',
'hatikva': 'התקווה',
```

Review and add other commonly missing Tel Aviv neighborhoods (e.g., נוה עופר, כפר שלם, etc.) as discovered.

### 1. Update MONITORED_GROUPS config

**File:** `packages/connectors/src/facebook/constants.ts`

```typescript
export const MONITORED_GROUPS: {
  groupId: string;
  name: string;
  defaultCities: string[];  // Canonical Hebrew city names
}[] = [
  {
    groupId: '305724686290054',
    name: 'דירות להשכרה בתל אביב',
    defaultCities: ['תל אביב'],
  },
  {
    groupId: '981208559966255',
    name: '[RENTME] דירות להשכרה בתל אביב ללא תיווך',
    defaultCities: ['תל אביב'],
  },
  {
    groupId: '101875683484689',
    name: 'דירות מפה לאוזן בתל אביב',
    defaultCities: ['תל אביב'],
  },
];
```

### 2. Ensure groupId flows through the pipeline

**Already done.** The Facebook collector stores `groupId` in `ListingCandidate.sourceData`:
- `client.ts` → `extractPostsFromDOM()` returns `FacebookPost` with `groupId`
- `FacebookConnector.fetchNew()` → maps to `ListingCandidate` with `sourceData: { ...post }`
- `raw_json` in DB contains the full candidate including `sourceData.groupId`

### 3. Add group lookup helper

**File:** `packages/connectors/src/facebook/constants.ts`

```typescript
/** Look up a monitored group by ID. Returns undefined if not found. */
export function getMonitoredGroup(groupId: string) {
  return MONITORED_GROUPS.find(g => g.groupId === groupId);
}
```

### 4. Update FacebookNormalizer.normalize()

**File:** `packages/connectors/src/facebook/normalize.ts`

The normalizer already calls `extractAll()` and reads `extraction.location`. After extraction, if no city was found, apply the group default:

```typescript
normalize(candidate: ListingCandidate): ListingDraft {
  const extraction = extractAll(candidate.rawTitle, candidate.rawDescription);
  const sourceData = candidate.sourceData as Record<string, unknown>;
  const groupId = sourceData?.groupId as string | undefined;

  let city = extraction.location?.city ?? null;
  let neighborhood = extraction.location?.neighborhood ?? null;

  // Apply group default city when extraction found nothing
  if (!city && groupId) {
    const group = getMonitoredGroup(groupId);
    if (group && group.defaultCities.length > 0) {
      city = group.defaultCities[0];

      // Try to resolve neighborhood within the default city
      if (!neighborhood) {
        const combinedText = `${candidate.rawTitle} ${candidate.rawDescription}`;
        neighborhood = matchNeighborhoodInCity(combinedText, city);
      }
    }
  }

  return {
    // ... existing fields ...
    city,
    neighborhood,
    // ...
  };
}
```

### 5. Add neighborhood matching helper

**File:** `packages/extraction/src/extractors.ts`

Export a new function that searches for neighborhoods within a specific city only:

```typescript
export function matchNeighborhoodInCity(text: string, city: string): string | null {
  const neighborhoods = CITY_NEIGHBORHOODS[city];
  if (!neighborhoods) return null;

  const lowerText = text.toLowerCase();
  for (const [variant, canonical] of Object.entries(neighborhoods)) {
    if (text.includes(variant) || lowerText.includes(variant.toLowerCase())) {
      return canonical;
    }
  }
  return null;
}
```

### 6. Processor pipeline — no changes needed

The processor already uses the normalizer's output:
```typescript
city: extraction.location?.city ?? draft.city ?? null,
neighborhood: extraction.location?.neighborhood ?? draft.neighborhood ?? null,
```

Since `draft.city` and `draft.neighborhood` will now be populated by the normalizer's group default logic, the processor will pick them up via the `?? draft.city` fallback. The processor's own `extractAll()` re-extraction runs on the same text, so it will also return null for city — and the draft fallback kicks in.

## Data Flow Example

**Post:** "3 חדרים בפלורנטין, 7500 ש״ח לחודש" in group 305724686290054

1. `extractAll()` → `location: null` (no city variant found, פלורנטין reverse-lookup finds Tel Aviv but only if extractLocation does the reverse lookup)
   - Actually, `extractLocation()` already does neighborhood reverse-lookup which would find פלורנטין → תל אביב. But for posts where even neighborhood isn't found...

2. For a post like "דירה יפה 5000 ש״ח" with no location info at all:
   - `extractAll()` → `location: null`
   - Normalizer checks groupId → finds default `['תל אביב']`
   - Sets `city: 'תל אביב'`, `neighborhood: null`

3. For a post like "דירה בחיפה 4000 ש״ח" in a Tel Aviv group:
   - `extractAll()` → `location: { city: 'חיפה', neighborhood: null, confidence: 0.8 }`
   - Normalizer sees city is already set → keeps חיפה

## Test Plan

1. **Default city applied**: Post with no city/neighborhood in a group with defaultCities → gets default city
2. **Explicit city preserved**: Post mentioning חיפה in a Tel Aviv group → keeps חיפה
3. **Neighborhood resolved**: Post mentioning פלורנטין (but no city) in Tel Aviv group → gets both city and neighborhood
4. **No group match**: Post with unknown groupId → city stays null (graceful fallback)
5. **Multi-city group**: Group with `defaultCities: ['תל אביב', 'רמת גן']` → first city used as default
6. **Existing extraction unaffected**: Posts with explicit city mentions remain unchanged

## Risks

- **False positives from group default**: A post in a Tel Aviv group about a listing in another city that doesn't mention the city explicitly would get tagged as Tel Aviv. This is acceptable — most posts in city-specific groups are for that city.
- **Word boundary edge cases**: Hebrew doesn't use spaces consistently (e.g., "ביפו" = "in Jaffa"). The `\p{L}` check treats Hebrew letters as word characters, so "ביפו" won't match "יפו". This is actually correct behavior — "ביפו" should be handled by adding "ביפו" as a variant of יפו, or by stripping the ב prefix in a future enhancement. For now, the existing `ב` prefix patterns in other extractors handle this for prices but not locations.
- **Performance**: Word boundary check is O(n) per variant per text, same as `includes()`. No measurable impact.
