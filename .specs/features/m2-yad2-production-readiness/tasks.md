# Tasks: M2 - YAD2 Production Readiness

**Status:** Tasks Defined
**Created:** 2026-02-23
**Spec:** [spec.md](./spec.md)
**Design:** [design.md](./design.md)

---

## Task Dependency Graph

```
Phase 1: Database & Schema
  #1 Create migration 0010
    ↓
  #3 Run migration locally
    ↓
  #4 Add MonitoredCity type ──→ #9 Implement DB methods
                                  ↓
Phase 2: Connector Interface
  #2 Update Connector interface ──┬──→ #5 Update MockConnector
                                  ├──→ #6 Pass DB to collector
                                  └──→ #8 Refactor Yad2Connector ←─ #7 Add resultCounts type
                                          ↓
Phase 3: Testing
  #10 Create test script ──→ #11 Run YAD2 API test

  #12 Update unit tests (blocked by #8, #5)
    ↓
  #13 End-to-end test (blocked by #3, #8, #6)
    ↓
Phase 4: Documentation
  #14 Update README
    ↓
  #15 Update STATE.md
```

---

## Phase 1: Database & Schema

### Task #1: Create migration 0010 for monitored_cities table
**Status:** Pending
**Blocks:** #3
**Estimate:** 30 min

Create `packages/db/migrations/0010_monitored_cities.sql` with:
- CREATE TABLE monitored_cities (id, city_name, city_code, enabled, priority, created_at)
- UNIQUE constraint on city_code
- Index on (enabled, priority DESC)
- Seed 3 cities: תל אביב (5000, priority 100), ירושלים (3000, priority 90), חיפה (4000, priority 80)
- UPDATE sources SET enabled=0 WHERE name='mock'

**Acceptance:**
- Migration file exists and follows SQL conventions
- Seeds exactly 3 cities with correct codes
- Mock source disabled
- Index created for performance

---

### Task #4: Add MonitoredCity type to DB schema
**Status:** Pending
**Blocks:** #9
**Estimate:** 15 min

Update `packages/db/src/schema.ts` to add MonitoredCity interface:
```typescript
export interface MonitoredCity {
  id: number;
  city_name: string;
  city_code: number;
  enabled: boolean;
  priority: number;
  created_at: string;
}
```

**Acceptance:**
- Type exported from schema.ts
- Follows existing naming conventions
- All fields match migration schema

---

### Task #9: Implement DB methods for monitored cities
**Status:** Pending
**Blocked by:** #4
**Blocks:** #2, #8
**Estimate:** 45 min

Add to `packages/db/src/operations.ts`:
- `getEnabledCities(): Promise<MonitoredCity[]>` - ORDER BY priority DESC, id ASC
- `getCityByCode(cityCode: number): Promise<MonitoredCity | null>`
- `addMonitoredCity(cityName: string, cityCode: number, priority?: number): Promise<number>`
- `disableCity(cityCode: number): Promise<void>`
- `enableCity(cityCode: number): Promise<void>`

**Acceptance:**
- All methods implemented in D1DB class
- Queries use prepared statements
- getEnabledCities filters enabled=1
- Methods added to DB interface type

---

### Task #3: Run migration 0010 locally and verify
**Status:** Pending
**Blocked by:** #1
**Blocks:** #13
**Estimate:** 30 min

Execute migration and verify schema:
```bash
pnpm db:migrate
pnpm db:query "SELECT * FROM monitored_cities"
pnpm db:query "SELECT name, enabled FROM sources WHERE name='mock'"
pnpm db:query "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='monitored_cities'"
```

**Acceptance:**
- Migration runs without errors
- monitored_cities has exactly 3 rows with correct data
- mock source has enabled=0
- Index idx_monitored_cities_enabled exists
- TypeScript compiles (pnpm typecheck)

---

## Phase 2: Connector Refactor

### Task #2: Update Connector interface to accept DB parameter
**Status:** Pending
**Blocked by:** #9
**Blocks:** #5, #6, #8
**Estimate:** 15 min

Modify `packages/connectors/src/interface.ts`:

Change:
```typescript
fetchNew(cursor: string | null): Promise<FetchResult>;
```

To:
```typescript
fetchNew(cursor: string | null, db: DB): Promise<FetchResult>;
```

Add import: `import type { DB } from '@rentifier/db';`

**Acceptance:**
- Connector interface updated
- DB type imported correctly
- Breaking change documented in code comment

---

### Task #7: Add resultCounts to Yad2CursorState type
**Status:** Pending
**Blocks:** #8
**Estimate:** 10 min

Update `packages/connectors/src/yad2/types.ts`:

Add optional field to Yad2CursorState:
```typescript
export interface Yad2CursorState {
  lastFetchedAt: string | null;
  knownOrderIds: string[];
  consecutiveFailures: number;
  circuitOpenUntil: string | null;
  lastCityIndex: number;
  resultCounts?: Record<number, number>; // cityCode → last result count
}
```

**Acceptance:**
- Field is optional (backward compatible with existing cursors)
- Type is Record<number, number>
- Comment explains the mapping

---

### Task #8: Refactor Yad2Connector to use monitored_cities
**Status:** Pending
**Blocked by:** #2, #7, #9
**Blocks:** #12, #13
**Estimate:** 1-2 hours

Update `packages/connectors/src/yad2/index.ts`:

1. Update fetchNew signature to accept `db: DB`
2. Replace hardcoded city lookup with `await db.getEnabledCities()`
3. Handle empty cities array (log warning, return empty)
4. Use city.city_code and city.city_name instead of hardcoded values
5. Track result count in cursor state:
   - Update resultCounts: `{ ...state.resultCounts, [city.city_code]: markers.length }`
6. Log warning when markers.length === 200:
   ```json
   {
     "event": "yad2_result_limit_warning",
     "city": city.city_name,
     "cityCode": city.city_code,
     "resultCount": 200,
     "message": "City may have truncated results. Consider splitting query."
   }
   ```
7. Remove import of YAD2_CITY_CODES from constants

**Acceptance:**
- No hardcoded cities in connector
- Empty cities handled gracefully
- 200-result warning logged
- Cursor state includes resultCounts
- TypeScript compiles

---

### Task #5: Update MockConnector to accept DB parameter
**Status:** Pending
**Blocked by:** #2
**Blocks:** #12
**Estimate:** 10 min

Update `packages/connectors/src/mock.ts`:

Change fetchNew signature:
```typescript
async fetchNew(cursor: string | null, _db: DB): Promise<FetchResult> {
  // existing implementation unchanged
}
```

Add import: `import type { DB } from '@rentifier/db';`

Note: Parameter unused but required for interface compliance.

**Acceptance:**
- Signature matches Connector interface
- Parameter prefixed with underscore (unused)
- Functionality unchanged
- TypeScript compiles

---

### Task #6: Pass DB to connector.fetchNew in collector
**Status:** Pending
**Blocked by:** #2
**Blocks:** #13
**Estimate:** 15 min

Update `apps/collector/src/fetch-source.ts`:

Change:
```typescript
const fetchResult = await connector.fetchNew(state.cursor);
```

To:
```typescript
const fetchResult = await connector.fetchNew(state.cursor, db);
```

Ensure db parameter is available in function scope (passed from runCollector).

**Acceptance:**
- DB instance passed to connector
- No TypeScript errors
- Collector compiles successfully

---

## Phase 3: Testing & Verification

### Task #10: Create YAD2 API test script
**Status:** Pending
**Blocks:** #11
**Estimate:** 30 min

Create `scripts/test-yad2-api.ts`:

Test script that:
1. Imports fetchWithRetry from yad2/client
2. Tests 3 cities: תל אביב (5000), ירושלים (3000), חיפה (4000)
3. Logs for each: city name, result count, has markers, first marker sample
4. Catches and logs errors per city

Include package.json script:
```json
"test:yad2": "tsx scripts/test-yad2-api.ts"
```

**Acceptance:**
- Script exists and runs with `pnpm test:yad2`
- Tests all 3 cities
- Outputs structured JSON logs
- Handles errors gracefully

---

### Task #11: Run YAD2 API verification test
**Status:** Pending
**Blocked by:** #10
**Estimate:** 30 min

Execute test script and verify YAD2 rental endpoint:

```bash
pnpm test:yad2
```

Document results:
- Does /rent/map endpoint work?
- Result count per city
- Response structure matches types?
- Any errors or captcha blocks?

**Success criteria:**
- All 3 cities return 200 OK
- data.markers is array
- Result count ≤ 200 per city
- Response fields match Yad2Marker type
- No captcha blocks

**Failure handling:**
- If endpoint fails, document error and consider fallback to /forsale/map
- If captcha encountered, wait and retry

Add findings to design.md or create test-results.md

---

### Task #12: Update unit tests for Connector interface change
**Status:** Pending
**Blocked by:** #8, #5
**Blocks:** #13
**Estimate:** 1 hour

Update test files to mock db parameter:

1. `packages/connectors/src/yad2/__tests__/connector.test.ts`:
   - Mock db.getEnabledCities() to return test cities
   - Test: fetches from enabled cities only
   - Test: skips fetch when no cities enabled
   - Test: logs warning when hitting 200 results
   - Test: tracks resultCounts in cursor state

2. `packages/connectors/src/mock.ts` tests (if exist):
   - Pass mock db to fetchNew

**Acceptance:**
- All existing tests pass
- New tests for city fetching behavior
- New tests for 200-result warning
- Mock db created with vi.fn()
- pnpm test passes

---

### Task #13: End-to-end manual test: collector → processor → notify
**Status:** Pending
**Blocked by:** #3, #8, #6
**Blocks:** #14
**Estimate:** 1-2 hours

Run full flow manually and verify:

1. Start local dev: `pnpm dev`
2. Trigger collector: Invoke scheduled event or use test harness
3. Query listings_raw:
   ```sql
   SELECT source_id, COUNT(*) FROM listings_raw GROUP BY source_id
   ```
   - Expect: source_id=2 (yad2), COUNT > 0
   - Expect: NO source_id=1 (mock) entries

4. Trigger processor
5. Query listings table:
   ```sql
   SELECT id, title, city, price FROM listings LIMIT 5
   ```
   - Expect: Hebrew titles, normalized cities, valid prices

6. Trigger notify worker
7. Check Telegram for notification
   - Expect: Message with image, street address, Hebrew city name

**Success criteria:**
- YAD2 data flows through entire pipeline
- No mock data in database
- Hebrew normalization working
- Images and addresses present
- Telegram notification received

Document any issues in test notes.

---

## Phase 4: Documentation

### Task #14: Update README with city configuration docs
**Status:** Pending
**Blocked by:** #13
**Blocks:** #15
**Estimate:** 30 min

Add section to README.md explaining monitored cities:

**City Configuration**
- How monitored_cities table works
- How to add a new city (SQL + city code)
- How to disable/enable cities
- How to change priority
- Where to find YAD2 city codes

**Managing Cities**
```sql
-- Add new city
INSERT INTO monitored_cities (city_name, city_code, enabled, priority)
VALUES ('רמת גן', 8600, 1, 70);

-- Disable a city
UPDATE monitored_cities SET enabled=0 WHERE city_code=8600;

-- Change priority
UPDATE monitored_cities SET priority=95 WHERE city_code=5000;
```

**Acceptance:**
- Clear instructions for city management
- SQL examples provided
- Linked from main README navigation
- Mentions priority affects fetch order

---

### Task #15: Update STATE.md with completion status
**Status:** Pending
**Blocked by:** #13, #14
**Estimate:** 15 min

After all tasks complete, update `.specs/project/STATE.md`:

1. Change "Current Work" to completed milestone
2. Add to "Completed Milestones" section:
   ```
   ### M2 - YAD2 Production Readiness (2026-02-23)

   Complete YAD2 connector production readiness. All tasks completed:
   - Database: monitored_cities table with 3 seeded cities
   - Connector: Dynamic city fetching, 200-result monitoring
   - Mock removal: Disabled in database, kept for tests
   - Verification: API endpoint confirmed, end-to-end tested
   - Status: Ready for deployment
   - Files: [list key files modified]
   - Documentation: City configuration guide in README
   ```

3. Update ROADMAP.md to mark feature complete

**Acceptance:**
- STATE.md reflects completion
- ROADMAP.md updated
- Lessons learned added if applicable

---

## Summary

**Total tasks:** 15
**Estimated time:** 8-11 hours
**Phases:** 4

### Execution Order (unblocked tasks first)

**Start immediately:**
- #1 Create migration
- #4 Add MonitoredCity type
- #7 Add resultCounts type
- #10 Create test script

**After #4:**
- #9 Implement DB methods

**After #1:**
- #3 Run migration

**After #9:**
- #2 Update Connector interface

**After #2:**
- #5 Update MockConnector
- #6 Pass DB to collector

**After #2, #7, #9:**
- #8 Refactor Yad2Connector

**After #10:**
- #11 Run YAD2 API test

**After #8, #5:**
- #12 Update unit tests

**After #3, #8, #6:**
- #13 End-to-end test

**After #13:**
- #14 Update README

**After #13, #14:**
- #15 Update STATE.md

---

## Risk Factors

1. **YAD2 endpoint may differ** - Mitigated by early testing (Task #11)
2. **Breaking change to interface** - All connectors updated in same batch
3. **Migration may fail** - Tested locally before any deployment
4. **200-result limit not detectable** - Log analysis will reveal patterns

---

## Success Criteria

- ✅ All 15 tasks completed
- ✅ Zero TypeScript errors
- ✅ All unit tests passing
- ✅ End-to-end flow verified
- ✅ No mock data in production
- ✅ Documentation complete
