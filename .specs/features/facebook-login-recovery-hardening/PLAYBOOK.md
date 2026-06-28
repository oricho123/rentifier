# Facebook Login Recovery — Incident Playbook

When a `fb_account_disabled` shows up in production logs, follow this flow.
The goal is to converge in one PR, not iterate through three.

Sibling docs:

- [`spec.md`](./spec.md) — user stories P1–P9, acceptance criteria.
- [`design.md`](./design.md) — addenda per P, **FB Login UI Variants Catalog**, and the **Recovery Escape Paths** matrix. **Read these first on every incident.**
- [`tasks.md`](./tasks.md) — task ledger.

---

## Triage flow

### 1. Read the fingerprint **before** writing code

Every `fb_login_step` is followed by an `fb_page_fingerprint` event. It already exposes:

- `url`, `title`, `htmlLen` (delta between steps tells you whether the page re-rendered).
- Selector presence: `hasFeed`, `hasMain`, `hasEmailInput`, `hasPasswordInput`, `hasContinueAsUser`, `hasLoginAnotherAccountLink`, `hasSearchBar`, `hasNotifications`.
- `cookieNames` + `hasCUserCookie` / `hasXsCookie` (cookie *names* only — values never logged).
- `buttonLabels`: visible button text/aria-label, capped to 30.
- `inputAttrs`: `name` / `ariaLabel` / `placeholder` / `type` for visible inputs (capped to 12, **never `.value`** — that's where the typed password sits).

**Do not add more logging.** Every variant we've seen so far has been diagnosable from these fields. If you think you need more, you almost certainly need to read the existing fingerprint more carefully.

### 2. Match the fingerprint against the UI Variants Catalog in `design.md`

The catalog lists every UI shape we've identified, its distinguishing fingerprint, and which handler/escape applies. The matching mental model:

- Buttons named `Continue as <Name>` (with `as` connector) → `continue_as_user` (P6).
- Buttons named `Continue <Name>` (no `as` connector) + hidden `aymh_profile_loaded_count` field → `aymh_chooser` (P8).
- URL contains `crypted_string` → `redirecting` (P1/P2).
- `[role="main"]` only, no `loggedInChrome` → bare logged-out splash → `unknown` (P3).
- Visible `email` + `pass` inputs → `full_login` (P9 typing cadence applies).
- Anything else → potentially **a new variant** — see step 3.

### 3. If the fingerprint doesn't match any catalog entry — it's a new variant

Add a **typed `LoginScreenState`** + a **dedicated handler**, not yet another `unknown` recovery branch.

The lesson from P7→P8: extending the catch-all `unknown` recovery is cheap *until* the new variant breaks the existing escape's premise. AYMH broke `FORCE_CREDENTIAL_LOGIN_URL`'s "universal escape" assumption, and the only way out was a typed state + targeted click. **When we know the shape, type it.**

When adding a variant:

- Detection selector should be **locale-stable** — prefer hidden form field names (`aymh_profile_loaded_count`) or `aria-label` exact-match over Continue-style regexes (which caused the P6 SSO false-positive).
- Classifier priority: above `unknown`, below the simpler/cheaper escapes (e.g., `aymh_chooser` is below `continue_as_user` because clicking "Continue as" is one step, AYMH escape is two).
- Handler: best-effort click; if the escape selector is missing (`count === 0`), skip the click and let the existing no-progress guard bail. **Never loop.**

### 4. Pick the right escape — consult the Recovery Escape Paths matrix

The matrix in `design.md` says which escape bypasses which variant. Some highlights:

- `FORCE_CREDENTIAL_LOGIN_URL` does **NOT** bypass AYMH (device cookies pin the profile).
- `useAnotherProfile` does **NOT** bypass AYMH either — clicking it just submits the AYMH form with `aymh_profile_loaded_count+1` and FB re-serves AYMH (disproved 2026-06-21, P10).
- `removeProfilesFromBrowser` is a **TWO-STEP** flow, not one click (disproved 2026-06-28, P12). The page button opens a `[role="dialog"]` confirmation modal; the actual fingerprint clear requires a second click on the in-dialog CTA (same aria-label, scoped to `[role="dialog"]` so we don't race the occluded page button). Signal that distinguishes single-click from two-step: a `"Close"` button appearing in `buttonLabels` between steps + htmlLen jumping >10KB. The handler sequences both clicks in one invocation with `HUMAN_PAUSE_BEFORE_SUBMIT_MS` between them.
- Clicking a saved-session button on a fully-revoked session is a no-op — P6 falls back to URL nav after a same-state repeat.
- `pressSequentially` (P9) is the credential-entry path, not `fill()` — FB fingerprints instant text insertion.

Don't compose escapes that the matrix shows are incompatible. When in doubt, add a row to the matrix as part of your fix.

---

## Test patterns

Every fix lands with at least:

- **Classifier test** — a positive case that detects the new variant.
- **Classifier priority test** — a defensive case proving the new state loses to a simpler/cheaper one when both are present.
- **Attempt success test** — full scripted sequence ending in `home_feed` with the right click/typing observable on the mock.
- **Attempt defense test** — the new state appearing twice with no progress (e.g., escape button missing, or rejected silently) ends in `unknown_login_page`, not an infinite loop.

Mocks live in `__tests__/login-classify.test.ts` and `__tests__/login-attempt.test.ts`. The scripted-page helper in the latter accepts `steps: Array<{ url, selectors, continueHits }>` and advances on click/goto/waitForURL — extend the mock minimally; never reach inside production code.

---

## Standing PR pattern

- One incident → one fresh branch off latest `main`. Branch name: `fix/fb-<short-description>`.
- Update `spec.md` (new user story P_n_), `design.md` (addendum + catalog/matrix entries), `tasks.md` (task ledger entry T_n_).
- Commit message follows existing pattern: `fix(facebook): <short summary>`, body explains root cause + signal that diagnosed it.
- Push + open PR with body containing the failure trace this fixes and a concrete test plan.
- **Do not merge.** The user merges or the user explicitly asks. The standing pattern is incident → fix → PR → wait.
- Pre-commit gates: `gitleaks` clean, `pnpm typecheck` clean, `pnpm test` green, ESLint clean on changed files (108 pre-existing errors elsewhere are out of scope).

---

## Security invariants (must never break)

These are non-negotiable. A fix that violates one of these is wrong even if the test suite is green.

- Passwords and cookie *values* never logged. Cookie *names* only.
- `fb_page_fingerprint`'s `inputAttrs` reads `name` / `ariaLabel` / `placeholder` / `type` only — **never `.value`**.
- `.env` and `credentials.json` never committed.
- Pre-commit `gitleaks` clean on every commit.
- Diagnostic probes are timeout-guarded (`Promise.race` with 1.5s) and never throw to the caller.

---

## Anti-patterns (lessons we paid for)

- **Anchoring on existing tools.** P7 assumed `FORCE_CREDENTIAL_LOGIN_URL` was a universal escape because it had worked twice. AYMH disproved that. **Verify the assumption against the current fingerprint before reusing the tool.**
- **Loose regexes for selectors.** P6 removed `^Continue\b\s+\S+` because it matched SSO buttons. Don't reintroduce it. Prefer `aria-label` exact / prefix match, or hidden form field names.
- **Adding more logging instead of reading what's there.** If a fingerprint field already names the escape hatch (`buttonLabels:["Use another profile",…]`), the answer is in the log. More logging won't help — pattern recognition will.
- **Per-variant `unknown` recovery branches.** P4/P6/P7 share one `didForceCredentialRecovery` flag for a reason: at most one force-credential per `attemptLogin` call regardless of trigger path. New recovery branches must respect that one-shot semantics or add their own.
- **DOM dumps in fingerprints.** Considered and rejected: 535KB × N steps overflows GH Actions logs, and post/group text in user-content would leak. The structured fingerprint already exposes every signal we've needed.
- **Retry loops on `full_login` no-progress.** Looks like a fix, actually a lockout vector — silent rejection is indistinguishable from a wrong-credentials brute-force from FB's side. Fix the input fingerprint first (P9), revisit only if insufficient.
- **Silent green cron ticks when accounts get disabled.** Pre-P11, `collect-facebook.ts` only exited non-zero on `connector.fetchNew()` throws; with AYMH-flow failures the connector returned `{ candidates: [], nextCursor }` cleanly so `process.exit(1)` never ran. Telegram fired but GitHub Actions stayed green and the incident was invisible in run history. P11 adds a post-`collect_complete` check: if `disabledAccounts.length === getAccounts().length`, log `collect_failed_all_accounts_disabled` and `process.exit(1)`. Per-account notifications aren't enough — the workflow run history needs to surface the failure too.
