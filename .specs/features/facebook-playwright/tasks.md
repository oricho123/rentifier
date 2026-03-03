# Facebook Playwright Migration - Tasks

**Spec**: `spec.md` | **Design**: `design.md`

---

## Phase 1: Foundation (no behavior change)

### Task 1.1: Add Playwright dependency

**What**: Add `playwright` to `@rentifier/connectors` package, remove unused `cheerio`.

**Files**:
- `packages/connectors/package.json` — add `playwright`, remove `cheerio`
- Root `pnpm-lock.yaml` — updated by pnpm install

**Steps**:
1. `cd packages/connectors && pnpm add playwright`
2. `cd packages/connectors && pnpm remove cheerio`
3. Verify `pnpm install` succeeds at root
4. Verify `pnpm typecheck` still passes

**Verification**: `pnpm install && pnpm typecheck` — zero errors.

---

### Task 1.2: Create `selectors.ts` with DOM selectors

**What**: Create a new file with centralized Facebook DOM selectors. These will be finalized during Task 2.2 by inspecting actual rendered DOM.

**Files**:
- `packages/connectors/src/facebook/selectors.ts` — new file

**Steps**:
1. Create file with initial selector constants (best guesses from known Facebook patterns)
2. Export as `FB_SELECTORS` object
3. Add comment noting selectors need validation against real DOM

**Verification**: File compiles, `pnpm typecheck` passes.

---

### Task 1.3: Add `parseCookieString()` to `accounts.ts`

**What**: Add function to convert raw cookie string (`c_user=123; xs=abc`) to Playwright's `Cookie[]` format.

**Files**:
- `packages/connectors/src/facebook/accounts.ts` — add `parseCookieString()`
- New or existing test file — unit tests for the parser

**Steps**:
1. Add `parseCookieString()` function
2. Write 4-5 unit tests: basic parsing, multiple cookies, values with `=`, empty string, whitespace handling

**Verification**: Tests pass. Function correctly parses cookie strings from `FB_COOKIES_N` format.

---

### Task 1.4: Add `parseRelativeTime()` utility

**What**: Parse Facebook's relative time strings ("2h", "3d", "Yesterday at 10:30", "Just now") into ISO timestamps.

**Files**:
- `packages/connectors/src/facebook/parser.ts` or new `time-utils.ts`
- Test file — unit tests

**Steps**:
1. Implement `parseRelativeTime(text: string): string | null`
2. Handle: "Xm" (minutes), "Xh" (hours), "Xd" (days), "Yesterday", "Just now", absolute dates
3. Write 8-10 unit tests covering each pattern

**Verification**: Tests pass for all known Facebook time formats.

---

## Phase 2: Playwright client implementation

### Task 2.1: Implement browser lifecycle functions

**What**: Create browser launch, cookie injection, and cleanup functions.

**Files**:
- `packages/connectors/src/facebook/browser.ts` — new file (separates browser concern from client logic)

**Functions**:
- `launchBrowser(): Promise<Browser>` — launch headless Chromium
- `createContext(browser: Browser, cookies: string): Promise<{ context: BrowserContext, page: Page }>` — create context with cookies
- `closeBrowser(browser: Browser): Promise<void>` — cleanup
- `detectAuthFailure(page: Page): Promise<FacebookErrorType | null>` — check for login/checkpoint

**Steps**:
1. Implement each function
2. Use `parseCookieString()` from Task 1.3
3. Handle browser launch failures gracefully

**Verification**: Manual test — launch browser, inject test cookies, navigate to facebook.com, close browser without leaks.

---

### Task 2.2: Implement DOM post extraction

**What**: Navigate to a group page and extract posts from the rendered DOM. **This is the most critical task** — selectors must match Facebook's actual DOM structure.

**Files**:
- `packages/connectors/src/facebook/client.ts` — rewrite with Playwright functions
- `packages/connectors/src/facebook/selectors.ts` — finalize selectors based on real DOM

**Functions**:
- `navigateToGroup(page: Page, groupId: string): Promise<void>` — navigate and wait for feed
- `extractPostsFromDOM(page: Page, groupId: string): Promise<FacebookPost[]>` — scrape all visible posts

**Steps**:
1. Open Facebook group in a real browser, inspect DOM to identify correct selectors
2. Update `selectors.ts` with validated selectors
3. Implement `navigateToGroup()` with URL + wait for feed selector
4. Implement `extractPostsFromDOM()` iterating over post elements
5. Extract: text, author, timestamp (→ `parseRelativeTime`), permalink, image URL, post ID
6. Return same `FacebookPost[]` interface as current parser

**Verification**: Manual test with real cookies — extract posts from one group, compare with current GraphQL output. Same post IDs and content.

---

### Task 2.3: Implement retry wrapper for Playwright

**What**: Wrap page navigation/extraction with retry logic for transient failures (timeouts, page crashes).

**Files**:
- `packages/connectors/src/facebook/client.ts` — add retry wrapper

**Functions**:
- `fetchGroupWithRetry(page: Page, groupId: string, maxRetries: number): Promise<FacebookPost[]>`

**Steps**:
1. Implement retry with exponential backoff (reuse existing `MAX_RETRIES`, `INITIAL_RETRY_DELAY_MS`)
2. On timeout: retry
3. On auth failure: throw non-retryable error
4. On other errors: retry if retryable

**Verification**: Unit test with mocked page that fails once then succeeds.

---

## Phase 3: Integration

### Task 3.1: Update `FacebookConnector` to use Playwright

**What**: Rewire `index.ts` to use the new Playwright-based client instead of fetch-based client.

**Files**:
- `packages/connectors/src/facebook/index.ts` — update `fetchNew()` method

**Changes**:
1. Remove token extraction block (no more `extractTokensFromHomepage` + fallback)
2. Remove `setSortingChronological()` call (URL param handles it)
3. Add browser launch at start of `fetchNew()`
4. Add browser close in `finally` block
5. Replace `fetchWithRetry()` + `parseGraphQLResponse()` with Playwright extraction
6. Keep: cursor state, circuit breaker, account rotation, dedup, error handling

**Verification**: `pnpm typecheck` passes. Unit tests with mocked browser pass.

---

### Task 3.2: Update types and constants

**What**: Clean up types and constants that are no longer needed.

**Files**:
- `packages/connectors/src/facebook/types.ts` — remove `FacebookGraphQLTokens`, simplify `FacebookConfig`
- `packages/connectors/src/facebook/constants.ts` — remove GraphQL constants, add browser constants
- `packages/connectors/src/facebook/accounts.ts` — remove `getDocId()`, `getGraphQLTokens()`

**Steps**:
1. Remove `FacebookGraphQLTokens` interface
2. Simplify `FacebookConfig` to just `cookies: Record<string, string>`
3. Remove GraphQL-specific constants
4. Add `BROWSER_TIMEOUT_MS`, `FEED_WAIT_TIMEOUT_MS`, `GROUP_URL_TEMPLATE`
5. Remove `getDocId()` and `getGraphQLTokens()` from accounts
6. Update connector exports if needed

**Verification**: `pnpm typecheck` — zero errors. All imports resolve.

---

### Task 3.3: Remove old fetch-based code

**What**: Delete the old `fetch()`-based functions from `client.ts` that are no longer called.

**Files**:
- `packages/connectors/src/facebook/client.ts` — remove old functions
- `packages/connectors/src/facebook/parser.ts` — remove NDJSON parser

**Remove**:
- `extractTokensFromHomepage()`
- `setSortingChronological()`
- `fetchGroupGraphQL()`
- `fetchWithRetry()` (old version)
- `computeJazoest()`
- `extractCUser()`
- `parseGraphQLResponse()` from parser.ts

**Verification**: `pnpm typecheck` — zero errors. No dead code.

---

### Task 3.4: Update tests

**What**: Rewrite tests for the new Playwright-based client. Mock Playwright `Page`/`Browser` objects.

**Files**:
- `packages/connectors/src/facebook/__tests__/client.test.ts` — rewrite
- `packages/connectors/src/facebook/__tests__/parser.test.ts` — rewrite or remove
- `packages/connectors/src/facebook/__tests__/connector.test.ts` — update mocks

**Steps**:
1. Create HTML fixture files representing Facebook's rendered DOM
2. Mock `playwright.Page` with fixture HTML for `page.$()`, `page.$$()`, `page.evaluate()`
3. Test `extractPostsFromDOM()` with fixture HTML → correct `FacebookPost[]`
4. Test `detectAuthFailure()` with login page / checkpoint page mocks
5. Test `parseCookieString()` (from Task 1.3)
6. Test `parseRelativeTime()` (from Task 1.4)
7. Update connector integration tests to mock browser instead of fetch

**Verification**: `pnpm test` — all tests pass. Coverage similar to current (~25 Facebook tests).

---

## Phase 4: CI & Deployment

### Task 4.1: Update GitHub Actions workflow

**What**: Add Playwright browser installation step and remove obsolete env vars.

**Files**:
- `.github/workflows/collect-facebook.yml`

**Changes**:
1. Add step: `pnpm exec playwright install --with-deps chromium`
2. Remove env vars: `FB_DOC_ID`, `FB_DTSG`, `FB_LSD`
3. Increase `timeout-minutes` from 5 to 10
4. Consider caching Playwright browsers for faster CI

**Verification**: Manually trigger workflow — `workflow_dispatch`. Verify it installs Playwright and runs successfully.

---

### Task 4.2: Update collection script

**What**: Simplify `scripts/collect-facebook.ts` — remove token-related references.

**Files**:
- `scripts/collect-facebook.ts` — update JSDoc comments, remove token references

**Changes**:
1. Update JSDoc: remove `FB_DOC_ID`, `FB_DTSG`, `FB_LSD` from required/optional env vars
2. Everything else stays the same (the connector handles browser internally)

**Verification**: `pnpm collect:facebook` runs locally with real cookies.

---

### Task 4.3: Manual E2E validation

**What**: Run the full pipeline with real cookies and compare output.

**Steps**:
1. Run current (fetch-based) collector, note the posts fetched
2. Run new (Playwright-based) collector with same cookies
3. Compare: same group coverage, similar post count, same post IDs for overlapping posts
4. Verify: posts appear in DB, get processed, notifications sent
5. Run 3-5 times over a day to confirm session stability

**Verification**: Same posts extracted. No false auth failures. Session survives multiple runs.

---

## Phase 5: Cleanup

### Task 5.1: Update specs and docs

**What**: Update project state, roadmap, and feature docs.

**Files**:
- `.specs/project/STATE.md` — add decision AD-020
- `.specs/project/ROADMAP.md` — mark Playwright migration complete
- `.specs/features/facebook-connector/spec.md` — update "Out of Scope" (remove Playwright exclusion)

**Verification**: Docs accurate and consistent.

---

## Dependency Graph

```
1.1 (playwright dep) ──┐
1.2 (selectors)     ───┤
1.3 (cookie parser) ───┼──▶ 2.1 (browser lifecycle) ──┐
1.4 (time parser)   ───┘                               │
                        2.2 (DOM extraction) ───────────┤
                        2.3 (retry wrapper) ────────────┤
                                                        ▼
                                                  3.1 (connector integration) ──┐
                                                  3.2 (types cleanup) ──────────┤
                                                                                ▼
                                                                          3.3 (remove old code)
                                                                          3.4 (tests) ──┐
                                                                                         ▼
                                                                                   4.1 (CI workflow)
                                                                                   4.2 (script update)
                                                                                   4.3 (E2E validation)
                                                                                         ▼
                                                                                   5.1 (docs)
```

## Risk Flags

1. **DOM selectors are the biggest risk** — Facebook changes class names frequently. Selectors based on `role`, `data-*`, and semantic attributes are more stable than class-based ones. Task 2.2 requires real DOM inspection.
2. **Playwright in GitHub Actions** — well-supported but adds ~1 min to CI for browser install. Browser caching helps.
3. **Session stability claim** — "weeks instead of hours" is based on industry experience with Playwright + Facebook, not tested yet. Task 4.3 validates this.
4. **Headless detection** — Facebook may detect headless Chromium via WebDriver flag. Playwright's default `chromium` channel should avoid this, but may need `channel: 'chrome'` for extra stealth.
