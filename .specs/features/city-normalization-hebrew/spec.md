# Feature Spec: Hebrew City Name Normalization

**Status:** Draft
**Created:** 2026-02-23
**Type:** Bug Fix / Data Quality

---

## Problem Statement

Currently, the `listings` table contains inconsistent city names - some in Hebrew, some in English. This creates problems for:
- **Filtering**: Users can't reliably filter by city
- **Display**: Telegram messages show inconsistent city names
- **User Experience**: Hebrew UI with mixed language city names is confusing

### Root Cause

The data pipeline has conflicting normalization logic:

1. **YAD2 API** returns `address.city.text` with inconsistent language (sometimes Hebrew, sometimes English)
2. **Extraction patterns** (`packages/extraction/src/patterns.ts`) map city variants to **English** canonical names
3. **Processing pipeline** prioritizes extraction over connector data:
   ```typescript
   city: extraction.location?.city ?? draft.city ?? null
   ```

**Result:** When extraction succeeds → English. When extraction fails → Hebrew from API.

---

## Requirements

### Functional Requirements

1. **FR-1**: All city names in the `listings` table must be in Hebrew
2. **FR-2**: Extraction patterns must normalize to Hebrew canonical names
3. **FR-3**: Connectors must provide Hebrew city names or map to Hebrew
4. **FR-4**: The solution must be extensible for future data sources (Facebook, other platforms)
5. **FR-5**: Existing data should be migrated to Hebrew names

### Non-Functional Requirements

1. **NFR-1**: No breaking changes to database schema
2. **NFR-2**: Backward compatible with existing filter data
3. **NFR-3**: Clear documentation for adding new cities

---

## Scope

### In Scope
- Update extraction patterns to use Hebrew canonical city names
- Add city normalization utility for all connectors to use
- Update YAD2 connector to ensure Hebrew output
- Data migration for existing listings
- Update tests to reflect Hebrew city names

### Out of Scope
- Multi-language support (deferred to future milestone)
- Neighborhood normalization (separate issue)
- Historical data preservation in other languages

---

## Success Criteria

1. ✅ All new listings have Hebrew city names
2. ✅ Existing listings are migrated to Hebrew
3. ✅ Extraction tests pass with Hebrew expectations
4. ✅ YAD2 connector tests pass with Hebrew expectations
5. ✅ Zero TypeScript errors
6. ✅ Manual verification: `SELECT DISTINCT city FROM listings` shows only Hebrew names

---

## Hebrew City Name Standards

### Canonical Forms

The following Hebrew forms are canonical (based on YAD2's `YAD2_CITY_CODES`):

| Hebrew (Canonical) | English (Reference Only) | YAD2 Code |
|-------------------|-------------------------|-----------|
| תל אביב           | Tel Aviv                | 5000      |
| ירושלים           | Jerusalem               | 3000      |
| חיפה              | Haifa                   | 4000      |
| הרצליה            | Herzliya                | 6400      |
| רמת גן            | Ramat Gan               | 8600      |
| גבעתיים           | Giv'atayim              | 6300      |
| באר שבע           | Be'er Sheva             | 7900      |
| נתניה             | Netanya                 | 7400      |
| ראשון לציון       | Rishon LeZion           | 8300      |
| פתח תקווה         | Petah Tikva             | 7900      |

### Variant Handling

The extraction layer should recognize common variants:
- With/without hyphens: `תל אביב` / `תל-אביב`
- English variants: `tel aviv`, `Tel Aviv`, `TLV`
- Common typos and abbreviations

All variants normalize to the Hebrew canonical form.

---

## Technical Approach

### 1. Shared Normalization Module

Create `packages/extraction/src/cities.ts`:
- Export `CANONICAL_CITY_NAMES` (Hebrew)
- Export `CITY_VARIANTS` mapping (all variants → Hebrew canonical)
- Export `normalizeCity(input: string): string | null` function

### 2. Update Extraction Patterns

`packages/extraction/src/patterns.ts`:
- Import from `cities.ts`
- Update `CITY_NAMES` to map to Hebrew
- Update `CITY_NEIGHBORHOODS` keys to Hebrew

### 3. Update YAD2 Connector

`packages/connectors/src/yad2/index.ts`:
- Import `normalizeCity` from `@rentifier/extraction`
- In `normalize()`, apply normalization:
  ```typescript
  city: normalizeCity(sd.address?.city?.text) ?? sd.address?.city?.text ?? null
  ```

### 4. Data Migration

Create migration `0009_normalize_city_names.sql`:
```sql
-- Update known English names to Hebrew
UPDATE listings SET city = 'תל אביב' WHERE city IN ('Tel Aviv', 'tel aviv', 'TLV');
UPDATE listings SET city = 'ירושלים' WHERE city IN ('Jerusalem', 'jerusalem');
UPDATE listings SET city = 'חיפה' WHERE city IN ('Haifa', 'haifa');
-- ... etc for all cities
```

### 5. Future-Proofing for New Sources

Any new connector (Facebook, etc.) should:
1. Import `normalizeCity` from `@rentifier/extraction`
2. Apply normalization in the `normalize()` method
3. Document in connector comments: "City names must be normalized to Hebrew canonical form"

---

## Open Questions

1. **Q**: Should we add a validation step that rejects listings with non-Hebrew cities?
   **A**: Not initially - just normalize. Add validation later if needed.

2. **Q**: What about cities not in the predefined list?
   **A**: Pass through as-is initially. Log warning. Add to canonical list on review.

3. **Q**: Should neighborhoods also be normalized to Hebrew?
   **A**: Out of scope for this fix. Address separately if needed.

---

## Testing Strategy

1. **Unit Tests**
   - Test `normalizeCity()` with all variants
   - Test extraction with Hebrew expectations
   - Test YAD2 connector with mixed API responses

2. **Integration Tests**
   - Run processor on sample data
   - Verify all cities in Hebrew

3. **Manual Verification**
   - Query local D1: `SELECT DISTINCT city, COUNT(*) FROM listings GROUP BY city`
   - Verify Telegram messages show Hebrew cities
   - Test filter creation with Hebrew city names

---

## Rollout Plan

1. Implement changes in feature branch
2. Run migration on local D1
3. Verify with manual testing
4. Merge to main
5. Deploy to production
6. Run migration on production D1
7. Monitor notifications for 24h

---

## Risks & Mitigation

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Existing filters break due to English city names | High | Migration script updates both listings AND existing filter data |
| New city not in canonical list | Medium | Graceful falleful fallback - log warning, pass through as-is |
| YAD2 API starts returning new format | Low | Normalization function handles unknown input gracefully |

---

## Dependencies

- None (self-contained feature)

---

## Related Documents

- `.specs/project/STATE.md` - AD-006: Hebrew-only localization for M3
- `packages/connectors/src/yad2/constants.ts` - YAD2_CITY_CODES
