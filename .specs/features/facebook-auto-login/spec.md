# Facebook Auto-Login Specification

## Problem Statement

Every few days/weeks Facebook invalidates the persisted browser session for one of the scraping accounts (driving `auth_expired` or `banned` errors in `detectAuthFailure()` at `packages/connectors/src/facebook/client.ts:180`). Today the workflow surfaces this via a Telegram admin alert and stops collecting from that account until the operator manually logs into Facebook on a personal device, exports the new cookie string, and updates the `FB_COOKIES_N` GitHub Secret. Lead time from breakage to recovery is hours-to-days, during which Facebook listings stop flowing through the pipeline.

We want the GitHub Actions Facebook collector to **recover sessions on its own** by performing a Playwright-driven login with credentials provided as GitHub Secrets, eliminating the manual cookie refresh for the common case (no captcha, no checkpoint).

## Goals

- [ ] **Reduce Facebook collection downtime to one cron tick** (≤30 min) for the no-checkpoint failure mode — the most common case.
- [ ] **Eliminate manual cookie copy-paste** as the default recovery path; keep it only as the escalation when auto-login itself fails (e.g., Facebook checkpoint).
- [ ] **No regression in session longevity**: warm sessions inside `.browser-profiles` must keep working unchanged; auto-login runs only when `auth_expired`/`banned` is detected.
- [ ] **No new attack surface for credential leakage**: passwords never logged, never written to disk outside the persistent profile, never committed to the repo.

## Out of Scope

- 2FA / TOTP / SMS / email-code handling (accounts are confirmed 2FA-free for v1; if Facebook later forces 2FA, that's a follow-up feature).
- Captcha solving (visual or audio). When Facebook serves a checkpoint or captcha, we fall back to today's behavior: admin Telegram alert + manual recovery.
- Proactive scheduled re-login (warm-up cron). Refresh is **reactive only** in v1.
- Auto-updating `FB_COOKIES_N` GitHub Secrets via API. Refreshed cookies live inside the cached `.browser-profiles` persistent context — no Secret writes.
- Failure-time debug artifact upload (was P3 in an earlier draft). Deferred until we observe `unknown_login_page` in the wild.
- New accounts onboarding flow (signup). Only re-authenticating existing accounts.
- Storing or rotating Facebook passwords inside the application database.
- Web UI / Telegram command for managing credentials.

---

## User Stories

### P1: Auto-recover an expired Facebook session ⭐ MVP

**User Story**: As the operator of the Rentifier scraper, I want the GitHub Actions workflow to automatically log back into Facebook with my username + password when the persisted cookie session expires, so that I don't have to manually copy fresh cookies into GitHub Secrets every time Facebook signs the bot out.

**Why P1**: This is the entire feature. Without this story the operator pain remains exactly as today.

**Acceptance Criteria**:

1. WHEN `FB_AUTO_LOGIN_ENABLED` is unset, empty, or `false` THEN the system SHALL skip the auto-login flow entirely and behave exactly like today (manual cookie recovery), regardless of whether `FB_EMAIL_N` / `FB_PASSWORD_N` are set. This is the kill switch for fast rollback if Facebook starts banning accounts.
2. WHEN `FB_AUTO_LOGIN_ENABLED=true` AND the collector detects `auth_expired` for account `N` during normal scraping THEN the system SHALL attempt a Playwright login flow using `FB_EMAIL_N` + `FB_PASSWORD_N` (or fall back to a single `FB_EMAIL` / `FB_PASSWORD` if account-scoped vars are unset and only one account is configured) before giving up on that account in the current run.
3. WHEN the login flow succeeds (post-login URL is a Facebook home/feed URL with no login form, no `/checkpoint/`, no `/login.php`) THEN the system SHALL continue scraping the remaining groups using the freshly authenticated context, and the next run SHALL re-use the persisted profile without logging in again.
4. WHEN the login flow fails for any reason (wrong credentials, checkpoint, captcha, layout change, navigation timeout) THEN the system SHALL behave **exactly like today**: skip account `N` for this run, send the existing admin Telegram alert tagged with the failure reason (`auth_failed_login` vs `checkpoint` vs `captcha`), and continue to the next account.
5. WHEN account `N` has no `FB_PASSWORD_N` (and no shared `FB_PASSWORD` fallback applies) THEN the system SHALL skip the auto-login step entirely and use today's manual-recovery path, with a single log line `event: fb_login_skip_no_credentials, accountId: N` so the operator can see why.
6. WHEN the login attempt has already been made once for account `N` in this workflow run THEN the system SHALL NOT retry login for that account in the same run (one attempt per run, per account; no retry storm).
7. WHEN the username/password are loaded from env THEN the system SHALL NEVER log them; redactable values must be referenced only by env-var name in any structured log.

**Independent Test**:
- Local: with `FB_EMAIL_1` / `FB_PASSWORD_1` set in `.env` and a deliberately invalidated `.browser-profiles/fb-account-1` (e.g., `rm -rf` it then plant only an obviously expired cookie), run `pnpm exec tsx scripts/collect-facebook.ts --local`. Verify a single `fb_login_attempt` → `fb_login_success` log pair, then normal `fb_navigate_group` events for each group, and posts inserted into D1.
- Negative: with a wrong password, verify `fb_login_attempt` → `fb_login_failed` (`reason: invalid_credentials`) → existing admin Telegram alert path triggers exactly once.

---

### P2: Surface auto-login outcomes in admin Telegram alerts and structured logs

**User Story**: As the operator, when something goes wrong with auto-login I want the Telegram alert and the GitHub Actions log to tell me **what** went wrong, so I know whether to update credentials, solve a checkpoint manually, or just wait.

**Why P2**: Without this, an auto-login that silently fails looks identical to a manual cookie-refresh-needed event, defeating part of the value of the feature.

**Acceptance Criteria**:

1. WHEN auto-login fails with detectable reason `invalid_credentials` THEN the admin Telegram message SHALL say "FB account #N: auto-login failed — credentials rejected. Update `FB_PASSWORD_N` (and `FB_EMAIL_N` if changed)."
2. WHEN auto-login fails with detectable reason `checkpoint` (URL contains `/checkpoint/`) THEN the admin Telegram message SHALL say "FB account #N: Facebook checkpoint blocking login. Resolve in a browser, then refresh `FB_COOKIES_N` manually as a one-time recovery."
3. WHEN auto-login fails with reason `captcha` (any captcha selector hit) or `unknown_login_page` (selectors didn't match) THEN the admin Telegram message SHALL include the reason and a one-line hint, but the system SHALL NOT dump page HTML or screenshots into the alert (privacy + Telegram size limits).
4. WHEN auto-login succeeds THEN the system SHALL emit a single structured log `event: fb_login_success, accountId: N` and SHALL NOT send a Telegram notification (success is silent — no operator action needed).

**Independent Test**: Run the workflow against a stub HTTP server that serves the canned Facebook responses for each failure mode (`/login` form, `/checkpoint/`, `/captcha`) and assert the exact alert text + log events.

---

---

## Edge Cases

- WHEN Facebook serves the login page in a non-English locale (e.g., Hebrew matching the userAgent's `locale: 'en-US'` is overridden by IP geo) THEN the system SHALL match login form fields by `name`/`id` (`email`, `pass`) rather than visible label text, so locale changes don't break recovery.
- WHEN `FB_EMAIL_N` is set but `FB_PASSWORD_N` is empty (or vice versa) THEN the system SHALL treat the account as having no credentials and follow AC #4 of P1 (skip + log).
- WHEN both account-scoped (`FB_EMAIL_1`) and shared (`FB_EMAIL`) vars are set THEN account-scoped wins; shared is the single-account fallback only.
- WHEN the persisted profile is corrupted (Playwright cannot launch the context) THEN the system SHALL `clearProfile(accountId)` (existing helper at `client.ts:136`) and treat the next launch as a fresh profile that will trigger auto-login on the first auth check.
- WHEN auto-login succeeds but the subsequent group navigation immediately re-detects `auth_expired` (Facebook signed us out again post-login) THEN the system SHALL NOT loop back into another login attempt — one attempt per run is the hard cap. It SHALL skip the account and alert.
- WHEN the GitHub Actions runner's IP is on a Facebook-flagged datacenter range and login is blocked at the network layer (the page never loads) THEN the system SHALL surface this as `network` error, not `auth_failed_login`, so the operator knows it's not a credential problem.
- WHEN multiple accounts are configured and account #1 succeeds but account #2 hits a checkpoint THEN account #1's collection MUST proceed normally; account #2's failure SHALL NOT abort the workflow.

---

## Success Criteria

How we know the feature is successful:

- [ ] **Recovery time**: from the moment a Facebook session is invalidated, posts resume flowing within ≤30 minutes (one cron tick) for ≥80% of expirations observed over a 4-week window.
- [ ] **Manual interventions**: count of "operator copies cookies into GitHub Secrets" events drops by ≥80% over a 4-week window vs the prior 4 weeks.
- [ ] **No new ban incidents**: no observed account ban (`/checkpoint/` redirect on first navigation post-login) attributable to the auto-login flow during the first 4 weeks. If bans appear, the feature is rolled back behind a feature flag (`FB_AUTO_LOGIN_ENABLED`).
- [ ] **Zero credentials in logs**: a `git grep` of GitHub Actions log archives for the configured email/password returns zero hits.
- [ ] **No regressions**: existing 313+ tests still pass; all new code paths covered by unit tests for credential-loading, login-flow branching, and the per-run "one attempt" guard.
