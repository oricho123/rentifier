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
| T7: tightened home_feed | 1 function | ✅ Granular |
| T8: saved-session recovery | 1 branch | ✅ Granular |
| T9: diagnostics module | 1 file | ✅ Granular |
| T10: smoking-gun emit | 1 catch arm | ✅ Granular |
| T11: addendum tests + regression | 2 files | ✅ Granular |

---

## Addendum (2026-06-08): P3/P4/P5 — shipped in PR #53 (`fix/fb-login-saved-session-fakeout`)

### Phase A: Selector + recovery (Sequential)

```
T7 → T8
```

### Phase B: Diagnostics (Sequential, parallel-safe with Phase A)

```
T9 → T10
```

### Phase C: Tests + regression (Sequential)

```
T7, T8, T9, T10 → T11
```

---

### T7: Tighten `home_feed` in `classifyLoginScreen` ✅ DONE

**What**: Require `SELECTORS.loggedInChrome` AND absence of *both* `emailInput` and `passwordInput` for the `home_feed` branch. Add the new `loggedInChrome` selector (top-bar search en+he, notifications en+he, banner-Home link). Add the `FORCE_CREDENTIAL_LOGIN_URL` constant for use by T8.
**Where**: `packages/connectors/src/facebook/login.ts` (`SELECTORS`, `classifyLoginScreen`)
**Depends on**: T1–T6 (P1/P2 baseline)
**Reuses**: existing `exists()` helper, priority-ladder structure.

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [x] `SELECTORS.loggedInChrome` constant added with locale-resilient OR-list.
- [x] `home_feed` branch demoted whenever `loggedInChrome` is absent OR an email/pass input is visible.
- [x] `FORCE_CREDENTIAL_LOGIN_URL` exported (consumed by T8).
- [x] Genuine logged-in feed (chrome present, no inputs) still returns `home_feed`.
- [x] Logged-out splash with inline email/pass returns `full_login`, not `home_feed`.
- [x] `pnpm typecheck` clean.

---

### T8: Saved-session recovery branch in `attemptLogin` ✅ DONE

**What**: Snapshot `previousIterationState` before the no-progress update; when `state === 'unknown'` and prev was `continue_as_user`/`redirecting`, `goto(FORCE_CREDENTIAL_LOGIN_URL)` + `waitForLoadState('networkidle')` + `continue`. Emit `fb_saved_session_invalidated`.
**Where**: `packages/connectors/src/facebook/login.ts` (`attemptLogin`)
**Depends on**: T7
**Reuses**: existing `continue` semantics, no-progress guard, step/time budget, `LOGIN_NAVIGATION_TIMEOUT_MS`.

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [x] `previousIterationState` captured *before* `prevState = state`.
- [x] Recovery branch placed before the generic `unknown` fall-through.
- [x] `fb_saved_session_invalidated` logged with `{ step, url }`.
- [x] Repeated recovery → `unknown` two iterations in a row still bails via no-progress guard.
- [x] No new fields containing cookies/credentials in the log payload.

---

### T9: New diagnostics module ✅ DONE

**What**: Add `packages/connectors/src/facebook/diagnostics.ts` with `FacebookPageFingerprint` interface, `pageFingerprint(page)`, and `logPageFingerprint(page, event, extra?)`. Each selector probe wrapped in a 1.5s `Promise.race` timeout. Cookie *names* only.
**Where**: `packages/connectors/src/facebook/diagnostics.ts` (new), imports added to `login.ts` + `index.ts`.
**Depends on**: None (independent of T7/T8)
**Reuses**: Playwright `Page`, `BrowserContext.cookies`.

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [x] `FacebookPageFingerprint` exposes URL, title, presence flags for feed/main/banner/email/pass/search/notifications/continue-as/login-another, `htmlLen`, `cookieNames`, `hasCUserCookie`, `hasXsCookie`.
- [x] `pageFingerprint` is timeout-guarded per probe; never throws to the caller.
- [x] `logPageFingerprint` swallows capture failures silently (best-effort).
- [x] No cookie *values* appear in the returned object or any log line.
- [x] Per-step `fb_page_fingerprint` event emitted from `attemptLogin` with `{ phase: 'login_step', step, state, fingerprint }`.

---

### T10: Smoking-gun fingerprint on auth_expired-after-login ✅ DONE

**What**: In `FacebookConnector.fetchGroupWithLoginRecovery`, after `attemptLogin` returns success, when the retry throws `FacebookClientError` with `errorType === 'auth_expired' | 'banned'`, emit `fb_auth_expired_after_login` with `{ accountId, groupId, errorType, fingerprint }` before re-throwing.
**Where**: `packages/connectors/src/facebook/index.ts` (`fetchGroupWithLoginRecovery` retry catch).
**Depends on**: T9
**Reuses**: `logPageFingerprint`, existing retry catch, `FacebookClientError` shape.

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [x] Fingerprint is awaited *before* the re-throw so the log line is in the run output even when the caller closes the context.
- [x] Only fires for auth-class errors (not `network`/`parse`/`timeout`).
- [x] Existing `loginOutcome: { success: true }` annotation on the re-thrown error is preserved.

---

### T11: Addendum tests + regression ✅ DONE

**What**: Update existing `home_feed` scripted-step tests to include `[CHROME]: 1`. Add 2 negative classification tests (P3) and 1 end-to-end saved-session recovery test (P4). Add `goto` advance-step support to `makeScriptedPage` so the recovery navigation transitions the mock state.
**Where**: `packages/connectors/src/facebook/__tests__/login-classify.test.ts` + `__tests__/login-attempt.test.ts`.
**Depends on**: T7, T8, T9, T10
**Reuses**: `makePage`, `makeScriptedPage` (extended with `goto.advance()`).

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [x] `login-classify`: 2 new tests cover `home_feed` rejection (`feedRoot` only → `unknown`; `feedRoot + chrome + pass input` → `full_login`).
- [x] `login-attempt`: 1 new test asserts `continue_as_user → unknown(HOME_URL,feedRoot only) → full_login → home_feed(chrome)` ⇒ `fb_saved_session_invalidated` emitted, both email + password filled, outcome `{ success: true }`.
- [x] All existing `home_feed` step transitions in `login-attempt` updated to set `[CHROME]: 1`.
- [x] Credential-leak guard test still passes (no email/password in any captured log line).
- [x] Full repo `pnpm test` green (397 tests) and `pnpm typecheck` clean.
