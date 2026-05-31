# Facebook Login Recovery Hardening Tasks

**Design**: `.specs/features/facebook-login-recovery-hardening/design.md`
**Status**: Approved

---

## Execution Plan

### Phase 1: State machine (Sequential)

```
T1 → T2 → T3
```

### Phase 2: Tests (Parallel OK after T3)

```
      ┌→ T4 [P]
T3 ───┤
      └→ T5 [P]
```

### Phase 3: Validate (Sequential)

```
T4, T5 → T6
```

---

## Task Breakdown

### T1: Add `redirecting` to `LoginScreenState`

**What**: Extend the `LoginScreenState` union with the `'redirecting'` literal.
**Where**: `packages/connectors/src/facebook/login.ts`
**Depends on**: None
**Reuses**: existing `LoginScreenState` union.

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] `'redirecting'` added to the union with a one-line comment.
- [ ] `pnpm -C packages/connectors exec tsc --noEmit` passes (no type errors).

---

### T2: Detect the interstitial in `classifyLoginScreen`

**What**: Add a top-priority branch returning `'redirecting'` when `page.url()` contains `crypted_string`.
**Where**: `packages/connectors/src/facebook/login.ts` (`classifyLoginScreen`)
**Depends on**: T1
**Reuses**: existing priority-ladder; `page.url()`.

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] When URL contains `crypted_string`, returns `'redirecting'` even if `[role="main"]`/`[role="feed"]` present and no email input.
- [ ] Genuine `https://www.facebook.com/` + feed still returns `home_feed`.
- [ ] Function remains stateless/pure (no new I/O beyond `page.url()`).

---

### T3: Handle `redirecting` in the `attemptLogin` step loop

**What**: Add a handler arm that actively waits for the redirect to settle (`waitForURL` off `crypted_string`, deterministic `goto('/')` fallback), then `continue` to re-classify.
**Where**: `packages/connectors/src/facebook/login.ts` (`attemptLogin`)
**Depends on**: T2
**Reuses**: `LOGIN_NAVIGATION_TIMEOUT_MS`, existing `continue` semantics + no-progress guard.

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] `redirecting` state waits then re-classifies; never returns `success: true` while URL has `crypted_string`.
- [ ] Repeated `redirecting` (no resolution) bails via no-progress guard → `{ success: false, reason: 'unknown_login_page' }`.
- [ ] `waitForURL`/`goto` failures are `.catch`-guarded (no crash).
- [ ] No new logged fields containing cookies/credentials.

---

### T4: Unit tests for interstitial classification [P]

**What**: Add `classifyLoginScreen` cases for `redirecting`.
**Where**: `packages/connectors/src/facebook/__tests__/login-classify.test.ts`
**Depends on**: T3
**Reuses**: existing `makePage` helper.

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] Test: `url=https://www.facebook.com/?crypted_string=ABC&next=...` + `[role="main"]` → `'redirecting'`.
- [ ] Test: genuine `HOME_URL` + feed still → `'home_feed'` (regression guard).
- [ ] `pnpm -C packages/connectors test login-classify` passes.

**Verify**: `pnpm -C packages/connectors test login-classify` → all green.

---

### T5: Unit tests for `attemptLogin` redirect handling [P]

**What**: Add scripted-sequence tests proving self-heal and loop safety.
**Where**: `packages/connectors/src/facebook/__tests__/login-attempt.test.ts`
**Depends on**: T3
**Reuses**: `makeScriptedPage` (extend mock to advance on `waitForURL`; add `goto` stub).

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] `makeScriptedPage` mock supports `waitForURL` (advances step) and `goto`.
- [ ] Test: `continue_as_user → redirecting → full_login → home_feed` ⇒ `{ success: true }` and both email + password filled.
- [ ] Test: `redirecting → redirecting` ⇒ `{ success: false, reason: 'unknown_login_page' }`.
- [ ] Test: `redirecting`-marked step never emits `fb_login_success` while URL has `crypted_string`.
- [ ] `pnpm -C packages/connectors test login-attempt` passes.

**Verify**: `pnpm -C packages/connectors test login-attempt` → all green.

---

### T6: Full regression + lint

**What**: Run the connector test suite + typecheck/lint to confirm no regressions.
**Where**: repo-wide (connectors package)
**Depends on**: T4, T5
**Reuses**: existing test/lint scripts.

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] `pnpm -C packages/connectors test` → all pass (incl. existing login + recovery suites).
- [ ] No new TypeScript/ESLint errors in `login.ts` and the two test files.

**Verify**: connector suite green; `ReadLints` on edited files clean.

---

## Task Granularity Check

| Task | Scope | Status |
| ---- | ----- | ------ |
| T1: union literal | 1 type edit | ✅ Granular |
| T2: classify branch | 1 function | ✅ Granular |
| T3: attemptLogin arm | 1 function | ✅ Granular |
| T4: classify tests | 1 file | ✅ Granular |
| T5: attemptLogin tests | 1 file | ✅ Granular |
| T6: regression | verification | ✅ Granular |
