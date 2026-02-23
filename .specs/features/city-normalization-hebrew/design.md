# Design: Hebrew City Name Normalization

**Feature:** Hebrew City Name Normalization
**Status:** Draft
**Date:** 2026-02-23

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Data Sources                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐              │
│  │   YAD2   │  │ Facebook │  │ Future Sources│              │
│  └────┬─────┘  └────┬─────┘  └──────┬───────┘              │
│       │             │                │                       │
│       └─────────────┴────────────────┘                       │
│                     │                                        │
└─────────────────────┼────────────────────────────────────────┘
                      │
                      ▼
         ┌────────────────────────┐
         │  Connector.normalize() │
         │  ↓                     │
         │  normalizeCity()       │◄──── NEW: City normalization
         └────────┬───────────────┘      utility function
                  │
                  ▼
         ┌────────────────────────┐
         │  Processor Pipeline    │
         │  ↓                     │
         │  extractLocation()     │◄──── UPDATED: Use Hebrew
         └────────┬───────────────┘      canonical names
                  │
                  ▼
         ┌────────────────────────┐
         │   listings table       │
         │   city: "תל אביב"      │◄──── RESULT: Hebrew only
         └────────────────────────┘
```

---

## Component Design

### 1. City Normalization Module

**Location:** `packages/extraction/src/cities.ts`

**Purpose:** Single source of truth for city name normalization

**Interface:**

```typescript
/**
 * Canonical Hebrew city names used throughout the system.
 * These match YAD2's city codes and are the standard form for storage.
 */
export const CANONICAL_CITY_NAMES = {
  'תל אביב': 'תל אביב',
  'ירושלים': 'ירושלים',
  'חיפה': 'חיפה',
  'הרצליה': 'הרצליה',
  'רמת גן': 'רמת גן',
  'גבעתיים': 'גבעתיים',
  'באר שבע': 'באר שבע',
  'נתניה': 'נתניה',
  'ראשון לציון': 'ראשון לציון',
  'פתח תקווה': 'פתח תקווה',
} as const;

/**
 * All known variants of city names mapped to Hebrew canonical form.
 * Includes Hebrew variants, English variants, and common abbreviations.
 */
export const CITY_VARIANTS: Record<string, string> = {
  // Hebrew variants
  'תל אביב': 'תל אביב',
  'תל-אביב': 'תל אביב',
  'ת"א': 'תל אביב',
  'ירושלים': 'ירושלים',
  'ירושלַיִם': 'ירושלים',
  'חיפה': 'חיפה',
  'הרצליה': 'הרצליה',
  'רמת גן': 'רמת גן',
  'רמת-גן': 'רמת גן',
  'רמ"ג': 'רמת גן',
  'גבעתיים': 'גבעתיים',
  'באר שבע': 'באר שבע',
  'באר-שבע': 'באר שבע',
  'ב"ש': 'באר שבע',
  'נתניה': 'נתניה',
  'ראשון לציון': 'ראשון לציון',
  'ראשון': 'ראשון לציון',
  'ראשל"צ': 'ראשון לציון',
  'פתח תקווה': 'פתח תקווה',
  'פתח-תקווה': 'פתח תקווה',
  'פת"ח': 'פתח תקווה',

  // English variants (case-insensitive matching)
  'tel aviv': 'תל אביב',
  'tel-aviv': 'תל אביב',
  'tlv': 'תל אביב',
  'jerusalem': 'ירושלים',
  'haifa': 'חיפה',
  'herzliya': 'הרצליה',
  'herzlia': 'הרצליה',
  'ramat gan': 'רמת גן',
  'ramat-gan': 'רמת גן',
  'givatayim': 'גבעתיים',
  'giv\'atayim': 'גבעתיים',
  'beer sheva': 'באר שבע',
  'be\'er sheva': 'באר שבע',
  'beersheba': 'באר שבע',
  'netanya': 'נתניה',
  'rishon lezion': 'ראשון לציון',
  'rishon le zion': 'ראשון לציון',
  'petah tikva': 'פתח תקווה',
  'petach tikva': 'פתח תקווה',
  'petah-tikva': 'פתח תקווה',
};

/**
 * Normalize a city name to its Hebrew canonical form.
 *
 * @param input - City name in any recognized variant
 * @returns Hebrew canonical name, or null if not recognized
 *
 * @example
 * normalizeCity('Tel Aviv') → 'תל אביב'
 * normalizeCity('תל-אביב') → 'תל אביב'
 * normalizeCity('Unknown City') → null
 */
export function normalizeCity(input: string | null | undefined): string | null {
  if (!input) return null;

  // Try exact match first (case-sensitive for Hebrew)
  if (CITY_VARIANTS[input]) {
    return CITY_VARIANTS[input];
  }

  // Try case-insensitive match for English variants
  const lowerInput = input.toLowerCase().trim();
  if (CITY_VARIANTS[lowerInput]) {
    return CITY_VARIANTS[lowerInput];
  }

  // Not recognized - log warning and return null
  console.log(JSON.stringify({
    event: 'unknown_city',
    input,
    message: 'City name not in normalization map',
  }));

  return null;
}

/**
 * Hebrew neighborhood names by city.
 * Keys are Hebrew canonical city names.
 */
export const CITY_NEIGHBORHOODS: Record<string, Record<string, string>> = {
  'תל אביב': {
    'פלורנטין': 'פלורנטין',
    'florentin': 'פלורנטין',
    'נווה צדק': 'נווה צדק',
    'neve tzedek': 'נווה צדק',
    'הצפון הישן': 'הצפון הישן',
    'old north': 'הצפון הישן',
    'יפו': 'יפו',
    'jaffa': 'יפו',
    'רוטשילד': 'רוטשילד',
    'rothschild': 'רוטשילד',
    'לב העיר': 'לב העיר',
    'city center': 'לב העיר',
  },
  'ירושלים': {
    'נחלאות': 'נחלאות',
    'nachlaot': 'נחלאות',
    'המושבה הגרמנית': 'המושבה הגרמנית',
    'german colony': 'המושבה הגרמנית',
    'רחביה': 'רחביה',
    'rehavia': 'רחביה',
    'בקעה': 'בקעה',
    'baka': 'בקעה',
    'טלביה': 'טלביה',
    'talbiya': 'טלביה',
  },
  'חיפה': {
    'כרמל': 'כרמל',
    'carmel': 'כרמל',
    'הדר': 'הדר',
    'hadar': 'הדר',
    'עיר תחתית': 'עיר תחתית',
    'downtown': 'עיר תחתית',
  },
  'הרצליה': {
    'הרצליה פיתוח': 'הרצליה פיתוח',
    'herzliya pituach': 'הרצליה פיתוח',
  },
  'רמת גן': {
    'בורסה': 'בורסה',
    'bursa': 'בורסה',
  },
};
```

**Design Rationale:**
- **Single source of truth**: All city normalization logic in one place
- **Extensible**: Easy to add new cities or variants
- **Case-insensitive English matching**: User-friendly for mixed input
- **Logging for unknowns**: Helps identify missing cities
- **Type-safe**: Uses `as const` for canonical names

---

### 2. Update Extraction Patterns

**Location:** `packages/extraction/src/patterns.ts`

**Changes:**

```typescript
// BEFORE:
export const CITY_NAMES: Record<string, string> = {
  'תל אביב': 'Tel Aviv',
  'tel aviv': 'Tel Aviv',
  // ... maps to English
};

// AFTER:
import { CITY_VARIANTS } from './cities';

export const CITY_NAMES = CITY_VARIANTS; // Now maps to Hebrew
```

**Impact:**
- `extractLocation()` now returns Hebrew city names
- No logic changes needed in the extraction function itself
- Backward compatible (same function signature)

---

### 3. Update YAD2 Connector

**Location:** `packages/connectors/src/yad2/index.ts`

**Changes in `normalize()` method:**

```typescript
// BEFORE:
normalize(candidate: ListingCandidate): ListingDraft {
  const sd = candidate.sourceData as Partial<Yad2Marker>;

  return {
    // ...
    city: sd.address?.city?.text ?? null,
    // ...
  };
}

// AFTER:
import { normalizeCity } from '@rentifier/extraction';

normalize(candidate: ListingCandidate): ListingDraft {
  const sd = candidate.sourceData as Partial<Yad2Marker>;

  const rawCity = sd.address?.city?.text;
  const normalizedCity = rawCity ? normalizeCity(rawCity) : null;

  // If normalization fails, fall back to raw but log warning
  const city = normalizedCity ?? rawCity ?? null;

  return {
    // ...
    city,
    // ...
  };
}
```

**Design Rationale:**
- Try normalization first
- Graceful fallback to raw value (prevents data loss)
- Warning logged by `normalizeCity()` for unknown cities
- Connector remains functional even if normalization map incomplete

---

### 4. Processing Pipeline

**Location:** `apps/processor/src/pipeline.ts`

**Current Code (Line 86):**
```typescript
city: extraction.location?.city ?? draft.city ?? null,
```

**No changes needed!** Both `extraction.location?.city` and `draft.city` now return Hebrew names.

**Data Flow:**
1. `draft.city` from connector → Hebrew (via `normalizeCity()`)
2. `extraction.location?.city` from patterns → Hebrew (via `CITY_VARIANTS`)
3. Priority: extraction first, then draft

---

### 5. Data Migration

**Location:** `packages/db/migrations/0009_normalize_city_names.sql`

```sql
-- Migration: Normalize existing city names to Hebrew canonical form
-- Date: 2026-02-23
-- Description: Update all English city names to Hebrew for consistency

-- Tel Aviv variants
UPDATE listings
SET city = 'תל אביב'
WHERE city IN ('Tel Aviv', 'tel aviv', 'TLV', 'tel-aviv', 'תל-אביב');

-- Jerusalem variants
UPDATE listings
SET city = 'ירושלים'
WHERE city IN ('Jerusalem', 'jerusalem');

-- Haifa variants
UPDATE listings
SET city = 'חיפה'
WHERE city IN ('Haifa', 'haifa');

-- Herzliya variants
UPDATE listings
SET city = 'הרצליה'
WHERE city IN ('Herzliya', 'herzliya', 'Herzlia', 'herzlia');

-- Ramat Gan variants
UPDATE listings
SET city = 'רמת גן'
WHERE city IN ('Ramat Gan', 'ramat gan', 'ramat-gan', 'Ramat-Gan', 'רמת-גן');

-- Giv'atayim variants
UPDATE listings
SET city = 'גבעתיים'
WHERE city IN ('Givatayim', 'givatayim', 'Giv''atayim', 'giv''atayim');

-- Be'er Sheva variants
UPDATE listings
SET city = 'באר שבע'
WHERE city IN ('Beer Sheva', 'beer sheva', 'Be''er Sheva', 'be''er sheva', 'Beersheba', 'beersheba', 'באר-שבע');

-- Netanya variants
UPDATE listings
SET city = 'נתניה'
WHERE city IN ('Netanya', 'netanya');

-- Rishon LeZion variants
UPDATE listings
SET city = 'ראשון לציון'
WHERE city IN ('Rishon LeZion', 'rishon lezion', 'Rishon le Zion', 'rishon le zion', 'ראשון');

-- Petah Tikva variants
UPDATE listings
SET city = 'פתח תקווה'
WHERE city IN ('Petah Tikva', 'petah tikva', 'Petach Tikva', 'petach tikva', 'Petah-Tikva', 'petah-tikva', 'פתח-תקווה');

-- Verification query (run after migration to check results)
-- SELECT city, COUNT(*) as count FROM listings GROUP BY city ORDER BY count DESC;
```

**Rollback (if needed):**
Not recommended - data should move forward to Hebrew. If absolutely necessary, reverse mapping can be created.

---

### 6. Test Updates

**YAD2 Connector Tests:** `packages/connectors/src/yad2/__tests__/connector.test.ts`

```typescript
// Update expectations:
expect(draft.city).toBe('תל אביב'); // instead of 'Tel Aviv'
expect(draft.neighborhood).toBe('פלורנטין'); // if we normalize neighborhoods
```

**Extraction Tests:** `packages/extraction/src/__tests__/extractors.test.ts`

```typescript
describe('extractLocation', () => {
  it('should extract Hebrew city from Hebrew text', () => {
    const result = extractLocation('דירה בתל אביב');
    expect(result?.city).toBe('תל אביב');
  });

  it('should normalize English city to Hebrew', () => {
    const result = extractLocation('Apartment in Tel Aviv');
    expect(result?.city).toBe('תל אביב');
  });

  it('should handle hyphenated Hebrew variants', () => {
    const result = extractLocation('דירה בתל-אביב');
    expect(result?.city).toBe('תל אביב');
  });
});
```

**New Test File:** `packages/extraction/src/__tests__/cities.test.ts`

Test all normalization variants comprehensively.

---

## Future Extensibility

### Adding a New Data Source

When implementing a new connector (e.g., Facebook):

```typescript
// packages/connectors/src/facebook/connector.ts
import { normalizeCity } from '@rentifier/extraction';

class FacebookConnector implements Connector {
  normalize(candidate: ListingCandidate): ListingDraft {
    const fbData = candidate.sourceData as FacebookListing;

    return {
      // ...
      city: normalizeCity(fbData.location?.city) ?? fbData.location?.city ?? null,
      // ...
    };
  }
}
```

**Key principle:** Always call `normalizeCity()` before storing city names.

### Adding a New City

1. Add to `CANONICAL_CITY_NAMES` in `cities.ts`
2. Add all known variants to `CITY_VARIANTS`
3. Add neighborhood map if needed
4. Update migration if historical data exists
5. Add test cases

---

## Performance Considerations

- **Normalization overhead:** Minimal - simple Map lookup, O(1)
- **Migration impact:** One-time UPDATE, should be fast (< 10k rows expected)
- **No indexes affected:** `city` column may benefit from an index later for filtering

---

## Backward Compatibility

### Existing Filters

If users have saved filters with English city names in `cities_json`:

**Option 1 (Recommended):** Migrate filter data too
```sql
-- Update filter city arrays
UPDATE filters
SET cities_json = REPLACE(cities_json, '"Tel Aviv"', '"תל אביב"')
WHERE cities_json LIKE '%Tel Aviv%';
```

**Option 2:** Handle in filter matching logic (more complex, deferred)

For M3, we can defer this since filters aren't fully implemented yet.

---

## Logging & Monitoring

Log events:
- `unknown_city` - City not in normalization map (triggers manual review)
- `city_normalized` - Successful normalization (debug level)
- `city_fallback` - Used raw value after normalization failed (warning)

---

## Open Issues

1. **Neighborhood normalization:** Out of scope, but architecture supports it
2. **Filter migration:** Can be deferred until filter matching implementation
3. **Transliteration variants:** May need more variants as we see real data

---

## Dependencies

- No external dependencies
- No schema changes
- No API changes

---

## Rollback Plan

If issues arise:
1. Revert code changes (Git revert)
2. Migration is forward-only (Hebrew is the target state)
3. Fix bugs and re-deploy rather than rollback migration
