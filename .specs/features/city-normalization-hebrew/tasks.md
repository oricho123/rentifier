# Tasks: Hebrew City Name Normalization

**Feature:** Hebrew City Name Normalization
**Status:** Ready for Implementation
**Date:** 2026-02-23

---

## Task Breakdown

### Phase 1: Foundation - City Normalization Module

**Task 1.1: Create city normalization module**
- **File:** `packages/extraction/src/cities.ts`
- **Description:** Create new module with city normalization logic
- **Deliverables:**
  - `CANONICAL_CITY_NAMES` constant
  - `CITY_VARIANTS` mapping object
  - `normalizeCity()` function
  - `CITY_NEIGHBORHOODS` mapping (Hebrew keys)
- **Acceptance Criteria:**
  - All 10 cities from YAD2_CITY_CODES included
  - Hebrew and English variants mapped
  - Function returns Hebrew canonical or null
  - TypeScript compiles with no errors
- **Estimated Complexity:** Low

**Task 1.2: Create tests for city normalization**
- **File:** `packages/extraction/src/__tests__/cities.test.ts`
- **Description:** Comprehensive test coverage for normalization
- **Test Cases:**
  - Hebrew canonical names return themselves
  - Hebrew variants normalize correctly
  - English variants normalize correctly (case-insensitive)
  - Unknown cities return null
  - Unknown cities log warning
  - Null/undefined input returns null
- **Acceptance Criteria:**
  - All test cases pass
  - 100% coverage of `normalizeCity()`
- **Estimated Complexity:** Low

---

### Phase 2: Update Extraction Layer

**Task 2.1: Update extraction patterns to use Hebrew**
- **File:** `packages/extraction/src/patterns.ts`
- **Description:** Replace English canonical names with Hebrew
- **Changes:**
  - Import `CITY_VARIANTS` from `./cities`
  - Replace `CITY_NAMES` with `CITY_VARIANTS`
  - Update `CITY_NEIGHBORHOODS` to import from `./cities`
  - Remove English canonical names
- **Acceptance Criteria:**
  - TypeScript compiles with no errors
  - No breaking changes to `extractLocation()` signature
- **Estimated Complexity:** Low

**Task 2.2: Update extraction module exports**
- **File:** `packages/extraction/src/index.ts`
- **Description:** Export new city normalization utilities
- **Changes:**
  - Add: `export { normalizeCity, CANONICAL_CITY_NAMES } from './cities';`
- **Acceptance Criteria:**
  - TypeScript compiles with no errors
  - Utilities accessible from `@rentifier/extraction`
- **Estimated Complexity:** Trivial

**Task 2.3: Update extraction tests**
- **File:** `packages/extraction/src/__tests__/extractors.test.ts`
- **Description:** Update test expectations to Hebrew
- **Changes:**
  - Update all `.toBe('Tel Aviv')` → `.toBe('תל אביב')`
  - Update all city assertions to Hebrew
  - Add tests for English input normalizing to Hebrew
- **Acceptance Criteria:**
  - All tests pass
  - Coverage maintained
- **Estimated Complexity:** Low

---

### Phase 3: Update YAD2 Connector

**Task 3.1: Add normalization to YAD2 connector**
- **File:** `packages/connectors/src/yad2/index.ts`
- **Description:** Apply city normalization in the `normalize()` method
- **Changes:**
  - Import `normalizeCity` from `@rentifier/extraction`
  - In `normalize()`, call `normalizeCity()` on `sd.address?.city?.text`
  - Use normalized value with fallback to raw
  - Add logging for normalization
- **Acceptance Criteria:**
  - TypeScript compiles with no errors
  - Graceful fallback if normalization returns null
  - Logging includes raw and normalized values
- **Estimated Complexity:** Low

**Task 3.2: Update YAD2 connector tests**
- **File:** `packages/connectors/src/yad2/__tests__/connector.test.ts`
- **Description:** Update test expectations to Hebrew
- **Changes:**
  - Update all city assertions to Hebrew
  - Add test case: API returns English → normalized to Hebrew
  - Add test case: API returns Hebrew → passthrough
  - Add test case: API returns unknown city → passthrough with warning
- **Acceptance Criteria:**
  - All tests pass
  - Coverage maintained or improved
- **Estimated Complexity:** Low

---

### Phase 4: Data Migration

**Task 4.1: Create migration SQL**
- **File:** `packages/db/migrations/0009_normalize_city_names.sql`
- **Description:** SQL migration to normalize existing city data
- **SQL Commands:**
  - UPDATE listings for each English variant → Hebrew canonical
  - Comments for each city
  - Verification query at the end
- **Acceptance Criteria:**
  - All known English variants covered
  - SQL syntax valid for SQLite
  - Idempotent (safe to run multiple times)
- **Estimated Complexity:** Low

**Task 4.2: Run migration locally**
- **Description:** Execute migration on local D1 database
- **Steps:**
  1. Backup current data: `SELECT * FROM listings`
  2. Run migration: `pnpm db:migrate`
  3. Verify: `SELECT DISTINCT city, COUNT(*) FROM listings GROUP BY city`
  4. Check for English names remaining
- **Acceptance Criteria:**
  - Migration completes without errors
  - All cities in Hebrew
  - No data loss (row count unchanged)
- **Estimated Complexity:** Trivial

---

### Phase 5: Integration & Verification

**Task 5.1: Run full type check**
- **Description:** Verify TypeScript compilation across all packages
- **Command:** `pnpm typecheck` (or equivalent)
- **Acceptance Criteria:**
  - Zero TypeScript errors
  - Zero warnings
- **Estimated Complexity:** Trivial

**Task 5.2: Run all tests**
- **Description:** Execute full test suite
- **Command:** `pnpm test`
- **Acceptance Criteria:**
  - All tests pass
  - No regressions
  - Coverage maintained
- **Estimated Complexity:** Trivial

**Task 5.3: Manual integration test**
- **Description:** End-to-end verification with local workers
- **Steps:**
  1. Run collector: Fetch new YAD2 listings
  2. Run processor: Process raw listings
  3. Query database: `SELECT city, title FROM listings ORDER BY ingested_at DESC LIMIT 10`
  4. Verify: All cities in Hebrew
  5. Run notify worker: Send test notification
  6. Verify: Telegram message shows Hebrew city name
- **Acceptance Criteria:**
  - New listings have Hebrew cities
  - Old listings migrated to Hebrew
  - Telegram messages display correctly
  - No errors in worker logs
- **Estimated Complexity:** Low

---

### Phase 6: Documentation & Cleanup

**Task 6.1: Update STATE.md**
- **File:** `.specs/project/STATE.md`
- **Description:** Record decision and completion
- **Add Decision:**
  - **AD-011**: Hebrew city name normalization
  - Document: normalization approach, rationale, migration
- **Add to Completed Work:**
  - Brief summary with file count and verification status
- **Acceptance Criteria:**
  - Decision documented
  - Lessons learned (if any) captured
- **Estimated Complexity:** Trivial

**Task 6.2: Create feature branch and commit**
- **Description:** Git workflow
- **Steps:**
  1. Checkout new branch: `git checkout -b fix/city-normalization-hebrew`
  2. Stage changes: `git add .`
  3. Commit with message
- **Commit Message:**
  ```
  fix: normalize all city names to Hebrew canonical form

  - Add city normalization module with CITY_VARIANTS mapping
  - Update extraction patterns to return Hebrew cities
  - Apply normalization in YAD2 connector
  - Migrate existing listings to Hebrew city names
  - Update all tests to expect Hebrew

  Fixes inconsistent city names (Hebrew/English mix) that broke filtering.
  All future sources will use Hebrew canonical form via normalizeCity().

  Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>
  ```
- **Acceptance Criteria:**
  - Clean commit history
  - Descriptive commit message
- **Estimated Complexity:** Trivial

**Task 6.3: Create pull request**
- **Description:** PR for code review
- **PR Details:**
  - Title: `fix: normalize all city names to Hebrew canonical form`
  - Description: Link to spec, summary of changes, verification steps
  - Link related issue (if any)
- **Acceptance Criteria:**
  - PR created with clear description
  - All CI checks pass (if configured)
- **Estimated Complexity:** Trivial

---

## Task Dependencies

```
Phase 1 (Foundation)
  ├─ 1.1 (Create module)
  └─ 1.2 (Tests) [depends on 1.1]

Phase 2 (Extraction)
  ├─ 2.1 (Update patterns) [depends on 1.1]
  ├─ 2.2 (Update exports) [depends on 1.1]
  └─ 2.3 (Update tests) [depends on 2.1, 2.2]

Phase 3 (Connector)
  ├─ 3.1 (Add normalization) [depends on 1.1, 2.2]
  └─ 3.2 (Update tests) [depends on 3.1]

Phase 4 (Migration)
  ├─ 4.1 (Create SQL)
  └─ 4.2 (Run locally) [depends on 4.1]

Phase 5 (Verification)
  ├─ 5.1 (Type check) [depends on Phase 1-3]
  ├─ 5.2 (Tests) [depends on Phase 1-3]
  └─ 5.3 (Integration) [depends on Phase 1-4]

Phase 6 (Documentation)
  ├─ 6.1 (STATE.md) [depends on Phase 5]
  ├─ 6.2 (Git commit) [depends on Phase 5]
  └─ 6.3 (Pull request) [depends on 6.2]
```

---

## Execution Strategy

**Recommended approach:** Sequential phases (waterfall within feature)

**Reasoning:**
- Foundation must be complete before other phases
- Each phase builds on previous
- Clear verification points

**Estimated total time:** 2-3 hours for implementation + testing

---

## Rollback Plan

If critical issues found:
1. Revert commits: `git revert HEAD`
2. Migration data stays Hebrew (target state)
3. Fix bugs and re-deploy

---

## Success Metrics

- ✅ Zero TypeScript errors
- ✅ All tests passing
- ✅ `SELECT DISTINCT city FROM listings` shows only Hebrew
- ✅ Telegram notifications display Hebrew cities
- ✅ Documentation updated
