# Facebook Groups Connector - Tasks

**Design**: `.specs/features/facebook-connector/design.md`
**Status**: In Progress

---

## Execution Plan

### Phase 1: Foundation (Parallel)

```
T1 [P] HTTP Client
T2 [P] HTML Parser + Types
T3 [P] Account Rotation + Constants
```

### Phase 2: Integration (Sequential)

```
T1, T2, T3 complete, then:
  T4 → T5 → T6
```

### Phase 3: Testing

```
T7 (can start alongside T4)
```

---

## Task Breakdown

### T1: Facebook HTTP Client
**What**: HTTP client for mbasic.facebook.com with cookie auth, retry, error detection
**Where**: `packages/connectors/src/facebook/client.ts`
**Depends on**: None
**Verify**: Cookie auth works, expired cookies detected, no cookie values in logs

### T2: HTML Parser
**What**: Cheerio-based parser for mbasic group page HTML → FacebookPost[]
**Where**: `packages/connectors/src/facebook/parser.ts`, `types.ts`
**Depends on**: None
**Verify**: Parses posts from fixture HTML, handles empty pages, extracts pagination cursor

### T3: Cookie Management + Account Rotation
**What**: Multi-account cookie rotation with disabled account tracking
**Where**: `packages/connectors/src/facebook/accounts.ts`, `constants.ts`
**Depends on**: None
**Verify**: Round-robin selection, disabled accounts skipped, env var reading

### T4: FacebookConnector Class
**What**: Connector interface implementation wiring client + parser + accounts + extraction
**Where**: `packages/connectors/src/facebook/index.ts`, update `src/index.ts`
**Depends on**: T1, T2, T3
**Verify**: Implements Connector interface, normalize uses extractAll, circuit breaker works

### T5: Collection Script + GitHub Actions
**What**: Collection script + workflow + DB migration (seed facebook source)
**Where**: `scripts/collect-facebook.ts`, `.github/workflows/collect-facebook.yml`, migration
**Depends on**: T4
**Verify**: Script mirrors collect-yad2.ts pattern, workflow has correct secrets

### T6: Admin Cookie Expiry Telegram Notification
**What**: Telegram notification to admin when cookie expires
**Where**: `scripts/collect-facebook.ts` (extend)
**Depends on**: T5
**Verify**: Notification sent on auth_expired, includes account number, no spam

### T7: Unit Tests
**What**: Parser tests with HTML fixtures, connector normalize tests, cursor state tests
**Where**: `packages/connectors/src/facebook/__tests__/`
**Depends on**: T2, T4
**Verify**: All tests pass in CI
