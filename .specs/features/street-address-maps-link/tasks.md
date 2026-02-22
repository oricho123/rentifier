# Tasks: Street Address with Google Maps Link

**Feature:** Street Address with Google Maps Link in Telegram Notifications
**Status:** Ready for Implementation
**Created:** 2026-02-22

## Task Breakdown

### Phase 1: Database Schema (Prerequisites)

**Task 1.1: Create database migration**
- **File**: `packages/db/migrations/0003_add_street_address.sql`
- **Actions**:
  - Create new migration file
  - Add `ALTER TABLE listings ADD COLUMN street TEXT;`
  - Add `ALTER TABLE listings ADD COLUMN house_number TEXT;`
- **Verification**: Migration runs without errors
- **Estimated complexity**: Simple (5 min)

**Task 1.2: Run migration locally**
- **Actions**:
  - Execute migration: `wrangler d1 migrations apply rentifier-db --local --config wrangler.migrations.json`
  - Verify columns added: `wrangler d1 execute rentifier-db --local --command "PRAGMA table_info(listings);"`
- **Verification**: `street` and `house_number` columns appear in schema
- **Estimated complexity**: Simple (2 min)

### Phase 2: Type Updates

**Task 2.1: Update core types**
- **File**: `packages/core/src/types.ts`
- **Actions**:
  - Add `street: string | null;` to `Listing` interface (after `neighborhood`)
  - Add `houseNumber: string | null;` to `Listing` interface (after `street`)
  - Add `street: string | null;` to `ListingDraft` interface (after `neighborhood`)
  - Add `houseNumber: string | null;` to `ListingDraft` interface (after `street`)
- **Verification**: TypeScript compiles without errors
- **Estimated complexity**: Simple (3 min)

**Task 2.2: Update database types**
- **File**: `packages/db/src/schema.ts`
- **Actions**:
  - Add `street: string | null;` to `ListingRow` interface (after `neighborhood`)
  - Add `house_number: string | null;` to `ListingRow` interface (after `street`)
- **Verification**: TypeScript compiles, DB queries type-check
- **Estimated complexity**: Simple (2 min)

### Phase 3: YAD2 Connector Updates

**Task 3.1: Update normalize() method**
- **File**: `packages/connectors/src/yad2/index.ts`
- **Actions**:
  - In `normalize()` method, add after line 152 (after `neighborhood`):
    ```typescript
    street: sd.address?.street?.text ?? null,
    houseNumber: sd.address?.house?.number ?? null,
    ```
- **Verification**: TypeScript compiles without errors
- **Estimated complexity**: Simple (2 min)

**Task 3.2: Add connector tests**
- **File**: `packages/connectors/src/yad2/__tests__/connector.test.ts`
- **Actions**:
  - Add test case for street and house number extraction
  - Add test case for missing street data (empty strings)
  - Update existing test assertions to include new fields
- **Verification**: Tests pass with `pnpm test`
- **Estimated complexity**: Medium (10 min)

### Phase 4: Message Formatter Updates

**Task 4.1: Add formatAddress() helper method**
- **File**: `apps/notify/src/message-formatter.ts`
- **Actions**:
  - Add private method `formatAddress(listing: ListingRow): { text: string; mapsUrl: string } | null`
  - Implement address component assembly logic
  - Add private method `buildMapsUrl(listing: ListingRow): string`
  - Implement Google Maps URL generation with `encodeURIComponent()`
- **Verification**: TypeScript compiles without errors
- **Estimated complexity**: Medium (15 min)

**Task 4.2: Update format() method**
- **File**: `apps/notify/src/message-formatter.ts`
- **Actions**:
  - Replace lines 18-23 (location formatting) with call to `formatAddress()`
  - Generate HTML link: `<a href="${address.mapsUrl}">${this.escapeHtml(address.text)}</a>`
  - Keep emoji prefix: `📍`
- **Verification**: TypeScript compiles without errors
- **Estimated complexity**: Simple (5 min)

**Task 4.3: Create message formatter tests**
- **File**: `apps/notify/src/__tests__/message-formatter.test.ts` (new file)
- **Actions**:
  - Create test helper `createTestListing()`
  - Test: full address with street and house number
  - Test: street without house number
  - Test: fallback to city/neighborhood
  - Test: only city available
  - Test: HTML escaping in address
  - Test: Google Maps URL encoding
- **Verification**: All tests pass with `pnpm test`
- **Estimated complexity**: Medium (20 min)

### Phase 5: Integration & Verification

**Task 5.1: Run TypeScript compilation**
- **Actions**:
  - Execute: `pnpm typecheck` from root
  - Fix any type errors that surface
- **Verification**: Zero TypeScript errors
- **Estimated complexity**: Simple (2 min)

**Task 5.2: Run all tests**
- **Actions**:
  - Execute: `pnpm test` from root
  - Verify all existing tests still pass
  - Verify new tests pass
- **Verification**: All tests green
- **Estimated complexity**: Simple (3 min)

**Task 5.3: Test with mock data locally**
- **Actions**:
  - Create test listing with street data in local D1
  - Run notification service locally
  - Inspect generated Telegram message HTML
  - Verify Maps URL is correctly formatted
- **Verification**: Message includes clickable Maps link with correct encoding
- **Estimated complexity**: Medium (10 min)

**Task 5.4: Manual Telegram test (optional)**
- **Actions**:
  - Send test notification to personal Telegram
  - Verify message displays correctly
  - Click Maps link, verify it opens Google Maps to correct location
- **Verification**: End-to-end flow works
- **Estimated complexity**: Simple (5 min)
- **Note**: Requires valid Telegram bot token and chat ID

### Phase 6: Deployment

**Task 6.1: Run migration on remote D1**
- **Actions**:
  - Execute: `wrangler d1 migrations apply rentifier-db --remote --config wrangler.migrations.json`
  - Verify migration applied successfully
- **Verification**: Remote database has new columns
- **Estimated complexity**: Simple (2 min)

**Task 6.2: Deploy workers**
- **Actions**:
  - Deploy collector: `pnpm --filter @rentifier/collector deploy`
  - Deploy processor: `pnpm --filter @rentifier/processor deploy`
  - Deploy notify: `pnpm --filter @rentifier/notify deploy`
- **Verification**: All deployments successful
- **Estimated complexity**: Simple (5 min)

**Task 6.3: Monitor first notifications**
- **Actions**:
  - Wait for next scheduled notification run
  - Check logs for errors
  - Verify new listings include street addresses in Telegram
- **Verification**: Production notifications include Maps links
- **Estimated complexity**: Simple (10 min monitoring)

## Task Dependencies

```
1.1 → 1.2 → 2.1 → 2.2 → 3.1 → 3.2
                           ↓
                         4.1 → 4.2 → 4.3
                                      ↓
                    5.1 → 5.2 → 5.3 → 5.4 → 6.1 → 6.2 → 6.3
```

**Critical path**: 1.1 → 1.2 → 2.1 → 2.2 → 3.1 → 4.1 → 4.2 → 5.1 → 5.2 → 6.1 → 6.2

**Can be parallelized**: Tasks 3.2, 4.3 can be done alongside implementation

## Rollback Plan

If issues occur in production:
1. Revert code deployment (keep database migration)
2. Redeploy previous working version
3. Investigate and fix issues
4. Re-deploy fixed version

Database columns can remain (unused, nullable) without impact.

## Total Estimated Time

- Phase 1: ~7 min
- Phase 2: ~5 min
- Phase 3: ~12 min
- Phase 4: ~40 min
- Phase 5: ~20 min
- Phase 6: ~17 min

**Total**: ~100 minutes (1.7 hours) for full implementation and deployment

**Note**: This is a simple feature with low complexity. Most time is in testing and verification.
