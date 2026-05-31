# Facebook Login Recovery Hardening Design

**Spec**: `.specs/features/facebook-login-recovery-hardening/spec.md`
**Status**: Approved

---

## Architecture Overview

The fix lives entirely in the login state machine (`login.ts`). No connector, cursor, DB, or env changes. We introduce one new transient state — `redirecting` — that represents Facebook's one-time login-redirect interstitial (`/?crypted_string=...&next=...`). `classifyLoginScreen()` returns it instead of falsely matching `home_feed`; `attemptLogin()` handles it by *actively* waiting for the redirect to resolve, then re-classifies on the next step. Once the interstitial settles, a truly-expired session renders the logged-out homepage (which carries `input[name="email"]`/`input[name="pass"]`), so the existing `full_login`/`password_only` handlers take over and type the real credentials.

```mermaid
graph TD
    A["auth_expired detected (connector)"] --> B["attemptLogin loop"]
    B --> C{classifyLoginScreen}
    C -->|continue_as_user| D["click 'Continue as'"]
    D --> C
    C -->|"url has crypted_string (NEW)"| R["redirecting: wait for redirect to settle"]
    R --> C
    C -->|full_login / password_only| E["fill FB_EMAIL/FB_PASSWORD"]
    E --> C
    C -->|home_feed (no crypted_string)| S["return success: true"]
    C -->|checkpoint/captcha/2fa/invalid| F["return success: false (reason)"]
    C -->|unknown / no-progress| G["return success: false: unknown_login_page"]
```

**Before (bug):** the `crypted_string` interstitial matched `home_feed` (priority 1: not `/login` + `[role=main]` + no email field yet rendered) → premature `success: true` → credential step skipped.
**After:** the interstitial is `redirecting` → waited out → resolves to the logged-out homepage → `full_login` → credentials entered → real `home_feed`.

---

## Code Reuse Analysis

### Existing Components to Leverage

| Component | Location | How to Use |
| --------- | -------- | ---------- |
| `classifyLoginScreen()` | `packages/connectors/src/facebook/login.ts` | Add interstitial detection as a new top-priority branch; everything else unchanged |
| `attemptLogin()` step loop | `packages/connectors/src/facebook/login.ts` | Add a handler arm for the `redirecting` state; reuse existing no-progress guard for loop safety |
| `LoginScreenState` union | `packages/connectors/src/facebook/login.ts` | Extend with `'redirecting'` |
| `LOGIN_NAVIGATION_TIMEOUT_MS` | `packages/connectors/src/facebook/login.ts` | Reuse as the settle timeout for `waitForURL` |
| `withNavigation()` / `page.waitForLoadState` patterns | `login.ts` | Same XHR/networkidle waiting style for the redirect settle |
| No-progress guard (`prevState === state`) | `attemptLogin()` | Already caps repeated states → guarantees `redirecting` can't loop forever |

### Integration Points

| System | Integration Method |
| ------ | ------------------ |
| `FacebookConnector.fetchGroupWithLoginRecovery` (`index.ts`) | Unchanged — still calls `attemptLogin`, still re-fetches the group to verify, still enforces one-attempt-per-run + disable-on-failure |
| `LoginOutcome` / `LoginFailureReason` (`types.ts`) | Unchanged — no new outcome reasons; `redirecting` is internal to the state machine, never surfaced as an outcome |

---

## Components

### `classifyLoginScreen()` (modify)

- **Purpose**: Add a new highest-priority branch that recognizes the login-redirect interstitial so it is never confused with the home feed.
- **Location**: `packages/connectors/src/facebook/login.ts`
- **Interfaces**:
  - `classifyLoginScreen(page: Page): Promise<LoginScreenState>` — now may return `'redirecting'`.
- **Behavior change**:
  - NEW Priority 0: if `url` contains `crypted_string=` (login-redirect token) → return `'redirecting'`.
  - Priority 1 `home_feed` unchanged otherwise (genuine home URL + feed/main + no email input still returns `home_feed`).
- **Dependencies**: `page.url()` only (pure/stateless — keeps it unit-testable).
- **Reuses**: existing priority-ladder structure.

### `attemptLogin()` (modify)

- **Purpose**: Treat `redirecting` as a non-terminal "wait and re-check" step instead of failing or succeeding.
- **Location**: `packages/connectors/src/facebook/login.ts`
- **Interfaces**: `attemptLogin(page, creds, opts?): Promise<LoginOutcome>` — signature unchanged.
- **Behavior change** — new arm before the generic `unknown` fallthrough:
  - `if (state === 'redirecting')`: actively wait for the redirect to leave the interstitial:
    `await page.waitForURL((u) => !u.toString().includes('crypted_string'), { timeout: LOGIN_NAVIGATION_TIMEOUT_MS }).catch(() => undefined);`
    then, as a deterministic fallback if still stuck, `await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' }).catch(() => undefined);` then `continue` (re-classify next step).
  - The existing no-progress guard (`prevState === state`) ensures that if `redirecting` recurs with no resolution, the loop bails with `unknown_login_page` (AC P1#4 / P2#4) — no infinite loop.
- **Dependencies**: Playwright `page.waitForURL`, `page.goto`.
- **Reuses**: existing `continue` step semantics, no-progress guard, step/time budget.

### Tests (add)

- **`__tests__/login-classify.test.ts`**: add `redirecting` cases (crypted_string URL with/without `[role=main]`), assert genuine `HOME_URL` still `home_feed`.
- **`__tests__/login-attempt.test.ts`**: add a scripted-sequence test proving `continue_as_user → redirecting → full_login → home_feed` fills credentials and returns `{ success: true }`; add a `redirecting → redirecting` no-progress test returning `unknown_login_page`.

---

## Data Models

No data-model changes. `LoginScreenState` gains one literal:

```typescript
export type LoginScreenState =
  | 'home_feed'
  | 'checkpoint'
  | 'captcha'
  | 'two_factor'
  | 'continue_as_user'
  | 'password_only'
  | 'full_login'
  | 'invalid_credentials'
  | 'save_login_prompt'
  | 'cookie_consent'
  | 'redirecting' // NEW: FB one-time login-redirect interstitial
  | 'unknown';
```

`LoginOutcome`, `FacebookCursorState`, and persisted JSON are untouched.

---

## Error Handling Strategy

| Error Scenario | Handling | User Impact |
| -------------- | -------- | ----------- |
| Interstitial never resolves within budget | No-progress guard / max-steps → `{ success: false, reason: 'unknown_login_page' }` | Account skipped + existing admin alert (accurate reason, not a fake success) |
| Redirect resolves to `/checkpoint/` | classified `checkpoint` → `{ success: false, reason: 'checkpoint' }` | Existing checkpoint alert (manual recovery) |
| `waitForURL` / fallback `goto` throws/times out | `.catch(() => undefined)` → re-classify on current page | Degrades gracefully; no crash |
| Genuine login then group nav still fails | Unchanged: one-attempt cap → disable + alert | Same as `facebook-auto-login` (loop prevention preserved) |

---

## Tech Decisions

| Decision | Choice | Rationale |
| -------- | ------ | --------- |
| Where to fix | `login.ts` only | Connector already verifies via group re-fetch; the sole defect is the false success inside the state machine |
| Detect interstitial by | URL `crypted_string=` substring | It is the unique, stable marker of FB's one-time login redirect; cheap and stateless (keeps `classifyLoginScreen` pure) |
| Resolve interstitial by | active `waitForURL` off `crypted_string` + deterministic `goto('/')` fallback | Observed `networkidle` fires *during* the redirect; a passive wait re-reads the same interstitial. Active URL wait + goto guarantees a settled page |
| New outcome reason? | No | Keep `LoginOutcome` stable; `redirecting` is internal — failures still map to existing `unknown_login_page`/`checkpoint` reasons |
| Reorder `continue_as_user` vs credential priority? | No | After the interstitial settles to the logged-out homepage, the existing `full_login` handler fills credentials; no priority change needed (lower risk to happy path) |
