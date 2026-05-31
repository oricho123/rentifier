# Facebook Disabled-Account Auto Re-Enable Tasks

**Design**: `.specs/features/facebook-disabled-account-auto-reenable/design.md`
**Status**: Approved

---

## Execution Plan

```
T1 → T2 → T3 → T4 → T5 → T6
```

(Mostly sequential — each builds on the prior file edit.)

---

### T1: Extract `cookie-hash.ts`

**What**: New module exporting `hashSeedCookies`; `client.ts` imports it instead of its private copy.
**Where**: `packages/connectors/src/facebook/cookie-hash.ts` (new), `client.ts` (modify).
**Done when**:
- [ ] `cookie-hash.ts` exports `hashSeedCookies(string): string` (SHA-256 of trimmed input).
- [ ] `client.ts` uses the imported function; private duplicate removed; behavior identical.
- [ ] Typecheck passes.

---

### T2: Add `disabledCookieHashes` to cursor type

**What**: Optional `Record<string,string>` on `FacebookCursorState`.
**Where**: `packages/connectors/src/facebook/types.ts`.
**Done when**:
- [ ] Field added with doc comment; optional (back-compat).
- [ ] Typecheck passes.

---

### T3: Record cookie hash on disable

**What**: In the disable block, persist `disabledCookieHashes[id] = hashSeedCookies(selected.account.cookies)`; include field in `updatedState`.
**Where**: `index.ts` (disable block + `updatedState` literal).
**Done when**:
- [ ] Hash recorded next to existing `clearProfile` call.
- [ ] `updatedState` carries `disabledCookieHashes`.

---

### T4: Implement `reenableOnCookieChange` + wire into `fetchNew`

**What**: Private method that re-enables changed-cookie accounts (backfill missing baselines); call it early; clear circuit if any re-enabled.
**Where**: `index.ts`.
**Done when**:
- [ ] `getAccounts` called once near top and reused by `selectAccount`.
- [ ] Method removes changed-cookie ids from `disabledAccounts`, drops their hash, clears their `loginAttempts`, logs `fb_account_reenabled`.
- [ ] Missing-baseline ids are backfilled and stay disabled.
- [ ] When ≥1 re-enabled and `circuitOpenUntil` set → cleared.
- [ ] Runs BEFORE the circuit-breaker early-return.

---

### T5: Tests

**What**: Connector tests for change / no-change / legacy-backfill / circuit-clear.
**Where**: `packages/connectors/src/facebook/__tests__/connector.test.ts`.
**Done when**:
- [ ] cookies changed → `'1'` removed from `disabledAccounts` + `fb_account_reenabled` logged.
- [ ] cookies changed + circuit open → circuit cleared (collection proceeds).
- [ ] cookies unchanged → stays disabled, no re-enable log.
- [ ] legacy (no baseline) → backfilled, stays disabled.
- [ ] `npx vitest run packages/connectors/src/facebook/__tests__/connector.test.ts` green.

---

### T6: Regression + lint

**Done when**:
- [ ] `npx vitest run packages/connectors` all pass.
- [ ] `tsc --noEmit` clean; no lint errors on edited/new files.
