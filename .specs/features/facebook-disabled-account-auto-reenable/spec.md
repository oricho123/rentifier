# Facebook Disabled-Account Auto Re-Enable Specification

## Problem Statement

Once a Facebook account lands in `disabledAccounts` (after `auth_expired`/`banned`), `selectAccount()` filters it out forever. With a single account, that means all collection stops and the only recovery is a manual D1 cursor edit. Even after the operator does the natural fix — refreshing the `FB_COOKIES_N` GitHub secret — the account stays disabled because nothing re-evaluates it. The `facebook-login-recovery-hardening` feature can't help either: disabled accounts are dropped *before* any login attempt.

We want a disabled account to **un-stick itself when the operator provides fresh cookies**, using the cookie-secret change as the recovery signal — no manual DB edit.

## Goals

- [ ] **Self-unstick on cookie refresh**: when `FB_COOKIES_N` changes after account N was disabled, the account is automatically removed from `disabledAccounts` on the next run.
- [ ] **No hammering**: an account whose cookies are unchanged stays disabled (no retry storm, no ban risk) — the change is the only trigger.
- [ ] **Clear the circuit on operator intervention**: if re-enabling produces a usable account, the open circuit breaker is cleared so the fresh cookies get a chance in the same run.
- [ ] **No regression**: existing disable/circuit/auto-login behavior and all current tests unchanged when no cookie change is detected.

## Out of Scope

- Time-based / scheduled auto-retry of disabled accounts (no cookie change) — deliberately excluded to avoid hammering a genuinely dead/banned account.
- Auto-clearing `disabledAccounts` via password-only auto-login without a cookie change.
- Writing `FB_COOKIES_N` secrets from the app.

---

## User Stories

### P1: Re-enable a disabled account when its cookies change ⭐ MVP

**User Story**: As the operator, after I refresh `FB_COOKIES_N` for a disabled account, I want the collector to automatically retry that account on the next run, so I never have to hand-edit the D1 cursor.

**Why P1**: This is the whole feature — it removes the only remaining manual step in the common recovery path.

**Acceptance Criteria**:

1. WHEN account N is disabled THEN the system SHALL record a SHA-256 hash of the seed cookie string that was in effect at disable time, persisted in the cursor (`disabledCookieHashes[N]`).
2. WHEN, on a later run, the current `FB_COOKIES_N` hash differs from the recorded `disabledCookieHashes[N]` THEN the system SHALL remove N from `disabledAccounts`, drop its `disabledCookieHashes` entry, clear its `loginAttempts` budget, and emit `fb_account_reenabled` with `reason: cookies_changed`.
3. WHEN the current cookies hash equals the recorded hash THEN N SHALL remain disabled and no re-enable log is emitted.
4. WHEN re-enabling yields at least one usable account AND the circuit breaker is open THEN the system SHALL clear `circuitOpenUntil`/`consecutiveFailures` so collection proceeds this run.
5. WHEN a disabled account has no recorded hash (disabled before this feature shipped) THEN the system SHALL backfill the current hash and keep the account disabled (so the *next* cookie change is detectable) — i.e., it does not re-enable on the first run merely due to a missing baseline.

**Independent Test**: Given a cursor with `disabledAccounts:['1']` + `disabledCookieHashes:{'1': hash('old')}` and `getAccounts` returning cookies `'new'`, `fetchNew` removes `'1'` from `disabledAccounts`, logs `fb_account_reenabled`, and clears an open circuit. With cookies `'old'`, `'1'` stays disabled.

---

## Edge Cases

- WHEN the account was disabled for `banned` (checkpoint) THEN a cookie change still re-enables it (operator may have resolved the checkpoint and exported a fresh session); the next run re-evaluates auth normally.
- WHEN cookies change but the new session is also expired THEN normal flow re-disables it and records the *new* hash — no infinite loop (one disable per run, plus circuit breaker).
- WHEN the account id is absent from `getAccounts` (secret removed) THEN it stays disabled and its hash entry is preserved (cannot evaluate a change).
- WHEN multiple accounts are disabled THEN each is evaluated independently against its own recorded hash.

---

## Success Criteria

- [ ] After refreshing `FB_COOKIES_N`, a previously disabled account resumes within ≤1 cron tick with no manual D1 edit.
- [ ] An unchanged-cookie disabled account is never auto-retried (no `fb_account_reenabled`, no scrape attempt).
- [ ] All existing Facebook connector tests pass; new tests cover change/no-change/backfill/circuit-clear.
