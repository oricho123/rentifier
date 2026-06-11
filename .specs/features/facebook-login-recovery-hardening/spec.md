# Facebook Login Recovery Hardening Specification

## Problem Statement

The reactive auto-login feature (`facebook-auto-login`) is silently failing on its most common trigger. When a session expires, Facebook serves the *remembered-account* chooser ("Continue as <Name>") on `/login/?next=...` because the account-id cookie (`c_user`) survives but the auth token (`xs`) is dead. The recovery code clicks "Continue as", which **cannot mint a new session from an expired token** and never reaches the email/password step. Facebook then redirects through a one-time login-redirect interstitial (`https://www.facebook.com/?crypted_string=...&next=...`). `classifyLoginScreen()` sees no `/login` in the URL and a `[role="main"]` element, so it returns `home_feed` and reports `fb_login_success` — a **false positive**. The connector immediately re-navigates to the group, gets bounced back to `/login` (`auth_expired`), disables the account, and alerts the admin.

Net effect: a fully-recoverable expiry (valid credentials, no checkpoint, no 2FA) burns the single per-run login attempt on a no-op "Continue as" click, then permanently disables the account until a manual D1 cursor reset + cookie refresh. The auto-login feature delivers ~none of its promised self-healing for this path.

Observed in production (GitHub Actions, account `"1"`):
```
fb_fetch_error ... auth_expired
fb_login_attempt
fb_login_step step:0 state:continue_as_user url:.../login/?next=...groups/...
fb_login_step step:1 state:home_feed url:https://www.facebook.com/?crypted_string=...|...&next=...groups/...
fb_login_success step:1
fb_fetch_error ... auth_expired        # group nav fails immediately after "success"
fb_account_disabled accountId:1 errorType:auth_expired
```

## Goals

- [ ] **Eliminate false `fb_login_success`**: the login-redirect interstitial (`crypted_string`, unresolved `next=`) MUST NOT be classified as a logged-in home feed.
- [ ] **Reach the credential step on expired sessions**: when reactive login runs (session already known-expired), the flow MUST proceed to enter `FB_EMAIL_N`/`FB_PASSWORD_N` rather than dead-ending on the "Continue as" shortcut.
- [ ] **Self-heal the common case**: with valid credentials and no checkpoint/2FA/captcha, a session expiry recovers within ≤1 cron tick (≤30 min) without manual D1 reset or cookie refresh.
- [ ] **No regression** to existing budget/one-attempt-per-run guards, kill switch (`FB_AUTO_LOGIN_ENABLED`), or warm-session reuse. All current Facebook tests still pass.

## Out of Scope

- Captcha / checkpoint / 2FA solving — unchanged fallback to admin alert + manual recovery.
- Proactive/scheduled re-login (still reactive only).
- Auto-updating `FB_COOKIES_N` GitHub Secrets.
- Changing the one-attempt-per-run cap or the disable-on-genuine-failure behavior (loop prevention from `facebook-auto-login` spec stays).
- Auto-clearing `disabledAccounts` from the persisted cursor (separate concern; manual reset still required for already-disabled accounts).

---

## User Stories

### P1: Don't trust the login-redirect interstitial as success ⭐ MVP

**User Story**: As the scraper operator, I want the login flow to recognize Facebook's `crypted_string` redirect interstitial as "still in progress, not logged in", so a transient redirect page is never mistaken for the home feed and reported as `fb_login_success`.

**Why P1**: This false positive is the direct cause of the wasted login attempt and subsequent account disable. Fixing it is the precondition for the credential step ever running.

**Acceptance Criteria**:

1. WHEN `classifyLoginScreen()` runs on a URL containing a login-redirect token (`crypted_string=`) THEN it SHALL NOT return `home_feed`, even if a `[role="main"]`/`[role="feed"]` element is present and no email input exists.
2. WHEN the page is on a genuine logged-in home/feed URL (no `crypted_string`, not `/login`, not `/checkpoint/`, feed/main present, no email input) THEN it SHALL still return `home_feed` (no regression to the happy path).
3. WHEN `attemptLogin()` encounters the interstitial mid-flow THEN it SHALL wait for the redirect to settle (existing `networkidle`/navigation wait) and re-classify on the next step rather than terminating with success.
4. WHEN the interstitial never resolves into a recognizable state within the step/time budget THEN `attemptLogin()` SHALL return `{ success: false, reason: 'unknown_login_page' }` (accurate failure, not false success).

**Independent Test**: Unit test `classifyLoginScreen` with `url = https://www.facebook.com/?crypted_string=ABC&next=...` + `[role="main"]` present asserts result is **not** `home_feed`. Existing `home_feed` happy-path test (`HOME_URL` + feed) still returns `home_feed`.

---

### P2: Force credential login when the saved-session shortcut can't help

**User Story**: As the operator, when auto-login runs because the session is already expired, I want it to actually type my email + password instead of clicking "Continue as <Name>" (which depends on the very session that just died), so a real new session is minted.

**Why P2**: Even with P1 fixing the false success, we must ensure the flow lands on the credential form. Clicking "Continue as" with a dead token is the wrong move in the reactive-login context and risks looping through interstitials.

**Acceptance Criteria**:

1. WHEN the login flow is in `continue_as_user` state during a reactive login THEN it SHALL attempt to progress toward the credential form (e.g., prefer an explicit credential/“log into another account” path, or treat a post-continue interstitial as non-terminal) such that, given a visible `full_login`/`password_only` form, the flow fills `FB_EMAIL_N`/`FB_PASSWORD_N`.
2. WHEN a credential login completes and Facebook lands on a genuinely logged-in feed THEN `attemptLogin()` SHALL return `{ success: true }` and the connector SHALL resume scraping with the fresh session.
3. WHEN credentials are rejected THEN `attemptLogin()` SHALL return `{ success: false, reason: 'invalid_credentials' }` (unchanged downstream alerting).
4. WHEN no credential form is reachable (only the chooser is ever shown and it loops) THEN the flow SHALL terminate as `unknown_login_page` within the step budget — no infinite loop.

**Independent Test**: Drive `attemptLogin` against a scripted `Page` mock whose `classifyLoginScreen` sequence is `continue_as_user → <interstitial/non-terminal> → full_login → home_feed`; assert email + password inputs were filled and the outcome is `{ success: true }`.

---

### P3: Reject the false-positive `home_feed` after the interstitial settles ⭐ ADDENDUM (2026-06-08)

**User Story**: As the operator, when the `crypted_string` redirect lands on the *logged-out* `facebook.com/` (because the saved-session click could not authenticate a server-revoked session), I want the classifier to refuse to call that page `home_feed` so the flow falls through to credentials instead of reporting a fake success.

**Why P3 (and not P1)**: P1 only kept us from accepting `home_feed` *while* the URL still carried `crypted_string`. The 2026-06-07 production run showed a deeper variant of the same bug: by the time the URL settled to `https://www.facebook.com/`, the page was the logged-out marketing splash, but its server-rendered `[role="main"]` shell + the React-hydration delay on the inline login form satisfied the existing `home_feed` heuristic (no `/login` URL, has `feedRoot`, no email input *yet*). `attemptLogin` returned `success: true`; the next group nav redirected to `/login` and the account was disabled.

```
fb_fetch_error ... auth_expired
fb_login_step step:0 state:continue_as_user url:.../login/?next=...groups/305724686290054...
fb_login_step step:1 state:redirecting     url:.../?crypted_string=...&next=...
fb_login_step step:2 state:home_feed       url:https://www.facebook.com/        # FALSE POSITIVE
fb_login_success step:2
fb_fetch_error ... auth_expired                                                  # group still bounces to /login
fb_account_disabled accountId:1
```

**Acceptance Criteria**:

1. WHEN `classifyLoginScreen()` evaluates `home_feed` THEN it SHALL require BOTH a feed/main shell (`feedRoot`) AND a logged-in chrome signal (`SELECTORS.loggedInChrome` — top-bar Facebook search input / notifications button / banner-Home link, in en + he) AND the absence of *both* `input[name="email"]` and `input[name="pass"]`. Any one of those three failing demotes the page to a later priority.
2. WHEN the post-redirect page is the logged-out homepage with email/pass fields visible THEN classification SHALL return `full_login` (or `password_only`) and the existing handler SHALL fill `FB_EMAIL_N`/`FB_PASSWORD_N` for a real login.
3. WHEN the post-redirect page is the logged-out homepage with `feedRoot` present but neither logged-in chrome nor login form yet hydrated THEN classification SHALL return `unknown` (transient) and `attemptLogin` SHALL force the credential form (see P4) rather than time out.
4. WHEN the page is a *genuinely* logged-in feed (logged-in chrome present, no login inputs) THEN classification SHALL still return `home_feed` and `attemptLogin` SHALL succeed (no regression to the happy path).

**Independent Test**: `classifyLoginScreen` with `url = HOME_URL`, `[role="main"]` present, no `loggedInChrome`, no email/pass → returns `unknown` (not `home_feed`). Same URL with `loggedInChrome` present and no inputs → `home_feed`.

---

### P4: Force credentials when the saved-session click ends ambiguously ⭐ ADDENDUM (2026-06-08)

**User Story**: As the operator, when "Continue as <user>" lands on a page that is neither the real feed nor the inline login form, I want `attemptLogin` to navigate to a clean credential URL so the existing email+password handler runs instead of dead-ending in `unknown_login_page`.

**Why P4**: P2 promised that, given a visible `full_login`/`password_only` form, credentials would be filled. But Facebook's saved-session UI never exposes that form — clicking "Continue as <user>" on a revoked session bounces through `crypted_string` and lands on `facebook.com/` *without* `/login` in the URL, so subsequent classifications never reach the credential branch on their own. Without a deterministic recovery, the run terminates as `unknown_login_page` even with valid credentials.

**Acceptance Criteria**:

1. WHEN `attemptLogin`'s loop encounters `state === 'unknown'` AND the previous-iteration state was `continue_as_user` or `redirecting` THEN it SHALL `goto` `https://www.facebook.com/login/?login_attempt=1&lwv=110` (clean credential URL — bypasses the saved-session UI), `waitForLoadState('networkidle')`, and `continue` the loop.
2. WHEN the recovery navigation is followed by a classification of `full_login` or `password_only` THEN the existing handler SHALL fill credentials and ultimately reach `home_feed` for a `{ success: true }` outcome.
3. WHEN the recovery is taken THEN a single `fb_saved_session_invalidated` event SHALL be logged with `{ step, url }` so the operator can grep for the recovery path in production logs.
4. WHEN the recovery is taken but the resulting page is still ambiguous (no credential form, no logged-in chrome) on the next iteration THEN the existing no-progress / step-budget guards SHALL bail with `unknown_login_page` (no infinite loop).

**Independent Test**: Drive `attemptLogin` against a scripted `Page` mock with sequence `continue_as_user → unknown(HOME_URL, feedRoot only) → full_login → home_feed(loggedInChrome)`; assert `fb_saved_session_invalidated` is emitted, both email + password are filled, and the outcome is `{ success: true }`.

---

### P5: Production fingerprint diagnostics ⭐ ADDENDUM (2026-06-08)

**User Story**: As the operator, when the next login regression happens in production, I want enough structured data in logs to diagnose page-level signals (selectors visible, cookies present) without re-instrumenting and re-deploying.

**Why P5**: The 2026-06-07 incident was diagnosable only because we already knew the FB DOM shape. Future false-positive regressions (DOM changes, new interstitial variants, partial-auth states) need observable evidence at every login step.

**Acceptance Criteria**:

1. WHEN `attemptLogin` classifies a state at any step THEN it SHALL emit a `fb_page_fingerprint` event with `{ phase: 'login_step', step, state, fingerprint }`. The `fingerprint` object SHALL contain: `url`, `title`, presence flags (`hasFeed`, `hasMain`, `hasBanner`, `hasEmailInput`, `hasPasswordInput`, `hasSearchBar`, `hasNotifications`, `hasContinueAsUser`, `hasLoginAnotherAccountLink`), `htmlLen`, `cookieNames`, `hasCUserCookie`, `hasXsCookie`, `buttonLabels` (aria-labels of every `[role="button"]`, capped at 30 entries × 80 chars), and `inputAttrs` (per-input static attributes — `name`, `ariaLabel`, `placeholder`, `type` — capped at 12 entries × 80-char strings; element `.value` is *never* read, so typed passwords cannot enter the log).
2. WHEN `fetchGroupWithLoginRecovery` retries the group navigation after a successful `attemptLogin` AND that retry throws `auth_expired`/`banned` THEN it SHALL emit `fb_auth_expired_after_login` with the same fingerprint plus `{ accountId, groupId, errorType }` — the smoking-gun signal that login claimed success but the session was not real.
3. WHEN the fingerprint helper fails (page closed, evaluate throws) THEN the diagnostic SHALL swallow the error silently — diagnostics MUST NEVER break a run.
4. WHEN any fingerprint event is emitted THEN it SHALL contain cookie *names* only — never values. Passwords/cookies remain unloggable (existing invariant).

**Independent Test**: Run the new `attemptLogin` saved-session test and assert `fb_page_fingerprint` is logged at every step; assert no captured log line contains the test password or the literal string of any cookie value.

---

### P6: Reject false-positive `continue_as_user` from SSO buttons & recover from no-progress ⭐ ADDENDUM (2026-06-10)

**User Story**: As the operator, when the *fully* logged-out `/login` page is served (no `c_user`/`xs` cookies — `FB_COOKIES_N` is stale or expired), I want classification to refuse to call the page `continue_as_user` based on adjacent SSO buttons (`Continue with Google`, `Continue with Apple`), and — if the classifier ever does land on `continue_as_user` and the click fails to advance the page — `attemptLogin` to force the credential URL on the *first* repeat instead of bailing as `unknown_login_page`.

**Why P6 (and not P1/P2/P3/P4)**: The 2026-06-10 production run showed a deeper regression than P3/P4 ever covered:

```
fb_login_step step:0 state:continue_as_user url:.../login/?next=...
fb_page_fingerprint hasContinueAsUser:false hasEmailInput:false hasPasswordInput:false
                    hasCUserCookie:false hasXsCookie:false cookieNames:[datr,dpr,fr,ps_l,ps_n,sb,wd]
fb_login_step step:1 state:continue_as_user url:.../login/?next=...   # SAME state, SAME URL
fb_page_fingerprint hasContinueAsUser:false ...                        # smoking gun
fb_login_failed reason:unknown_login_page step:1 detail:no_progress
fb_account_disabled
```

Two compounding bugs:

1. **Classifier-fingerprint disagreement**: `classifyLoginScreen` returned `continue_as_user`, but the diagnostic probe for `a[href*="login_redirect"]` returned `false`. The cause: the old `continueAsLocators` matched the accessible name with a permissive `^(?:Continue|המשך|...)\b\s+\S+` regex via `getByRole('button', { name: CONTINUE_RE })`. That regex matched `Continue with Google` / `Continue with Apple` (the SSO buttons FB renders alongside the email+pass form on the logged-out splash). Diagnostics, scoped to the saved-session anchor only, correctly reported no continue button — proving the classifier was firing on an SSO false positive.
2. **Recovery never engaged**: P4's recovery only triggers from `unknown` after `continue_as_user`/`redirecting`. Here the classifier kept saying `continue_as_user` after each (no-op) click, so the no-progress guard bailed before any recovery branch could run.

**Acceptance Criteria**:

1. WHEN `classifyLoginScreen` evaluates `continue_as_user` THEN it SHALL match ONLY (a) `div[role="button"][aria-label^="Continue as" i]` (and locale equivalents — `המשך בתור`, `המשך כ`, `Continuar como`, `Continuer en tant que`, `Weiter als`), or (b) `a[href*="login_redirect"]`. The broad accessible-name regex (`Continue\b\s+\S+`) and the `div[role="button"]` + `span:hasText("Continue")` chain SHALL be removed — they matched SSO buttons.
2. WHEN the page presents SSO buttons such as "Continue with Google" / "Continue with Apple" but no real saved-session button THEN classification SHALL NOT return `continue_as_user`. Combined with no email/pass hydrated and no logged-in chrome → `unknown` (P4 then engages on the next iteration).
3. WHEN `attemptLogin`'s loop sees `state === 'continue_as_user'` AND `prevState === 'continue_as_user'` AND the new one-shot `didForceCredentialRecovery` flag is unset THEN it SHALL `goto(FORCE_CREDENTIAL_LOGIN_URL)`, `waitForLoadState('networkidle')`, set the flag, and `continue` — placing this branch BEFORE the no-progress guard so the recovery fires instead of the bail.
4. WHEN the recovery is taken THEN `fb_saved_session_invalidated` SHALL be logged with `{ step, url, detail: 'no_progress_on_continue_as_user' }` so the recovery cause is greppable in production logs.
5. WHEN the recovery itself returns to `continue_as_user` (the credential URL bounced back) THEN the one-shot flag SHALL prevent a second recovery attempt and the existing no-progress guard SHALL bail with `unknown_login_page` on the next iteration — no loop.
6. WHEN `classifyLoginScreen`'s `continue_as_user` selectors and `pageFingerprint`'s `hasContinueAsUser` probe disagree THEN it SHALL be considered a regression — the two MUST share the same selector definition (the fingerprint already uses `a[href*="login_redirect"]`; the classifier now matches the same anchor plus the aria-label set, so a missing `hasContinueAsUser` and a `state === 'continue_as_user'` cannot both appear in the same step's logs).

**Independent Test**:

- `classifyLoginScreen`: with `continueButtonHits: 0` (no aria-label match, no login_redirect href) on `LOGIN_URL`, return `unknown` (regression guard for SSO false positive).
- `attemptLogin`: scripted sequence `continue_as_user(LOGIN_URL) → continue_as_user(LOGIN_URL) → full_login → home_feed(loggedInChrome)` ⇒ `fb_saved_session_invalidated` emitted with `detail:'no_progress_on_continue_as_user'`, both email + password filled, outcome `{ success: true }`.
- `attemptLogin`: `continue_as_user × 4` (recovery lands back on continue_as_user) ⇒ `{ success: false, reason: 'unknown_login_page' }` (one-shot flag + no-progress bail).

---

### P7: Recover from first-iteration `unknown` on a `/login` URL (AYMH chooser & friends) ⭐ ADDENDUM (2026-06-11)

**User Story**: As the operator, when Facebook serves a saved-session UI variant we don't recognize (e.g. the AYMH multi-profile chooser) on a `/login/?next=...` URL and the classifier correctly returns `unknown` because no actionable selector matches, I want `attemptLogin` to force-navigate to the credential URL on the *first* iteration instead of bailing immediately as `unknown_login_page`.

**Why P7**: The 2026-06-10 P6 fix correctly stopped classifying SSO buttons as `continue_as_user`. The 2026-06-11 production log confirmed P6 works — classifier returned `unknown` on the AYMH chooser page rather than a false-positive `continue_as_user`. But the recovery branch (added in P4, refined in P6) only fired when `previousIterationState ∈ {continue_as_user, redirecting}`. On the first iteration `previousIterationState` is `null`, so AYMH-style variants bail with no recovery attempt:

```
fb_login_step step:0 state:unknown url:/login/?next=...groups/...
fb_page_fingerprint hasContinueAsUser:false hasEmailInput:false
                    hasCUserCookie:false hasXsCookie:false
                    buttonLabels:["Remove profiles from this browser",
                                  "Continue אורי לאל",
                                  "Use another profile"]
                    inputAttrs:[12 hidden form fields, no email/pass]
fb_login_failed reason:unknown_login_page step:0     # bailed before any recovery
fb_account_disabled
```

The P5 buttonLabels + inputAttrs additions made this incident diagnosable from a single log line — `Continue <Name>` (no `as` connector) plus 12 hidden inputs is the unambiguous AYMH signature.

**Acceptance Criteria**:

1. WHEN `attemptLogin`'s loop encounters `state === 'unknown'` AND the page URL contains `/login\b` AND the one-shot `didForceCredentialRecovery` flag is unset THEN it SHALL set the flag, log `fb_saved_session_invalidated` with `detail: 'unknown_on_login_url'`, `goto(FORCE_CREDENTIAL_LOGIN_URL)`, `waitForLoadState('networkidle')`, and `continue` — placing this branch at the same point as the existing P4 `unknown`-after-saved-session recovery (they share the flag).
2. WHEN the recovery is taken from a prior `continue_as_user`/`redirecting` state THEN the log line SHALL carry `detail: 'unknown_after_saved_session'` (preserved P4 behaviour, just renamed for symmetry).
3. WHEN `state === 'unknown'` on a *non-`/login`* URL AND no prior `continue_as_user`/`redirecting` was seen THEN the loop SHALL fall through to the existing `unknown_login_page` bail (no over-eager recovery).
4. WHEN the recovery fires AND the next iteration classifies the credential form THEN the existing `full_login`/`password_only` handler SHALL fill credentials and reach `home_feed` for `{ success: true }`.
5. WHEN the recovery fires AND the next iteration is also `unknown` THEN the one-shot flag SHALL prevent a second recovery attempt and the existing no-progress guard SHALL bail with `unknown_login_page`.

**Independent Test**:

- `attemptLogin`: scripted sequence `unknown(LOGIN_URL) → full_login(LOGIN_URL) → home_feed(loggedInChrome)` ⇒ `fb_saved_session_invalidated` emitted with `detail:'unknown_on_login_url'`, both email + password filled, outcome `{ success: true }`.
- `attemptLogin`: `unknown` on `https://www.facebook.com/somewhere/` ⇒ `{ success: false, reason: 'unknown_login_page' }` AND `fb_saved_session_invalidated` is NOT emitted (defense against blanket recovery on arbitrary URLs).

---

## Edge Cases

- WHEN the session is only *soft*-expired and "Continue as" genuinely revives it (lands on a verified feed with no `crypted_string`) THEN that SHALL still count as success (don't force a needless password entry if a real feed is reached).
- WHEN the interstitial appears and then resolves to `/checkpoint/` THEN classification SHALL return `checkpoint` (unchanged) and the flow SHALL fail with `checkpoint`, not `unknown_login_page`.
- WHEN the no-progress guard (`prevState === state` twice) would fire on repeated interstitials THEN it SHALL still bail with `unknown_login_page` (no loop).
- WHEN P1+P2 produce a genuine success but the subsequent group navigation still fails (`auth_expired`) THEN the existing one-attempt-per-run cap holds: disable + alert, no re-login loop (unchanged from `facebook-auto-login`). The retry MUST emit `fb_auth_expired_after_login` (P5) so the failure mode is observable.
- WHEN `FB_COOKIES_N` secret is stale but `FB_PASSWORD_N` is valid THEN successive runs SHALL self-heal: re-seed stale cookies → reactive login now reaches credentials → fresh session persisted in `.browser-profiles`.
- WHEN the post-redirect page is `facebook.com/` with `[role="main"]` but neither logged-in chrome nor an email input has hydrated yet THEN classification SHALL return `unknown` (P3) and the saved-session recovery (P4) SHALL force the credential URL — the no-progress guard remains the upper bound on iterations.
- WHEN `FB_AUTO_LOGIN_ENABLED=false` OR credentials are absent THEN P3/P4 SHALL still apply at the classification level (no false-positive `home_feed`), and the existing gate SHALL surface `fb_login_skip{_no_credentials}` as before — the recovery navigation runs only inside `attemptLogin`, which only runs when the gate allows it.
- WHEN the logged-out `/login` page renders SSO buttons (`Continue with Google`, `Continue with Apple`) alongside the email+pass form THEN classification SHALL NOT return `continue_as_user` (P6) — only an `aria-label^="Continue as"` button or an `a[href*="login_redirect"]` anchor counts as a saved-session entry.
- WHEN `c_user`/`xs` cookies are both absent AND `continue_as_user` repeats with no progress THEN P6's force-credential recovery SHALL fire on the first repeat (before the no-progress bail) and the one-shot flag SHALL bound subsequent recovery attempts to one — a second `continue_as_user` repeat hits the normal no-progress guard.

---

## Success Criteria

- [ ] No `fb_login_success` is emitted while the page URL still contains `crypted_string=`.
- [ ] No `fb_login_success` is emitted on a page that has `[role="main"]` but neither a logged-in chrome signal nor any login input (P3 — closes the 2026-06-07 regression).
- [ ] In a controlled reproduction (expired `xs`, valid credentials, no checkpoint), a single run produces `fb_login_attempt → … → fb_login_success` followed by a successful group fetch (not `fb_account_disabled`). The recovery path emits `fb_saved_session_invalidated` exactly when "Continue as <user>" was the entry point (P4).
- [ ] Account `"1"` self-heals across ≤1 cron tick after expiry without manual D1 `disabledAccounts` reset (for the no-checkpoint case).
- [ ] All existing Facebook connector tests pass; new unit tests cover the interstitial rejection (P1), the continue→credential progression (P2), the tightened `home_feed` (P3), the saved-session recovery (P4), and the credential-leak guard for the new fingerprint events (P5).
- [ ] Every login step emits `fb_page_fingerprint` (P5#1); every auth_expired-after-login retry emits `fb_auth_expired_after_login` (P5#2). Both events are present in production logs after deploy.
- [ ] Passwords/cookies never logged (unchanged invariant) — fingerprint includes cookie *names* only.
- [ ] No `state:"continue_as_user"` log line appears on a step whose fingerprint reports `hasContinueAsUser:false` (P6 — closes the 2026-06-10 SSO false-positive regression). Classifier and fingerprint share the same saved-session selector definition.
- [ ] When `continue_as_user` repeats with no progress, the next log line is `fb_saved_session_invalidated detail:no_progress_on_continue_as_user` (the P6 force-credential recovery), not `fb_login_failed reason:unknown_login_page detail:no_progress`.
