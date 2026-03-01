# Design: M2 - YAD2 Production Readiness

**Status:** Design
**Created:** 2026-02-23
**Spec:** [spec.md](./spec.md)

---

## Architecture Overview

This feature refactors the YAD2 connector to use configurable city lists and removes mock connector pollution. The design prioritizes simplicity for single-user deployment while future-proofing for multi-user scenarios.

```
┌─────────────────────────────────────────────────────────────┐
│                      Collector Worker                        │
│                                                              │
│  1. Query monitored_cities (enabled=1)                      │
│  2. Round-robin through active cities                       │
│  3. Fetch YAD2 data per city (max 200 results)              │
│  4. Track results count in cursor state                     │
│  5. Log warning if hitting 200-result limit                 │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌──────────────────┐
                    │   listings_raw   │
                    │  (no mock data)  │
                    └──────────────────┘
```

---

## Design Decisions

### 1. City Configuration: Database Table

**Decision:** Store monitored cities in a new `monitored_cities` table.

**Rationale:**
- ✅ Future-proof for multi-user (each user can select cities)
- ✅ Can be modified without redeployment
- ✅ Supports metadata (priority, enabled/disabled per city)
- ✅ Simple queries, no parsing required
- ❌ Requires migration

**Alternatives considered:**
- **Environment variable:** Simple but inflexible, requires redeployment to change
- **Cloudflare KV:** Over-engineered for static configuration data
- **Hardcoded in code:** Current approach, rejected (no flexibility)

### 2. Mock Connector Removal Strategy

**Decision:** Disable mock source via migration, keep code for testing.

**Rationale:**
- ✅ Preserves MockConnector class for unit tests
- ✅ Simple migration to set `enabled=0`
- ✅ Can be re-enabled if needed for dev/testing
- ✅ No breaking changes to test suite

**Implementation:**
- Migration 0010: `UPDATE sources SET enabled=0 WHERE name='mock'`
- Keep `MockConnector` class in `packages/connectors/src/mock.ts`
- Remove from default registry? **No** - keep for testing, DB flag controls activation

### 3. YAD2 Endpoint Verification

**Decision:** Test `/rent/map` endpoint with manual script, document behavior.

**Rationale:**
- Current endpoint is assumed to work but unverified
- Need to confirm response structure matches TypeScript types
- Need to test city filtering parameter
- One-time validation, no code changes unless issues found

**Validation checklist:**
- [ ] Endpoint returns 200 OK
- [ ] Response has `data.markers` array
- [ ] City code parameter filters correctly
- [ ] Max 200 results confirmed
- [ ] Response fields match `Yad2Marker` type

### 4. Coverage Monitoring

**Decision:** Log when city fetch returns exactly 200 results.

**Rationale:**
- Simple detection: `markers.length === 200` → potential truncation
- Track in cursor state: `resultCounts: { [cityCode]: number }`
- Log warning for manual review
- Future: trigger multi-query strategy (price ranges, neighborhoods)

**Log format:**
```json
{
  "event": "yad2_result_limit_warning",
  "city": "תל אביב",
  "cityCode": 5000,
  "resultCount": 200,
  "message": "City may have truncated results. Consider splitting query."
}
```

---

## Database Schema Changes

### Migration 0010: Monitored Cities

```sql
-- Create monitored_cities table
CREATE TABLE IF NOT EXISTS monitored_cities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  city_name TEXT NOT NULL,
  city_code INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(city_code)
);

-- Create index for enabled cities query
CREATE INDEX IF NOT EXISTS idx_monitored_cities_enabled
  ON monitored_cities(enabled, priority DESC);

-- Seed initial cities (Tel Aviv, Jerusalem, Haifa)
INSERT INTO monitored_cities (city_name, city_code, enabled, priority) VALUES
  ('תל אביב', 5000, 1, 100),
  ('ירושלים', 3000, 1, 90),
  ('חיפה', 4000, 1, 80)
ON CONFLICT(city_code) DO NOTHING;

-- Disable mock source
UPDATE sources SET enabled=0 WHERE name='mock';
```

**Schema notes:**
- `city_name`: Hebrew display name (for logging)
- `city_code`: YAD2 API city code parameter
- `enabled`: Toggle monitoring per city (0=skip, 1=active)
- `priority`: Fetch order (higher priority first), allows market focus
- `UNIQUE(city_code)`: Prevent duplicate cities

### Updated DB Interface

Add to `packages/db/src/operations.ts`:

```typescript
export interface MonitoredCity {
  id: number;
  city_name: string;
  city_code: number;
  enabled: boolean;
  priority: number;
  created_at: string;
}

export interface DB {
  // ... existing methods ...

  // New methods
  getEnabledCities(): Promise<MonitoredCity[]>;
  getCityByCode(cityCode: number): Promise<MonitoredCity | null>;
  addMonitoredCity(cityName: string, cityCode: number, priority?: number): Promise<number>;
  disableCity(cityCode: number): Promise<void>;
  enableCity(cityCode: number): Promise<void>;
}
```

**Implementation:**

```typescript
async getEnabledCities(): Promise<MonitoredCity[]> {
  const rows = await this.db
    .prepare('SELECT * FROM monitored_cities WHERE enabled=1 ORDER BY priority DESC, id ASC')
    .all<MonitoredCity>();
  return rows.results;
}

async getCityByCode(cityCode: number): Promise<MonitoredCity | null> {
  const row = await this.db
    .prepare('SELECT * FROM monitored_cities WHERE city_code=?')
    .bind(cityCode)
    .first<MonitoredCity>();
  return row;
}

// ... additional methods ...
```

---

## YAD2 Connector Changes

### Current Behavior
- Hardcoded city list in `constants.ts`
- Round-robin via `lastCityIndex` in cursor state
- Fetches 1 city per run

### New Behavior
- Query `monitored_cities` table via DB interface
- Round-robin through **enabled** cities only
- Track result counts per city in cursor state
- Log warnings when hitting 200-result limit

### Updated Cursor State

```typescript
export interface Yad2CursorState {
  lastFetchedAt: string | null;
  knownOrderIds: string[];
  consecutiveFailures: number;
  circuitOpenUntil: string | null;
  lastCityIndex: number;

  // NEW: Track result counts for coverage monitoring
  resultCounts?: Record<number, number>; // cityCode → last result count
}
```

### Connector Refactor

**File:** `packages/connectors/src/yad2/index.ts`

**Changes:**

1. **Remove hardcoded cities dependency:**
   - Remove import of `YAD2_CITY_CODES` from constants
   - Accept `DB` instance in constructor or `fetchNew()`

2. **Fetch cities dynamically:**

```typescript
import type { DB } from '@rentifier/db';

export class Yad2Connector implements Connector {
  sourceId = 'yad2';
  sourceName = 'Yad2';

  async fetchNew(cursor: string | null, db: DB): Promise<FetchResult> {
    const state = parseCursorState(cursor);

    // Fetch enabled cities from database
    const cities = await db.getEnabledCities();

    if (cities.length === 0) {
      console.warn('No monitored cities enabled, skipping YAD2 fetch');
      return { candidates: [], nextCursor: JSON.stringify(state) };
    }

    // Round-robin city selection
    const cityIndex = state.lastCityIndex % cities.length;
    const city = cities[cityIndex];

    // ... rest of fetch logic ...

    // Track result count
    const resultCount = markers.length;
    const updatedResultCounts = {
      ...(state.resultCounts || {}),
      [city.city_code]: resultCount,
    };

    // Warn if hitting limit
    if (resultCount === 200) {
      console.log(JSON.stringify({
        event: 'yad2_result_limit_warning',
        city: city.city_name,
        cityCode: city.city_code,
        resultCount: 200,
        message: 'City may have truncated results. Consider splitting query.'
      }));
    }

    const updatedState: Yad2CursorState = {
      // ... existing fields ...
      resultCounts: updatedResultCounts,
    };

    return {
      candidates,
      nextCursor: JSON.stringify(updatedState),
    };
  }
}
```

**Breaking change:** `fetchNew()` signature changes to accept `db: DB`.

**Connector interface update:**

```typescript
// packages/connectors/src/interface.ts
export interface Connector {
  sourceId: string;
  sourceName: string;
  fetchNew(cursor: string | null, db: DB): Promise<FetchResult>;
  normalize(candidate: ListingCandidate): ListingDraft;
}
```

**Impact:** MockConnector must also accept `db: DB` parameter (unused).

---

## Collector Worker Changes

**File:** `apps/collector/src/fetch-source.ts`

**Current:**
```typescript
const fetchResult = await connector.fetchNew(state.cursor);
```

**Updated:**
```typescript
const fetchResult = await connector.fetchNew(state.cursor, db);
```

**Change:** Pass `db` instance from `runCollector` to connector.

---

## Testing Strategy

### 1. Database Migration Testing

**Manual verification:**
```bash
# Run migration locally
pnpm db:migrate

# Verify schema
pnpm db:query "SELECT * FROM monitored_cities"
# Expected: 3 rows (תל אביב, ירושלים, חיפה)

pnpm db:query "SELECT * FROM sources WHERE name='mock'"
# Expected: enabled=0

# Verify indexes
pnpm db:query "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='monitored_cities'"
# Expected: idx_monitored_cities_enabled
```

### 2. YAD2 Endpoint Verification

**Create test script:** `scripts/test-yad2-api.ts`

```typescript
import { fetchWithRetry } from '../packages/connectors/src/yad2/client';

async function testYad2Api() {
  const testCities = [
    { name: 'תל אביב', code: 5000 },
    { name: 'ירושלים', code: 3000 },
    { name: 'חיפה', code: 4000 },
  ];

  for (const city of testCities) {
    console.log(`Testing ${city.name} (${city.code})...`);
    try {
      const response = await fetchWithRetry(city.code);
      console.log({
        city: city.name,
        resultCount: response.data.markers.length,
        hasMarkers: Array.isArray(response.data.markers),
        firstMarker: response.data.markers[0] || null,
      });
    } catch (error) {
      console.error(`Failed for ${city.name}:`, error);
    }
  }
}

testYad2Api();
```

**Run:**
```bash
pnpm tsx scripts/test-yad2-api.ts
```

**Success criteria:**
- All 3 cities return 200 OK
- `data.markers` is an array
- Results have expected fields (orderId, price, address, etc.)
- Result count ≤ 200

### 3. Unit Tests

**Update existing tests:**

1. **Mock connector tests:** Verify `db` parameter is accepted
2. **YAD2 connector tests:** Mock `db.getEnabledCities()` with test data
3. **Collector tests:** Verify DB is passed to connector

**New tests:**

```typescript
// packages/connectors/src/yad2/__tests__/connector.test.ts

describe('Yad2Connector with monitored cities', () => {
  it('should fetch from enabled cities only', async () => {
    const mockDb = {
      getEnabledCities: vi.fn().mockResolvedValue([
        { city_name: 'תל אביב', city_code: 5000, enabled: 1, priority: 100 },
      ]),
    };

    // ... rest of test ...
  });

  it('should skip fetch when no cities enabled', async () => {
    const mockDb = {
      getEnabledCities: vi.fn().mockResolvedValue([]),
    };

    const connector = new Yad2Connector();
    const result = await connector.fetchNew(null, mockDb);

    expect(result.candidates).toHaveLength(0);
  });

  it('should log warning when hitting 200-result limit', async () => {
    // Mock 200 results exactly
    // Verify log contains 'yad2_result_limit_warning'
  });
});
```

### 4. End-to-End Testing

**Manual test flow:**

```bash
# 1. Deploy to local
pnpm dev

# 2. Trigger collector manually
curl http://localhost:8787/__scheduled

# 3. Verify listings_raw has YAD2 data (no mock)
pnpm db:query "SELECT source_id, COUNT(*) FROM listings_raw GROUP BY source_id"
# Expected: source_id=2 (yad2), COUNT > 0, no mock entries

# 4. Trigger processor
curl http://localhost:8788/__scheduled

# 5. Verify listings table populated
pnpm db:query "SELECT id, title, city, price FROM listings LIMIT 5"
# Expected: Hebrew titles, normalized cities, prices

# 6. Trigger notify worker
curl http://localhost:8789/__scheduled

# 7. Check Telegram for notification
# Expected: Message with image, street address, Hebrew city name
```

---

## Implementation Plan

### Phase 1: Database & Schema
1. Create migration 0010 (monitored_cities + disable mock)
2. Add DB interface methods (getEnabledCities, etc.)
3. Run migration locally and verify

### Phase 2: Connector Refactor
1. Update Connector interface to accept `db: DB`
2. Update Yad2Connector to query monitored_cities
3. Add result count tracking to cursor state
4. Add 200-result limit warning log
5. Update MockConnector signature (unused parameter)

### Phase 3: Collector Updates
1. Pass `db` instance to connector.fetchNew()
2. Update tests to mock `db.getEnabledCities()`

### Phase 4: Verification
1. Create and run YAD2 API test script
2. Run unit tests (update mocks as needed)
3. Manual end-to-end test (collector → processor → notify)
4. Verify no mock data in listings_raw
5. Verify Hebrew cities, streets, images all working

### Phase 5: Documentation
1. Update README with city configuration instructions
2. Document how to add/remove monitored cities
3. Update deployment guide with migration step

---

## Rollout Strategy

### Development
- Run all migrations locally
- Test with 3 cities initially (תל אביב, ירושלים, חיפה)
- Verify end-to-end flow before deployment

### Staging (if exists)
- Deploy with same 3 cities
- Monitor logs for 24 hours
- Check for 200-result warnings
- Verify notification quality

### Production
- Deploy with conservative city list (3-5 cities max)
- Monitor circuit breaker status
- Expand city list incrementally based on capacity

---

## Monitoring & Observability

### Key Metrics

1. **Coverage warnings:** Count of `yad2_result_limit_warning` events per city
2. **Fetch success rate:** `yad2_fetch_complete` / (`yad2_fetch_complete` + `yad2_fetch_failed`)
3. **Results per city:** Track average result count per city from cursor state
4. **Circuit breaker activations:** `yad2_circuit_opened` events

### Alerts (Future)

- Circuit breaker open > 1 hour
- Any city consistently hitting 200 results (3+ consecutive fetches)
- Zero results for active city (potential API change)

---

## Open Questions & Future Work

### Answered in Design

1. **Configuration method:** Database table ✅
2. **Mock source handling:** Disable via migration, keep code ✅
3. **National fallback:** Skip fetch, log warning ✅

### Deferred to Future

1. **Multi-query strategy for high-volume cities:**
   - Split Tel Aviv into price ranges (0-3000, 3000-5000, 5000+)
   - Requires cursor state per city+filter combination
   - Implement when consistently hitting 200 limit

2. **Dynamic city priority adjustment:**
   - Boost priority for cities with frequent new listings
   - Lower priority for low-activity cities
   - Requires analytics on listing velocity

3. **User-specific city selection:**
   - M3 milestone (Filter Matching Engine)
   - `filters` table should reference `monitored_cities.city_code`

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| YAD2 rental endpoint differs from sales | Test early with script, fallback to sales API if needed |
| Migration fails in production | Test locally + staging first, backup D1 before migration |
| Breaking change to Connector interface | Update all connectors in same PR, comprehensive tests |
| Zero enabled cities after migration | Seed 3 cities in migration, validation query before deploy |
| 200-result limit causes missed posts | Log warnings, prioritize high-volume cities, future: multi-query |

---

## Success Criteria

- ✅ Migration 0010 applied successfully (local + production)
- ✅ Mock source disabled, zero mock entries in listings_raw
- ✅ YAD2 connector fetches from database-configured cities
- ✅ 200-result warnings logged when applicable
- ✅ End-to-end test passes: YAD2 data → listings table → Telegram notification
- ✅ All unit tests passing with updated mocks
- ✅ TypeScript compiles with zero errors

---

## Files to Modify

### New Files
- `packages/db/migrations/0010_monitored_cities.sql`
- `scripts/test-yad2-api.ts`

### Modified Files
- `packages/db/src/schema.ts` (add MonitoredCity type)
- `packages/db/src/operations.ts` (add city query methods)
- `packages/connectors/src/interface.ts` (update Connector.fetchNew signature)
- `packages/connectors/src/yad2/index.ts` (query cities from DB, add coverage tracking)
- `packages/connectors/src/yad2/types.ts` (update Yad2CursorState)
- `packages/connectors/src/mock.ts` (accept unused db parameter)
- `apps/collector/src/fetch-source.ts` (pass db to connector)
- `apps/collector/src/registry.ts` (no changes needed)

### Test Files
- `packages/connectors/src/yad2/__tests__/connector.test.ts` (mock db.getEnabledCities)
- `packages/connectors/src/yad2/__tests__/client.test.ts` (no changes)
- `apps/collector/src/__tests__/collector.test.ts` (if exists, update mocks)

---

## Timeline Estimate

- **Phase 1 (Database):** 1-2 hours
- **Phase 2 (Connector):** 2-3 hours
- **Phase 3 (Collector):** 1 hour
- **Phase 4 (Verification):** 2-3 hours
- **Phase 5 (Documentation):** 1 hour

**Total:** ~8-11 hours of focused work

**Dependencies:** None (all M1 foundation complete)

**Blockers:** Potential - YAD2 API endpoint may differ from assumption (mitigated with early testing)
