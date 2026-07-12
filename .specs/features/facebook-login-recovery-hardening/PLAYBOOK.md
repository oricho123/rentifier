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

- `FORCE_CREDENTIAL_LOGIN_URL` **alone** does NOT bypass AYMH — device cookies re-pin the profile on the redirect.
- `useAnotherProfile` does NOT bypass AYMH — clicking it just submits the AYMH form with `aymh_profile_loaded_count+1` and FB re-serves AYMH (disproved 2026-06-21, P10).
- `removeProfilesFromBrowser` (single click OR two-step with in-dialog confirm) does NOT reliably bypass AYMH either. P12 (2026-06-28) correctly identified that clicking the page button opens a `[role="dialog"]` confirmation modal (`"Close"` in `buttonLabels`, htmlLen +51KB), but the in-dialog primary CTA turned out to be a **native `<button>`** — invisible in our fingerprint's `[role="button"]`-only query, so our selector had no target. Disproved 2026-06-28b, P13. The fingerprint now queries `button, [role="button"]` so future dialog CTAs surface.
- **AYMH escape that works (P13, current)**: `page.context().clearCookies({ name })` per name in `AYMH_DEVICE_COOKIE_NAMES` (`datr`, `sb`, `fr`, `dpr`, `wd`, `ps_l`, `ps_n`) → `page.goto(FORCE_CREDENTIAL_LOGIN_URL)`. Cuts out the UI entirely — no click chain, no dialog, no locale variance. One-shot flag `didAymhCookieClear` guards against loops if FB re-issues cookies from server session state.
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
- **Silent green cron ticks when accounts get disabled.** Pre-P11, `collect-facebook.ts` only exited non-zero on `connector.fetchNew()` throws; with AYMH-flow failures the connector returned `{ candidates: [], nextCursor }` cleanly so `process.exit(1)` never ran. Telegram fired but GitHub Actions stayed green and the incident was invisible in run history. P11 adds a post-`collect_complete` check: if `newlyDisabledCount > 0` (one or more accounts newly disabled this tick vs. the previous cursor), log `collect_failed_newly_disabled_accounts` and `process.exit(1)`. Crucially the check is *transition-based*, not state-based — subsequent ticks of the same already-disabled set stay green, so the workflow doesn't get stuck red forever until the operator resets the cursor. One disable event ⇒ one red tick ⇒ quiet until the next signal.
- **Iterating on the click chain when the underlying mechanism is knowable.** P8→P10→P12 all tried to escape AYMH by clicking a different visible button (`Use another profile` → `Remove profiles` single → `Remove profiles` two-step). Each variant produced a different failure and consumed an incident cycle. P13 sidestepped the whole UI by clearing the device-pinning cookies that *cause* AYMH in the first place. Lesson: when three click-based approaches to the same variant have failed, the click chain is not the answer — find the state that FB is reading (cookies, `localStorage`, header) and manipulate that directly. Applies whenever the UI is a rendering of server-side state you can inspect and reset.
- **Fingerprint queries that shadow their target.** The P12 attempt failed silently because `buttonLabels` used `document.querySelectorAll('[role="button"]')` — this matches only elements with an *explicit* `role="button"` attribute, NOT native `<button>` elements (whose ARIA role is implicit). FB's modal confirm CTA was a native `<button>`, so it never appeared in the fingerprint we relied on to diagnose the dialog. When adding a fingerprint probe, verify it captures ALL variants of what it claims to cover — `button, [role="button"]` for buttons, `input, [role="textbox"]` for inputs, etc.
