# Facebook Auto-Login Tasks

**Design**: `.specs/features/facebook-auto-login/design.md`
**Status**: T01–T18 implemented + green (384/384 tests). T19–T20 are manual smoke tests pending the user's local Playwright run.

---

## Execution Plan

```
Phase 1: Types & contracts (sequential)
  T01 ──→ T02

Phase 2: Credentials loader (parallel with Phase 3)
  T01 done → T03 [P] → T04 [P]

Phase 3: Login flow module (sequential within file; parallel with Phase 2)
  T01 done →
    T05 → T06 → T07
              ↘ T08 [P, after T06]
              ↘ T09 [P, after T07]

Phase 4: Connector integration (sequential after Phases 1-3)
  T02, T03, T07 done →
    T10 → T11 → T12 → T13

Phase 5: Alert specialization (parallel with Phase 4)
  T02 done →
    T14 [P] → T15 [P] → T16 [P]

Phase 6: Workflow + manual verification (sequential after Phase 4 + 5)
  T13, T16 done →
    T17 [P] → T18 [P]
  T17 done → T19 → T20
```

`[P]` = can run in parallel with peers in the same row.

---

## Task Breakdown

### T01: Extend types — `LoginOutcome` + cursor `loginAttempts`

**What**: Add `LoginOutcome` discriminated union and extend `FacebookCursorState` with optional `loginAttempts` map.
**Where**: `packages/connectors/src/facebook/types.ts` (modify)
**Depends on**: None
**Reuses**: Existing `FacebookCursorState` shape.

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `LoginOutcome` exported as `{ success: true } | { success: false; reason: 'invalid_credentials' | 'checkpoint' | 'captcha' | 'two_factor' | 'unknown_login_page' | 'timeout' | 'budget_exhausted' }`.
- [ ] `FacebookCursorState.loginAttempts?: Record<string, { count: number; firstAttemptAt: string; lastAttemptAt: string; lastReason?: ...; budgetAlertSent?: boolean }>` — additive, optional.
- [ ] No TypeScript errors: `pnpm typecheck` passes.
- [ ] Existing 326 tests still pass: `pnpm test`.

**Verify**:
```bash
pnpm typecheck && pnpm test
```
Expected: 0 errors, all tests green.

---

### T02: Extend `FacebookClientError` to carry login outcome

**What**: Add optional `loginOutcome?: LoginOutcome` property to the error class so the script layer can specialize alerts.
**Where**: `packages/connectors/src/facebook/client.ts` (modify lines 46-55)
**Depends on**: T01
**Reuses**: Existing `FacebookClientError` constructor pattern.

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Constructor accepts optional 4th arg `loginOutcome?: LoginOutcome`, exposed as a public readonly property.
- [ ] Existing call sites unchanged (omitting the arg keeps current behavior).
- [ ] `pnpm typecheck` passes; existing tests pass.

**Verify**:
```bash
pnpm typecheck && pnpm test -- packages/connectors
```

---

### T03: Implement `credentials.ts` [P]

**What**: New module exporting `loadCredentials(accountId)` and `isAutoLoginEnabled()`.
**Where**: `packages/connectors/src/facebook/credentials.ts` (new file)
**Depends on**: T01
**Reuses**: Same env-var lookup pattern as `accounts.ts:14-33`.

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `isAutoLoginEnabled()` returns `true` iff `process.env.FB_AUTO_LOGIN_ENABLED === 'true'`.
- [ ] `loadCredentials(accountId)` returns `{ email, password }` if both `FB_EMAIL_<id>` and `FB_PASSWORD_<id>` are non-empty.
- [ ] Falls back to shared `FB_EMAIL`/`FB_PASSWORD` only when account-scoped vars are empty AND `FB_ACCOUNT_COUNT === '1'`.
- [ ] Returns `null` when either email or password is missing/empty (per spec edge case).
- [ ] Module exports nothing else (no helpers leaking to public API).

**Verify**:
```bash
pnpm typecheck
```

---

### T04: Unit tests for `credentials.ts` [P]

**What**: Cover all env-var combinations.
**Where**: `packages/connectors/src/facebook/__tests__/credentials.test.ts` (new file)
**Depends on**: T03
**Reuses**: Vitest patterns from `__tests__/accounts.test.ts` (env-var stubbing via `beforeEach` reset of `process.env`).

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Test cases:
  - FF off (unset, empty, `"false"`, `"True"` capitalization) → `isAutoLoginEnabled() === false`.
  - FF on (`"true"`) → `true`.
  - Account-scoped both set → returns those values.
  - Account-scoped partial (only email or only password) → `null`.
  - Account-scoped unset, shared set, `FB_ACCOUNT_COUNT=1` → returns shared.
  - Account-scoped unset, shared set, `FB_ACCOUNT_COUNT=2` → `null` (no fallback for multi-account).
  - All unset → `null`.
- [ ] All tests pass: `pnpm test -- credentials`.

**Verify**:
```bash
pnpm test -- credentials
```

---

### T05: Create `login.ts` skeleton — constants + locators

**What**: New module with `SELECTORS`, `CONTINUE_LOCALES`, `CONTINUE_RE`, `continueAsLocators`, `MAX_LOGIN_STEPS`, `LOGIN_TIMEOUT_MS`, `LOGIN_NAVIGATION_TIMEOUT_MS`, `MAX_LOGIN_ATTEMPTS_PER_EPISODE`, `LOGIN_EPISODE_WINDOW_MS`.
**Where**: `packages/connectors/src/facebook/login.ts` (new file)
**Depends on**: T01
**Reuses**: Selector + constant pattern from `client.ts`, `constants.ts`.

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] All constants defined with values from design.md Data Models section.
- [ ] `CONTINUE_RE` correctly built from `CONTINUE_LOCALES` with proper regex escaping + `\b\s+\S+` suffix.
- [ ] `continueAsLocators(page)` returns 3 locators in priority order (role+name → role+span text → anchor fallback).
- [ ] No exports outside what is needed by `attemptLogin` and tests; avoid public API leakage.
- [ ] `pnpm typecheck` passes.

**Verify**:
```bash
pnpm typecheck
```

---

### T06: Implement `classifyLoginScreen`

**What**: Pure-async function that probes the page and returns a discriminated `LoginScreenState`.
**Where**: `packages/connectors/src/facebook/login.ts` (modify)
**Depends on**: T05
**Reuses**: `detectAuthFailure` pattern from `client.ts:180`.

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Returns a `LoginScreenState` discriminated union covering all 10 states from design.md.
- [ ] Detection priority order matches design: `home_feed` → `checkpoint` → `captcha` → `two_factor` → `continue_as_user` → `password_only` → `full_login` → `invalid_credentials` → `save_login_prompt` → `cookie_consent` → `unknown`.
- [ ] Uses `page.url()`, `page.locator(...).count()`, and `getByRole` where appropriate.
- [ ] No DOM mutation, no clicks — classification only.
- [ ] No credential strings appear in any log statement (search the file for `email`/`password` literals — only allowed in selector strings like `'input[name="email"]'`).

**Verify**:
```bash
pnpm typecheck
grep -nE '(email|password)' packages/connectors/src/facebook/login.ts | grep -v "name=\"email\"\\|name=\"pass\""
```
Expected: no matches outside selector strings.

---

### T07: Implement `attemptLogin` state-machine driver

**What**: The bounded loop that drives classification → action → re-classification, returning `LoginOutcome`.
**Where**: `packages/connectors/src/facebook/login.ts` (modify)
**Depends on**: T06
**Reuses**: Logging style from `client.ts` (`console.log(JSON.stringify({ event: 'fb_login_*', ... }))`).

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Function signature: `attemptLogin(page: Page, creds: { email: string; password: string }, opts?: { maxSteps?: number; timeoutMs?: number }): Promise<LoginOutcome>`.
- [ ] Step cap (`MAX_LOGIN_STEPS = 5`) enforced; exit with `unknown_login_page` if reached.
- [ ] No-progress detection: same non-terminal state twice → exit `unknown_login_page`.
- [ ] Per-state action handlers implemented: full_login submit, password_only submit, continue_as_user click, save_login_prompt dismiss, cookie_consent dismiss.
- [ ] Navigation waits use `Promise.all([page.waitForLoadState('domcontentloaded'), action])` with 15s timeout.
- [ ] Catches `TimeoutError` → returns `{ success: false, reason: 'timeout' }`.
- [ ] Logs `fb_login_attempt` (start), `fb_login_step` (per state, no creds), `fb_login_success` or `fb_login_failed` (terminal).
- [ ] Email/password values NEVER appear in any log payload.

**Verify**:
```bash
pnpm typecheck
```

---

### T08: Unit tests for `classifyLoginScreen` [P]

**What**: 10+ tests, one per state, with mocked Page.
**Where**: `packages/connectors/src/facebook/__tests__/login-classify.test.ts` (new file)
**Depends on**: T06
**Reuses**: Vitest mocking style from `__tests__/client.test.ts`.

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] One test per state from design table (10 states + `unknown` fallback = 11 cases).
- [ ] Each test uses a hand-rolled `Page` mock (`{ url: () => '...', locator: vi.fn(...), getByRole: vi.fn(...), $: vi.fn(...) }`) returning the right shape.
- [ ] Priority test: when both `home_feed` and `cookie_consent` selectors match, returns `home_feed` (priority order assertion).
- [ ] All tests pass: `pnpm test -- login-classify`.

**Verify**:
```bash
pnpm test -- login-classify
```

---

### T09: Unit tests for `attemptLogin` [P]

**What**: Drive the state machine through happy + failure paths.
**Where**: `packages/connectors/src/facebook/__tests__/login-attempt.test.ts` (new file)
**Depends on**: T07
**Reuses**: Same Page-mock style as T08.

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Happy path: full_login → home_feed → `{ success: true }`. Asserts email + password were typed (via `fill` mock).
- [ ] Continue-as path: continue_as_user → home_feed → `{ success: true }`. Asserts no password was ever typed.
- [ ] Continue → password_only → home_feed (Facebook re-challenged after Continue) → `{ success: true }`.
- [ ] full_login → invalid_credentials → `{ success: false, reason: 'invalid_credentials' }`.
- [ ] checkpoint detected first → `{ success: false, reason: 'checkpoint' }`. No clicks dispatched.
- [ ] captcha detected → `{ success: false, reason: 'captcha' }`. No clicks.
- [ ] two_factor detected → `{ success: false, reason: 'two_factor' }`. No clicks.
- [ ] No-progress (same state twice) → `{ success: false, reason: 'unknown_login_page' }`.
- [ ] Step cap exceeded → `{ success: false, reason: 'unknown_login_page' }`.
- [ ] Navigation timeout → `{ success: false, reason: 'timeout' }`.
- [ ] **Credential-leak guard**: `JSON.stringify`-capture all `console.log` calls during the happy-path test; assert no string contains the configured email or password.
- [ ] All tests pass: `pnpm test -- login-attempt`.

**Verify**:
```bash
pnpm test -- login-attempt
```

---

### T10: Add budget helpers to connector

**What**: Add `loginAttempted` instance Set + private helpers `canAttemptLogin(state, accountId)`, `recordLoginSuccess(state, accountId)`, `recordLoginFailure(state, accountId, reason)` to `FacebookConnector`.
**Where**: `packages/connectors/src/facebook/index.ts` (modify class)
**Depends on**: T01
**Reuses**: Existing class structure + cursor-state mutation pattern.

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `private loginAttempted = new Set<string>()` instance field.
- [ ] `canAttemptLogin(state, accountId)` returns a discriminated `{ allowed: true } | { allowed: false; reason: 'flag_off' | 'no_credentials' | 'already_attempted_this_run' | 'budget_exhausted'; budgetAlertNeeded?: boolean }`.
- [ ] Budget logic exactly matches design Error Handling row: 3 attempts, 24h sliding window from `firstAttemptAt`. Window-elapsed → reset counter.
- [ ] `recordLoginSuccess` deletes `state.loginAttempts[accountId]`.
- [ ] `recordLoginFailure` increments count, sets timestamps, persists `lastReason`. On hitting count=3 sets `budgetAlertSent` AFTER the alert is sent (separate step in T11).
- [ ] `pnpm typecheck` passes.

**Verify**:
```bash
pnpm typecheck
```

---

### T11: Implement `fetchGroupWithLoginRecovery`

**What**: Private method on `FacebookConnector` that wraps `fetchGroupWithRetry` with one-shot login recovery.
**Where**: `packages/connectors/src/facebook/index.ts` (modify class)
**Depends on**: T03, T07, T10
**Reuses**: Existing connector error-handling pattern.

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Catches `FacebookClientError` with `errorType ∈ {auth_expired, banned}` from inner `fetchGroupWithRetry`.
- [ ] Calls `canAttemptLogin(state, accountId)`. If not allowed → annotates the rethrown error with `loginOutcome` reflecting the gate that blocked (e.g., `{ success: false, reason: 'budget_exhausted' }` for budget gate) and rethrows.
- [ ] If allowed → `loadCredentials(accountId)` → `attemptLogin(page, creds)`.
  - On success: `recordLoginSuccess`, mark `loginAttempted.add(accountId)`, retry `fetchGroupWithRetry` ONCE. If retry succeeds, return its posts; if retry throws, attach the success-then-failure outcome to the error and rethrow.
  - On failure: `recordLoginFailure(state, accountId, outcome.reason)`, mark `loginAttempted.add(accountId)`, attach `loginOutcome` to the original error, rethrow.
- [ ] Never logs credentials.
- [ ] `pnpm typecheck` passes.

**Verify**:
```bash
pnpm typecheck
```

---

### T12: Wire `fetchGroupWithLoginRecovery` into `fetchNew`

**What**: Replace the direct `fetchGroupWithRetry(page, group.groupId)` call at `index.ts:116` with `this.fetchGroupWithLoginRecovery(page, group.groupId, selected.account.id, state)`.
**Where**: `packages/connectors/src/facebook/index.ts` (modify line ~116)
**Depends on**: T11
**Reuses**: Existing per-group loop structure.

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Single call site changed; rest of the per-group loop unchanged.
- [ ] `state.loginAttempts` is included in the constructed `updatedState` returned at end of `fetchNew` (so budget persists across runs).
- [ ] `pnpm typecheck` + `pnpm test` pass (existing 326 still green).

**Verify**:
```bash
pnpm typecheck && pnpm test
```

---

### T13: Unit tests for connector wrapper + budget enforcement

**What**: Mock `attemptLogin` and `fetchGroupWithRetry` to drive the wrapper through gate combinations and budget table cases.
**Where**: `packages/connectors/src/facebook/__tests__/login-recovery.test.ts` (new file)
**Depends on**: T12
**Reuses**: Vitest module-mocking via `vi.mock(...)` (refer CLAUDE.md Vitest Mock Debugging Protocol if mock propagation issues arise).

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] FF off → `attemptLogin` not called; original error rethrown unchanged.
- [ ] No credentials for accountId → `attemptLogin` not called; logs `fb_login_skip_no_credentials`.
- [ ] Already attempted this run → `attemptLogin` not called; rethrows.
- [ ] Budget table cases (5 from design test strategy):
  - `loginAttempts` empty → attempt allowed, counter set to 1.
  - `count=1, firstAttemptAt=1h ago` → allowed, counter→2.
  - `count=3, firstAttemptAt=2h ago, budgetAlertSent=false` → SKIPPED with reason=`budget_exhausted`, alert needed.
  - Same but `budgetAlertSent=true` → SKIPPED, NO alert.
  - `count=3, firstAttemptAt=25h ago` → window elapsed, counter RESET to 1, attempt allowed.
- [ ] Success after 2 prior failures → `loginAttempts[N]` deleted.
- [ ] Success path retries `fetchGroupWithRetry` exactly once.
- [ ] All tests pass: `pnpm test -- login-recovery`.

**Verify**:
```bash
pnpm test -- login-recovery
```

---

### T14: Specialize `notifyAdminCookieExpiry` per `LoginOutcome.reason` [P]

**What**: Extend the script function signature with optional `loginOutcome` parameter and a per-reason message map.
**Where**: `scripts/collect-facebook.ts` (modify lines 78-135)
**Depends on**: T02
**Reuses**: Existing fetch logic; only message string is conditional.

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] New signature: `notifyAdminCookieExpiry(accountId, errorType, loginOutcome?: LoginOutcome): Promise<void>`.
- [ ] Message map covers all reasons from design (P2 ACs):
  - `invalid_credentials`: "FB account #N: auto-login failed — credentials rejected. Update `FB_PASSWORD_N`..."
  - `checkpoint`: "FB account #N: Facebook checkpoint blocking login. Resolve in a browser, then refresh `FB_COOKIES_N` manually..."
  - `captcha`: includes reason + one-line hint, no HTML/screenshot dump.
  - `two_factor`: "FB account #N: Facebook is requiring 2FA. This account is no longer compatible with auto-login."
  - `unknown_login_page`: includes "selectors did not match" hint, link to inspect run logs.
  - `timeout`: existing default message (transient).
  - `budget_exhausted`: "FB account #N: auto-login budget exhausted (3 failed attempts). Backing off 24h. Resolve underlying cause before counter resets."
- [ ] When `loginOutcome` is omitted: existing default message used (backward compat).
- [ ] `pnpm typecheck` passes.

**Verify**:
```bash
pnpm typecheck
```

---

### T15: Wire `loginOutcome` from caught error → `notifyAdminCookieExpiry` [P]

**What**: In `scripts/collect-facebook.ts`, extract `loginOutcome` from the caught `FacebookClientError` and pass to the alert function.
**Where**: `scripts/collect-facebook.ts` (modify lines 173-207)
**Depends on**: T14
**Reuses**: Existing duck-typing pattern from `getConnectorErrorType`.

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] New helper `getConnectorLoginOutcome(err): LoginOutcome | undefined` mirrors `getConnectorErrorType`.
- [ ] Both call sites that invoke `notifyAdminCookieExpiry` (the catch block at line ~181 AND the cursor-delta loop at line ~201) pass `loginOutcome` when available.
- [ ] For the cursor-delta loop, `loginOutcome` is read from `state.loginAttempts[accountId].lastReason` if present.
- [ ] `pnpm typecheck` passes.

**Verify**:
```bash
pnpm typecheck
```

---

### T16: Unit tests for alert text per reason [P]

**What**: Verify message text for each reason without hitting the Telegram API.
**Where**: `scripts/__tests__/collect-facebook-alerts.test.ts` (new file) OR inline if a script-test pattern doesn't exist yet.
**Depends on**: T14
**Reuses**: Vitest `vi.spyOn(global, 'fetch')` to capture the request body.

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] One test per reason (7 cases from T14): asserts the captured `body.text` includes the expected reason-specific phrase.
- [ ] One test for the no-`loginOutcome` legacy path (assert default message).
- [ ] All tests pass.

**Verify**:
```bash
pnpm test -- collect-facebook-alerts
```

---

### T17: Update GitHub Actions workflow YAML [P]

**What**: Add `FB_AUTO_LOGIN_ENABLED`, `FB_EMAIL_1`, `FB_PASSWORD_1`, `FB_EMAIL_2`, `FB_PASSWORD_2` env passthroughs (matching existing `FB_COOKIES_N` pattern).
**Where**: `.github/workflows/collect-facebook.yml` (modify env block)
**Depends on**: T13 (don't merge before code is in place)
**Reuses**: Existing env-var passthrough pattern.

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] 5 new env entries added; no other workflow changes.
- [ ] YAML is valid: `pnpm exec yaml-lint .github/workflows/collect-facebook.yml` (or local YAML parser of choice).

**Verify**:
```bash
pnpm exec node -e "require('js-yaml').load(require('fs').readFileSync('.github/workflows/collect-facebook.yml','utf8'))"
```
Expected: no error thrown.

---

### T18: Update `DEPLOYMENT.md` with secrets + flag-flip order [P]

**What**: Document the new GitHub Secrets and the recommended order: create email/password secrets first, then flip `FB_AUTO_LOGIN_ENABLED=true`.
**Where**: `DEPLOYMENT.md` (modify Secrets section)
**Depends on**: T17
**Reuses**: Existing Secrets section format.

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Section lists `FB_EMAIL_N`, `FB_PASSWORD_N`, `FB_AUTO_LOGIN_ENABLED` with one-line descriptions each.
- [ ] Ordering note: "Set credentials first, flip the flag last — auto-login activates immediately on the next cron tick."
- [ ] Mentions the budget: "3 failed login attempts per account per 24h, then back off until the counter resets."
- [ ] No code changes required.

**Verify**: Visual diff review.

---

### T19: Local smoke test — auto-login success path

**What**: Manual end-to-end test in a real Playwright session.
**Where**: Local machine (`.env` + `.browser-profiles/`)
**Depends on**: T17
**Reuses**: Existing `pnpm collect:facebook:local` invocation.

**Tools**:
- MCP: NONE
- Skill: `verify`

**Done when**:
- [ ] In `.env`: set `FB_AUTO_LOGIN_ENABLED=true`, `FB_EMAIL_1=<your email>`, `FB_PASSWORD_1=<your password>`.
- [ ] Force expiry: `rm -rf .browser-profiles/fb-account-1` AND set `FB_COOKIES_1` to obviously-stale junk (so auth check fails on first navigation).
- [ ] Run: `set -a && source .env && set +a && pnpm collect:facebook:local`.
- [ ] Verify in stdout:
  - `event: fb_login_attempt, accountId: "1"`
  - `event: fb_login_step` events for at least one classified state
  - `event: fb_login_success, accountId: "1"`
  - Subsequent `event: fb_navigate_group` for monitored groups
  - `event: collect_complete` with `candidateCount > 0`
- [ ] Inspect captured stdout for ANY occurrence of the configured email or password — must be zero.

**Verify**:
```bash
set -a && source .env && set +a && pnpm collect:facebook:local 2>&1 | tee /tmp/fb-smoke.log
grep -F "$FB_EMAIL_1\|$FB_PASSWORD_1" /tmp/fb-smoke.log && echo "LEAK!" || echo "clean"
```
Expected: `clean`.

---

### T20: Local smoke test — invalid credentials path

**What**: Manual end-to-end test with deliberately-wrong password.
**Where**: Local machine
**Depends on**: T19
**Reuses**: Same harness as T19.

**Tools**:
- MCP: NONE
- Skill: `verify`

**Done when**:
- [ ] `.env`: set `FB_PASSWORD_1=deliberatelywrong`. Stub or accept the Telegram alert (e.g., set `TELEGRAM_ADMIN_CHAT_ID` to a personal test chat).
- [ ] Run as in T19.
- [ ] Verify in stdout:
  - `event: fb_login_attempt`
  - `event: fb_login_failed, reason: "invalid_credentials"`
  - `event: fb_admin_notify_sent` once (not multiple times)
- [ ] Verify Telegram message text matches the `invalid_credentials` template from T14.
- [ ] Re-run the script immediately. Verify:
  - `event: fb_login_skip` (already attempted) — no second login submission.
  - No second Telegram alert (de-dup via `disabledAccounts` cursor delta).
- [ ] Run 2 more times to reach budget=3, then once more — verify `event: fb_login_skip, reason: "budget_exhausted"` and exactly one `budget_exhausted` alert sent across all the over-budget runs.

**Verify**: Visual log inspection + Telegram inbox.

---

## Parallel Execution Map

```
Phase 1 (Sequential):
  T01 ──→ T02

Phase 2 (after T01) — Credentials, parallel with Phase 3:
  T03 [P] → T04 [P]

Phase 3 (after T01) — Login module, mostly sequential:
  T05 → T06 → T07
            ↘ T08 [P after T06]
            ↘ T09 [P after T07]

Phase 4 (after T03 + T07) — Connector integration:
  T10 → T11 → T12 → T13

Phase 5 (after T02) — Alerts, parallel with Phase 4:
  T14 [P] → T15 [P] → T16 [P]

Phase 6 (after T13 + T16) — Workflow + smoke:
  T17 [P], T18 [P]
  T17 done → T19 → T20
```

---

## Task Granularity Check

| Task                                                  | Scope                | Status                |
|-------------------------------------------------------|----------------------|-----------------------|
| T01: Extend types                                     | 1 file, 2 type defs  | ✅ Done               |
| T02: Extend FacebookClientError                       | 1 class, 1 prop      | ✅ Done               |
| T03: Implement `credentials.ts`                       | 1 file, 2 functions  | ✅ Done               |
| T04: Tests for credentials.ts                         | 1 test file          | ✅ Done (13 tests)    |
| T05: `login.ts` skeleton                              | 1 file, constants    | ✅ Done               |
| T06: `classifyLoginScreen`                            | 1 function           | ✅ Done               |
| T07: `attemptLogin`                                   | 1 function (driver)  | ✅ Done               |
| T08: Tests for classifier                             | 1 test file          | ✅ Done (14 tests)    |
| T09: Tests for attemptLogin                           | 1 test file          | ✅ Done (10 tests)    |
| T10: Budget helpers on connector                      | 3 private methods    | ✅ Done               |
| T11: `fetchGroupWithLoginRecovery`                    | 1 private method     | ✅ Done               |
| T12: Wire wrapper into fetchNew                       | 1 call-site swap     | ✅ Done               |
| T13: Tests for connector wrapper                      | 1 test file          | ✅ Done (9 tests)     |
| T14: Specialize alert messages                        | 1 function extension | ✅ Done               |
| T15: Wire loginOutcome from error                     | 2 call sites         | ✅ Done               |
| T16: Tests for alert text                             | 1 test file          | ✅ Done (12 tests)    |
| T17: Workflow YAML diff                               | 1 file               | ✅ Done               |
| T18: DEPLOYMENT.md update                             | 1 doc section        | ✅ Done               |
| T19: Smoke test happy path                            | 1 manual run         | ⏸ Pending user smoke |
| T20: Smoke test failure path + budget                 | 1 manual run         | ⏸ Pending user smoke |

---

## Tools / Skills (per-phase summary)

For all coding tasks (T01–T17): no MCPs, no skills. Standard `pnpm typecheck` / `pnpm test` are sufficient.

For T19 + T20: `verify` skill recommended to drive the manual smoke runs and assert on observable behavior.

For PR creation after T20: `git-master` for atomic commits structured per phase boundary (e.g., one commit per phase, or one per feature-level concern).
