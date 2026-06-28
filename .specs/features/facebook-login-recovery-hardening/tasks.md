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
| T12: continueAsLocators rewrite | 1 function | ✅ Granular |
| T13: continue_as_user no-progress recovery | 1 branch | ✅ Granular |
| T14: P6 tests + regression | 2 files | ✅ Granular |
| T15: extend unknown-recovery to /login URLs + tests | 1 branch + 1 file | ✅ Granular |
| T16: aymh_chooser state + click escape + tests | 1 state + 1 branch + 2 files | ✅ Granular |
| T17: human-like credential typing + submit pause + tests | 2 handler arms + 2 files | ✅ Granular |

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

---

## Addendum (2026-06-10): P6 — shipped in branch `fix/fb-continue-as-user-false-positive`

### Phase D: Selector tightening + recovery (Sequential)

```
T12 → T13 → T14
```

---

### T12: Rewrite `continueAsLocators` to drop SSO false-positive matchers ✅ DONE

**What**: Replace the broad `getByRole('button', { name: CONTINUE_RE })` + `div[role="button"]` filtered text matchers with two narrow selectors: `SELECTORS.continueAsButton` (aria-label prefix `"Continue as" / "המשך בתור" / ...`) and `SELECTORS.savedSessionShortcut` (`a[href*="login_redirect"]`). Delete `CONTINUE_LOCALES`, `CONTINUE_RE`, `CONTINUE_EXACT_RE`, and the local `escapeRegex` helper.
**Where**: `packages/connectors/src/facebook/login.ts` (`SELECTORS`, `continueAsLocators`, top-level constants).
**Depends on**: T7–T11 (P3/P4/P5 baseline).
**Reuses**: existing `clickFirstAvailable` flow, `SELECTORS` shape, diagnostics' anchor selector definition.

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [x] `SELECTORS.continueAsButton` and `SELECTORS.savedSessionShortcut` constants added; `savedSessionShortcut` matches the diagnostics fingerprint probe verbatim.
- [x] `continueAsLocators` returns exactly those two locators.
- [x] `CONTINUE_LOCALES` / `CONTINUE_RE` / `CONTINUE_EXACT_RE` / `escapeRegex` removed; no consumers outside `login.ts` (`grep` clean).
- [x] An `/login` page presenting only "Continue with Google" / "Continue with Apple" SSO buttons (no aria-label match, no login_redirect anchor) does not classify as `continue_as_user`.
- [x] `pnpm typecheck` clean.

---

### T13: `continue_as_user` no-progress recovery in `attemptLogin` ✅ DONE

**What**: Declare `let didForceCredentialRecovery = false;` once per call. Add a branch BEFORE the existing `prevState === state` no-progress guard: when `state === 'continue_as_user' && prevState === 'continue_as_user' && !didForceCredentialRecovery`, set the flag, log `fb_saved_session_invalidated` with `detail: 'no_progress_on_continue_as_user'`, `goto(FORCE_CREDENTIAL_LOGIN_URL)`, `waitForLoadState('networkidle')`, set `prevState = state`, and `continue`.
**Where**: `packages/connectors/src/facebook/login.ts` (`attemptLogin`).
**Depends on**: T12.
**Reuses**: `FORCE_CREDENTIAL_LOGIN_URL`, `LOGIN_NAVIGATION_TIMEOUT_MS`, existing `continue` semantics, no-progress guard.

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [x] Recovery branch placed BEFORE the no-progress bail (branch order matters — P4's recovery couldn't catch this because it gated on `state === 'unknown'`).
- [x] One-shot flag prevents the recovery from looping if the credential URL bounces back to `continue_as_user` — second repeat hits the normal no-progress bail.
- [x] `fb_saved_session_invalidated` log line carries `detail: 'no_progress_on_continue_as_user'` so the recovery cause is greppable.
- [x] No new fields containing cookies/credentials.

---

### T14: P6 tests + regression ✅ DONE

**What**: Update test mocks in both classify + attempt suites to recognize `SELECTORS.continueAsButton` / `SELECTORS.savedSessionShortcut` (and stop relying on the removed `getByRole`-based detection). Add 1 classifier regression test (SSO-only `/login` → `unknown`), 1 attempt success test (`continue_as_user × 2 → recovery → full_login → home_feed`), and 1 attempt one-shot guard test (`continue_as_user × 4 → unknown_login_page`).
**Where**: `packages/connectors/src/facebook/__tests__/login-classify.test.ts` + `__tests__/login-attempt.test.ts`.
**Depends on**: T12, T13.
**Reuses**: `makePage`, `makeScriptedPage` (no shape changes — just selector routing in the mock).

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [x] `login-classify` mock routes `SELECTORS.continueAsButton` and `SELECTORS.savedSessionShortcut` through the existing `continueLocator`; old legacy paths (`a[role="button"][href*="login_redirect"]` literal, `getByRole`) no longer feed `continueButtonHits`.
- [x] `login-classify`: regression test "logged-out /login page with no saved-session button → unknown" added.
- [x] `login-attempt`: success test asserts `fb_saved_session_invalidated` with `no_progress_on_continue_as_user` detail and `{ success: true }` outcome with creds filled.
- [x] `login-attempt`: one-shot guard test asserts `{ success: false, reason: 'unknown_login_page' }` after recovery itself returns to `continue_as_user`.
- [x] Existing 16 attempt tests + 19 classify tests still pass; full repo `pnpm test` → 400 green, `pnpm -C packages/connectors exec tsc --noEmit` clean.

---

## Addendum (2026-06-11): P7 — shipped in branch `fix/fb-unknown-on-login-recovery`

### Phase E: Recovery extension (Sequential)

```
T15
```

---

### T15: Extend unknown-recovery to fire on first-iteration `/login` URLs ✅ DONE

**What**: Broaden the `state === 'unknown'` recovery branch in `attemptLogin` to also fire when the page URL contains `/login\b`, regardless of `previousIterationState`. Share the existing one-shot `didForceCredentialRecovery` flag across P4, P6, and P7 — at most one force-credential per call. Add a `detail` field on the `fb_saved_session_invalidated` log line so the three trigger paths are distinguishable in production logs (`'unknown_on_login_url'`, `'unknown_after_saved_session'`, or `'no_progress_on_continue_as_user'`).
**Where**: `packages/connectors/src/facebook/login.ts` (`attemptLogin` recovery branch); `packages/connectors/src/facebook/__tests__/login-attempt.test.ts` (2 new scripted tests).
**Depends on**: T13 (P6 one-shot flag — reused).
**Reuses**: `FORCE_CREDENTIAL_LOGIN_URL`, `LOGIN_NAVIGATION_TIMEOUT_MS`, the shared `didForceCredentialRecovery` flag.

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [x] Recovery condition expanded to `(isLoginUrl || prev was continue_as_user/redirecting)`, gated by `!didForceCredentialRecovery`.
- [x] `detail` field added to `fb_saved_session_invalidated` and varies by trigger path so log greps can isolate which path fired.
- [x] Defense test: `unknown` on a non-`/login` URL with no prior saved-session state → `unknown_login_page` AND `fb_saved_session_invalidated` is NOT emitted (no over-eager recovery).
- [x] Success test: `unknown(LOGIN_URL) → full_login → home_feed` with a `fb_saved_session_invalidated detail:'unknown_on_login_url'` log line and credentials filled.
- [x] Existing P4 / P6 tests still pass (the shared flag does not disturb either path).
- [x] Full repo `pnpm test` → 402 green; `pnpm -C packages/connectors exec tsc --noEmit` clean.

---

## Addendum (2026-06-14): P8 — shipped in branch `fix/fb-aymh-chooser-click-escape`

### Phase F: AYMH state + click escape (Sequential)

```
T16
```

---

### T16: Add `aymh_chooser` classifier state + click "Use another profile" handler ✅ DONE

**What**: The 2026-06-14 production failure proved that the P7 force-credential URL does NOT bypass FB's AYMH multi-profile chooser once device cookies pin a profile — both `/login/?next=...` and `/login/?login_attempt=1&lwv=110` served AYMH on the same run. Add a real `'aymh_chooser'` `LoginScreenState` detected via the locale-stable hidden form field `input[name="aymh_profile_loaded_count"]`, and a handler that clicks the AYMH-internal escape button `Use another profile` to surface the standard email+password form. Reverses the P7 "no new state" decision specifically for this variant — confirmed-second-variant warrants a typed state.
**Where**: `packages/connectors/src/facebook/login.ts` (`SELECTORS`, `LoginScreenState`, `classifyLoginScreen`, `attemptLogin`); tests in `__tests__/login-classify.test.ts` + `__tests__/login-attempt.test.ts`.
**Depends on**: T15 (P7 baseline — its `unknown`-on-`/login` recovery now serves as the fallback for non-AYMH unknowns).
**Reuses**: existing `withNavigation`, `LOGIN_NAVIGATION_TIMEOUT_MS`, `exists`, classifier priority-ladder structure, scripted-page test mocks.

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [x] `SELECTORS.aymhMarker` and `SELECTORS.useAnotherProfile` added (5-locale aria-label exact match, no Continue-style regex).
- [x] `'aymh_chooser'` added to `LoginScreenState` union with comment explaining why it's distinct from `continue_as_user`.
- [x] Classifier branch placed between `continue_as_user` (priority 5) and `password_only` (priority 6) — `continue_as_user` wins when both signals coexist (cheaper path).
- [x] `attemptLogin` handler clicks `useAnotherProfile` inside `withNavigation`; missing button → skip click, no-progress guard handles bail.
- [x] Classifier test: `aymhMarker: 1` only ⇒ `'aymh_chooser'`.
- [x] Classifier test: `continueButtonHits: 1` AND `aymhMarker: 1` ⇒ `'continue_as_user'` (priority defense).
- [x] Attempt test: `aymh_chooser(useAnotherProfile=1) → full_login → home_feed` ⇒ `clickCalls` contains `useAnotherProfile`, creds filled, `{ success: true }`.
- [x] Attempt test: `aymh_chooser × 2` (button missing) ⇒ `{ success: false, reason: 'unknown_login_page' }`.
- [x] No new fields containing cookies/credentials.
- [x] Full repo `pnpm test` → 406 green (was 402); `pnpm -C packages/connectors exec tsc --noEmit` clean.

---

## Addendum (2026-06-14b): P9 — shipped in branch `fix/fb-human-like-credential-entry`

### Phase G: Human-like credential entry (Sequential)

```
T17
```

---

### T17: Replace `fill()` with `pressSequentially()` + add submit pause ✅ DONE

**What**: The post-PR-#56 production run proved P8 escapes AYMH (`state:aymh_chooser → state:full_login` with creds form visible) but the `fill()`-then-immediate-submit pattern is silently rejected by FB on AYMH-flow forms — same URL, same form re-rendered, no banner, no navigation, no-progress bail. Replace `fill()` with `pressSequentially({ delay: HUMAN_TYPE_DELAY_MS })` in both `full_login` and `password_only` arms (real keystroke events instead of instant text insertion), and add `waitForTimeout(HUMAN_PAUSE_BEFORE_SUBMIT_MS)` before the submit click (humans don't post the instant the last character types).
**Where**: `packages/connectors/src/facebook/login.ts` (constants + `attemptLogin`'s `full_login` and `password_only` arms); tests in `__tests__/login-attempt.test.ts` (mock `pressSequentially` + `waitForTimeout`, add 2 regression tests, expose new `typeCalls` array).
**Depends on**: T16 (P8 baseline — its AYMH escape is the entry point that exposes the vulnerable `full_login` form).
**Reuses**: existing `withNavigation`, `LOGIN_NAVIGATION_TIMEOUT_MS`, scripted-page test mock; the existing `fillCalls` array remains for backwards-compat with prior assertions.

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [x] `HUMAN_TYPE_DELAY_MS = 50` and `HUMAN_PAUSE_BEFORE_SUBMIT_MS = 250` exported from `login.ts`.
- [x] `full_login` arm: email + password typed via `pressSequentially({ delay: HUMAN_TYPE_DELAY_MS })`, then `waitForTimeout(HUMAN_PAUSE_BEFORE_SUBMIT_MS)`, then submit (no other behaviour changes).
- [x] `password_only` arm: password typed via `pressSequentially`, then `waitForTimeout`, then Enter.
- [x] Mock: `pressSequentially` writes to both `fillCalls` (keeps existing assertions green) and a new `typeCalls` array (P9 tests assert on this specifically).
- [x] Mock: `page.waitForTimeout` is a no-op vi mock so tests don't actually sleep.
- [x] Regression test: `full_login → home_feed` ⇒ `typeCalls` contains email + password, `waitForTimeout` was called.
- [x] Regression test: `password_only → home_feed` ⇒ `typeCalls` contains password (NOT email), `waitForTimeout` was called.
- [x] Existing credential-leak guard test still passes (no email/password in any captured log line).
- [x] Full repo `pnpm test` → 408 green (was 406); `pnpm -C packages/connectors exec tsc --noEmit` clean; lint clean on changed files.

---

## Addendum (2026-06-21): P10 + P11 — shipped in branch `fix/fb-aymh-remove-profiles-escape`

### Phase H: AYMH escape — "Remove profiles from this browser" + workflow-failure exit code

```
T18 → T19
```

---

### T18: Replace AYMH escape with "Remove profiles from this browser" click ✅ DONE

**What**: The 2026-06-21 production run proved P8's "Use another profile" click is NOT an AYMH escape — clicking it just submits the AYMH form with `aymh_profile_loaded_count+1` and FB re-serves AYMH because device cookies (`datr`, `sb`, `fr`, `dpr`, `wd`, `ps_l`, `ps_n`) still pin the profile (two consecutive `state:aymh_chooser` steps with same URL, identical `buttonLabels`, htmlLen growing by 3.6KB). The real escape — visible in every AYMH `buttonLabels` fingerprint we've collected — is **"Remove profiles from this browser"**, the AYMH-internal action that clears the device-pinned profile fingerprint and exposes the bare credential form. Same anchoring-failure mode that the PLAYBOOK warned about (`P7`→`P8`): when AYMH renders unchanged on a second iteration, the escape's premise was wrong — switch escape, don't loop.
**Where**: `packages/connectors/src/facebook/login.ts` (replace `useAnotherProfile` SELECTOR with `removeProfilesFromBrowser`; update `LoginScreenState` AYMH comment; update `aymh_chooser` handler); tests in `__tests__/login-attempt.test.ts` (rename existing P8 happy-path test, swap selector references). Classifier tests need no change — detection is still keyed on the hidden `aymh_profile_loaded_count` field.
**Depends on**: T16 (P8 baseline — same handler arm, same `withNavigation` wrapper, same "click best-effort, let no-progress guard bail otherwise" semantics).
**Reuses**: existing `withNavigation`, `LOGIN_NAVIGATION_TIMEOUT_MS`, multi-locale aria-label pattern from `useAnotherProfile`/`continueAsButton`, P9 typing cadence for the subsequent `full_login` step.

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [x] `SELECTORS.removeProfilesFromBrowser` exported with English + Hebrew (masculine + feminine) + Spanish + French + German aria-label exact-matches.
- [x] `SELECTORS.useAnotherProfile` removed (P8's escape replaced — no dead reference left behind).
- [x] `aymh_chooser` handler clicks `removeProfilesFromBrowser` inside `withNavigation`; missing button → skip click, no-progress guard handles bail.
- [x] `LoginScreenState` AYMH comment block reflects the new escape mechanism and explicitly references the 2026-06-21 disproof of "Use another profile".
- [x] Attempt test renamed to reflect the new click target; asserts `clickCalls` contains `removeProfilesFromBrowser`.
- [x] Attempt defense test (escape button missing) still passes: `aymh_chooser × 2` ⇒ `{ success: false, reason: 'unknown_login_page' }`, no loop.
- [x] Classifier tests for `aymh_chooser` unchanged and green.
- [x] No new fields containing cookies/credentials.
- [x] Full repo `pnpm test` green; `pnpm -C packages/connectors exec tsc --noEmit` clean.

---

### T19: Exit non-zero from collect-facebook.ts on the tick that newly disables an account ✅ DONE

**What**: The 2026-06-21 incident showed every right signal (`fb_account_disabled`, `fb_admin_notify_sent`) but GitHub Actions still showed the cron tick as ✅ green because the connector returned `{ candidates: [], nextCursor }` cleanly (it broke out of the per-account loop on `auth_expired`, persisted `disabledAccounts`, and returned), so `collect_fetched`/`collect_complete` fired and `process.exit(1)` never ran. Surface the failure in run history by exiting non-zero on the *transition* tick (one or more accounts newly added to `disabledAccounts` this run vs. the previous cursor). Subsequent ticks of the same disabled set stay green — one disable event ⇒ one red tick ⇒ quiet until the next signal. Reuse the existing `newlyDisabled` detection block that already drives `notifyAdminCookieExpiry`.
**Where**: `scripts/collect-facebook.ts` (lift `newlyDisabled.length` from the admin-notify block into an outer `newlyDisabledCount` counter; after `collect_complete`+`cleanup()`, if `newlyDisabledCount > 0` log `collect_failed_newly_disabled_accounts` and `process.exit(1)`).
**Depends on**: none — pure observability glue, independent of the login.ts P10 change.
**Reuses**: existing `newlyDisabled` array + `JSON.parse(nextCursor)` pattern in the admin-notify block above it.

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [x] After `collect_complete` + `cleanup()`, the script checks `newlyDisabledCount` (already computed earlier for admin notification).
- [x] When `newlyDisabledCount > 0`, logs `collect_failed_newly_disabled_accounts` with `{ newlyDisabledCount }` and `process.exit(1)`.
- [x] When no account was newly disabled this tick, the script exits 0 (even if the disabled set is non-empty — subsequent ticks of an already-broken state stay green so the workflow doesn't get stuck red until manual reset).
- [x] Cursor-parse failure falls through to the existing success path (no false-negative failure from malformed JSON).
- [x] No new admin notification — the per-account `notifyAdminCookieExpiry` calls already informed the operator; the workflow-failure signal is for GitHub Actions surfacing only.
- [x] `pnpm -C packages/connectors exec tsc --noEmit` clean (no new types needed); manual code-read confirms the exit path is downstream of `cleanup()`.

---

## Addendum (2026-06-28): P12 — shipped in branch `fix/fb-aymh-remove-profiles-modal-confirm`

### Phase I: AYMH escape — modal confirmation

```
T20
```

---

### T20: Confirm the AYMH "Remove profiles" flow inside its confirmation modal ✅ DONE

**What**: The 2026-06-28 production trace proved P10's "Remove profiles from this browser" click is the FIRST step of a two-step FB flow — clicking it opens a `[role="dialog"]` confirmation modal (step 0→1: same aymh state, htmlLen +51KB, new "Close" button in buttonLabels). The actual device-fingerprint clear requires a second click on the in-dialog CTA (same aria-label, different DOM location). Sequence both clicks in one `aymh_chooser` handler invocation, separated by `waitForTimeout(HUMAN_PAUSE_BEFORE_SUBMIT_MS)` for modal render. Scope the second click to `[role="dialog"]` descendants to avoid racing the now-occluded page button.
**Where**: `packages/connectors/src/facebook/login.ts` (add `SELECTORS.removeProfilesConfirmInDialog`, multi-locale aria-label exact-match scoped to `[role="dialog"]`; update `aymh_chooser` handler to do trigger.click → wait → confirm.click); `LoginScreenState` AYMH comment updated to describe the two-step flow. Tests in `__tests__/login-attempt.test.ts` — update existing single-click test comment to reflect the no-modal variant; add new modal-confirm regression test with 4-step mock (page button → modal open → login form → home feed).
**Depends on**: T18 (P10 — same handler arm, same `withNavigation` wrapper, reuses `removeProfilesFromBrowser` selector unchanged).
**Reuses**: `withNavigation`, `LOGIN_NAVIGATION_TIMEOUT_MS`, `HUMAN_PAUSE_BEFORE_SUBMIT_MS` (semantically the same pause — give FB UI time to render), multi-locale aria-label pattern.

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [x] `SELECTORS.removeProfilesConfirmInDialog` exported with English + Hebrew (masculine + feminine) + Spanish + French + German aria-label exact-matches, all scoped to `[role="dialog"]` descendants.
- [x] `aymh_chooser` handler invokes: trigger click (page button) → `waitForTimeout(HUMAN_PAUSE_BEFORE_SUBMIT_MS)` → confirm click (in-dialog CTA). Each click guarded by `count > 0`; missing element → skip.
- [x] `LoginScreenState` AYMH comment block describes the two-step flow and references the 2026-06-28 disproof of the single-click assumption.
- [x] New attempt test asserts `clickCalls` contains BOTH `removeProfilesFromBrowser` AND `removeProfilesConfirmInDialog`, ends in `{ success: true }`.
- [x] Existing single-click P10 test still passes (no-modal variant — second find returns count=0, skip, advance to `full_login`).
- [x] Defense test `aymh_chooser × 2` (both buttons absent) still passes — no loop, bail with `unknown_login_page`.
- [x] No new fields containing cookies/credentials in fingerprint payloads.
- [x] Full `pnpm exec vitest run` green; `pnpm typecheck` clean.
