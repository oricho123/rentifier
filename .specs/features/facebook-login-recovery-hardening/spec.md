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

## Edge Cases

- WHEN the session is only *soft*-expired and "Continue as" genuinely revives it (lands on a verified feed with no `crypted_string`) THEN that SHALL still count as success (don't force a needless password entry if a real feed is reached).
- WHEN the interstitial appears and then resolves to `/checkpoint/` THEN classification SHALL return `checkpoint` (unchanged) and the flow SHALL fail with `checkpoint`, not `unknown_login_page`.
- WHEN the no-progress guard (`prevState === state` twice) would fire on repeated interstitials THEN it SHALL still bail with `unknown_login_page` (no loop).
- WHEN P1+P2 produce a genuine success but the subsequent group navigation still fails (`auth_expired`) THEN the existing one-attempt-per-run cap holds: disable + alert, no re-login loop (unchanged from `facebook-auto-login`).
- WHEN `FB_COOKIES_N` secret is stale but `FB_PASSWORD_N` is valid THEN successive runs SHALL self-heal: re-seed stale cookies → reactive login now reaches credentials → fresh session persisted in `.browser-profiles`.

---

## Success Criteria

- [ ] No `fb_login_success` is emitted while the page URL still contains `crypted_string=`.
- [ ] In a controlled reproduction (expired `xs`, valid credentials, no checkpoint), a single run produces `fb_login_attempt → … → fb_login_success` followed by a successful group fetch (not `fb_account_disabled`).
- [ ] Account `"1"` self-heals across ≤1 cron tick after expiry without manual D1 `disabledAccounts` reset (for the no-checkpoint case).
- [ ] All existing Facebook connector tests pass; new unit tests cover the interstitial rejection (P1) and the continue→credential progression (P2).
- [ ] Passwords/cookies never logged (unchanged invariant).
