# Facebook Playwright Migration - Design

**Spec**: `.specs/features/facebook-playwright/spec.md`

---

## Architecture

```
GitHub Actions (cron: */30 * * * *)
  │
  ▼
scripts/collect-facebook.ts
  │
  ▼
FacebookConnector.fetchNew(cursor, db)
  ├── Account rotation (round-robin, unchanged)
  ├── launchBrowser(cookies)
  │     ├── playwright.chromium.launch({ headless: true })
  │     ├── context.addCookies(parseCookieString(cookies))
  │     └── Returns { browser, context, page }
  ├── For each group:
  │     ├── navigateToGroup(page, groupId)
  │     │     ├── page.goto(`facebook.com/groups/{groupId}?sorting_setting=CHRONOLOGICAL`)
  │     │     └── page.waitForSelector('[role="feed"]', { timeout: 15000 })
  │     ├── extractPostsFromDOM(page, groupId)
  │     │     ├── page.$$('[role="feed"] > div') — select feed items
  │     │     └── For each post element: extract text, author, time, link, image
  │     └── Dedup via knownPostIds (unchanged)
  ├── browser.close()
  └── Circuit breaker (unchanged)
  │
  ▼
FacebookConnector.normalize(candidate) — unchanged
  └── extractAll() from @rentifier/extraction
  │
  ▼
db.insertRawListings() via D1 REST API — unchanged
```

## File Changes

### `client.ts` → **Rewrite**

Replace all `fetch()`-based functions with Playwright browser automation.

**Remove:**
- `extractTokensFromHomepage()` — browser handles tokens natively
- `setSortingChronological()` — URL param `?sorting_setting=CHRONOLOGICAL` instead
- `fetchGroupGraphQL()` — replaced by DOM scraping
- `fetchWithRetry()` — Playwright has built-in retry/wait mechanisms
- `computeJazoest()` — no longer needed
- `extractCUser()` — no longer needed

**Add:**
- `parseCookieString(cookies: string): Cookie[]` — convert raw cookie string to Playwright format
- `createBrowserContext(cookies: string): Promise<BrowserContext>` — launch browser with cookies
- `navigateToGroup(page: Page, groupId: string): Promise<void>` — navigate and wait for feed
- `extractPostsFromDOM(page: Page, groupId: string): Promise<FacebookPost[]>` — scrape posts from rendered DOM
- `detectAuthFailure(page: Page): Promise<FacebookErrorType | null>` — check for login/checkpoint pages
- `closeBrowser(browser: Browser): Promise<void>` — cleanup

**Keep:**
- `FacebookClientError` class (unchanged)
- `FacebookErrorType` type (unchanged)

### New: `selectors.ts`

Centralize all DOM selectors for easy maintenance when Facebook changes its UI.

**Validated against live Facebook DOM (2026-03-03):**

```typescript
export const FB_SELECTORS = {
  // Feed container and post children
  feed: '[role="feed"]',
  feedPost: '[role="feed"] > div',  // skip index 0 (sorting widget)

  // Post content — Facebook uses data-ad-rendering-role attributes (stable)
  postContent: '[data-ad-rendering-role="story_message"]',
  postContentFallback: '[data-ad-preview="message"], [data-ad-comet-preview="message"]',
  postAuthor: '[data-ad-rendering-role="profile_name"] h2',
  postAuthorFallback: 'h3 a[role="link"], h4 a[role="link"]',

  // Post ID — extracted from pcb.{postId} in photo link hrefs
  // Text-only posts use content hash as fallback ID
  postPhotoLink: 'a[href*="pcb."]',  // photo links contain pcb.{postId}

  // Images — skip small ones (profile pics, icons)
  postImage: 'img[src*="scontent"], img[src*="fbcdn"]',

  // Auth failure detection
  loginForm: '#login_form, #loginform',
  checkpoint: '[href*="/checkpoint/"]',
} as const;
```

**Key findings from DOM validation:**
- `data-ad-rendering-role` attributes are Facebook's internal rendering hooks — more stable than class names
- Timestamps are NOT rendered in the feed DOM — they only appear on hover/interaction
- Post IDs come from photo links (`pcb.{postId}` pattern), not from direct post links
- The first `[role="feed"] > div` child is always the sorting widget, not a post
- Author names may have " · Follow" suffix that needs stripping

### `parser.ts` → **Rewrite**

Replace NDJSON parsing with a simpler DOM-extracted data normalizer.

**Remove:**
- `parseGraphQLResponse()` — NDJSON format no longer used
- All GraphQL-specific JSON traversal logic

**Add:**
- `parsePostElement(element: ElementHandle, groupId: string): Promise<FacebookPost | null>` — extract fields from a single DOM element
- `parseRelativeTime(text: string): string | null` — convert "2h ago", "Yesterday" to ISO timestamp

The function receives already-extracted DOM data and returns the same `FacebookPost` interface — downstream code unchanged.

### `index.ts` → **Simplify**

**Remove:**
- Token extraction block (`extractTokensFromHomepage` + `getGraphQLTokens` fallback)
- `tokens` variable threading through the group loop
- `setSortingChronological()` call (replaced by URL param)

**Add:**
- Browser lifecycle: launch once before group loop, close after
- Pass `page` to extraction functions instead of `cookies + tokens`

**Keep (unchanged):**
- `FacebookConnector` class structure
- `extractTitle()` helper
- Cursor state management
- Circuit breaker logic
- Account rotation via `selectAccount()`
- `normalize()` method

### `accounts.ts` → **Minor update**

Add cookie string → Playwright cookie array parser:

```typescript
export function parseCookieString(cookieStr: string): playwright.Cookie[] {
  return cookieStr.split(';').map(pair => {
    const [name, ...rest] = pair.trim().split('=');
    return {
      name: name.trim(),
      value: rest.join('=').trim(),
      domain: '.facebook.com',
      path: '/',
    };
  });
}
```

### `types.ts` → **Simplify**

**Remove:**
- `FacebookGraphQLTokens` — no longer needed
- `FacebookConfig.docId`, `.fbDtsg`, `.lsd` — no longer needed

**Keep:**
- `FacebookPost` (unchanged)
- `FacebookAccount` (unchanged)
- `FacebookCursorState` (unchanged)
- `FacebookConfig` (simplified: just `cookies`)

### `constants.ts` → **Simplify**

**Remove:**
- `GRAPHQL_API_URL`
- `GRAPHQL_HEADERS`
- `GRAPHQL_POST_COUNT`
- `GRAPHQL_QUERY_NAME`
- `HOMEPAGE_URL`, `HOMEPAGE_TIMEOUT_MS`
- `SORTING_MUTATION_DOC_ID`, `SORTING_MUTATION_NAME`

**Add:**
- `BROWSER_TIMEOUT_MS = 30_000` — page navigation timeout
- `FEED_WAIT_TIMEOUT_MS = 15_000` — wait for feed to render
- `GROUP_URL_TEMPLATE = 'https://www.facebook.com/groups/{groupId}?sorting_setting=CHRONOLOGICAL'`

**Keep:**
- `MONITORED_GROUPS`
- `MAX_CONSECUTIVE_FAILURES`, `CIRCUIT_OPEN_DURATION_MS`
- `MAX_RETRIES`, `INITIAL_RETRY_DELAY_MS`
- `REQUEST_TIMEOUT_MS`
- `MAX_KNOWN_POST_IDS`

### `collect-facebook.yml` → **Update**

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: pnpm/action-setup@v4
  - uses: actions/setup-node@v4
    with:
      node-version: '20'
      cache: 'pnpm'
  - name: Install dependencies
    run: pnpm install --frozen-lockfile
  - name: Install Playwright browsers
    run: pnpm exec playwright install --with-deps chromium
  - name: Run Facebook collector
    run: pnpm exec tsx scripts/collect-facebook.ts
    env:
      CF_ACCOUNT_ID: ${{ secrets.CF_ACCOUNT_ID }}
      CF_API_TOKEN: ${{ secrets.CF_API_TOKEN }}
      CF_D1_DATABASE_ID: ${{ secrets.CF_D1_DATABASE_ID }}
      FB_ACCOUNT_COUNT: ${{ secrets.FB_ACCOUNT_COUNT }}
      FB_COOKIES_1: ${{ secrets.FB_COOKIES_1 }}
      FB_COOKIES_2: ${{ secrets.FB_COOKIES_2 }}
      # FB_DOC_ID, FB_DTSG, FB_LSD no longer needed
      TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
      TELEGRAM_ADMIN_CHAT_ID: ${{ secrets.TELEGRAM_ADMIN_CHAT_ID }}
```

Changes:
- Add `playwright install --with-deps chromium` step
- Remove `FB_DOC_ID`, `FB_DTSG`, `FB_LSD` env vars
- Increase `timeout-minutes` from 5 to 10

### `packages/connectors/package.json` → **Update**

```json
{
  "dependencies": {
    "@rentifier/core": "workspace:*",
    "@rentifier/db": "workspace:*",
    "@rentifier/extraction": "workspace:*",
    "playwright": "^1.50.0"
  }
}
```

Remove `cheerio` (was already unused after GraphQL rewrite).

---

## Auth Detection

Playwright makes auth detection simpler — check the page URL/content after navigation:

```typescript
async function detectAuthFailure(page: Page): Promise<FacebookErrorType | null> {
  const url = page.url();

  // Redirected to login page
  if (url.includes('/login') || url.includes('login.php')) {
    return 'auth_expired';
  }

  // Checkpoint/challenge page
  if (url.includes('/checkpoint/')) {
    return 'banned';
  }

  // Check page content as fallback
  const hasLoginForm = await page.$('#login_form, #loginform');
  if (hasLoginForm) {
    return 'auth_expired';
  }

  return null;
}
```

## Error Handling

| Scenario | Detection | Action |
|----------|-----------|--------|
| Cookies expired | Login page redirect | Disable account, notify admin |
| Account challenged | Checkpoint redirect | Disable account, notify admin |
| Page timeout | Playwright timeout exception | Retry (retryable) |
| Feed doesn't render | Selector timeout | Retry (retryable) |
| Browser crash | Playwright error | Retry (retryable) |
| Rate limit | No posts rendered + specific UI element | Circuit breaker |

## Post Extraction Strategy (Validated 2026-03-03)

Each post in Facebook's feed is a `div` inside `[role="feed"]`. The first child is always the sorting widget — skip it. For each subsequent post element:

1. **Post text**: `[data-ad-rendering-role="story_message"]` → textContent. Fallback: `[data-ad-preview="message"]`
2. **Author**: `[data-ad-rendering-role="profile_name"] h2` → textContent. Strip " · Follow" / " · עקוב" suffix
3. **Post ID**: Extract from photo links via `pcb.{postId}` regex on `href`. Fallback for text-only posts: generate hash from content + author
4. **Permalink**: Construct from groupId + postId: `https://www.facebook.com/groups/{groupId}/posts/{postId}/`
5. **Image**: `img[src*="scontent"]` — skip images with width < 100 (profile pics, icons)
6. **Timestamp**: NOT available in DOM (Facebook renders timestamps only on hover/interaction). Use `new Date().toISOString()` as fetch time — acceptable since cron runs every 30 minutes

**Extraction rates (tested on 3 groups, 9 posts):**
- Content: 9/9 (100%)
- Author: 9/9 (100%)
- Post ID: 7/9 (78% — text-only search posts lack photo links)
- Image: 6/9 (67% — text-only posts have no images, expected)

## Browser Lifecycle

```
One run = one browser instance:

1. Launch Chromium (headless)
2. Create context with cookies for selected account
3. For each group:
   a. Navigate to group page
   b. Wait for feed to render
   c. Extract posts from DOM
   d. (No page.close() — reuse same page)
4. Close browser

Total: ~3-5s browser startup + ~5-8s per group = ~20-30s for 3 groups
vs current: ~1-2s per group = ~5s for 3 groups
```

## Testing Strategy

- **Unit tests for `parseCookieString()`** — verify cookie string → Playwright format conversion
- **Unit tests for `parseRelativeTime()`** — verify time parsing
- **Unit tests for `detectAuthFailure()`** — mock page URL/content checks
- **Integration tests for `FacebookConnector`** — mock Playwright `Page` with fixture HTML
- **Manual e2e test** — run with real cookies locally
- **No Playwright browser in CI tests** — mock the browser layer, test extraction logic with HTML fixtures

## Alternative Approaches Evaluated

### `moda20/facebook-scraper` (Python) — REJECTED (2026-03-03)

Tested exhaustively as a potential drop-in replacement. The library uses `requests-html` against `m.facebook.com` (raw HTTP, no browser engine). Results:

- **Raw cookie string**: Facebook 301-redirects `m.facebook.com/groups/*` → `www.facebook.com/?_rdr`, serves "This browser isn't supported" interstitial. 0 posts.
- **Chrome cookie jar** (`browser_cookie3`): Same redirect and block. 0 posts.
- **`noscript` cookie mode**: Same result. 0 posts.
- **Modern User-Agent** (Chrome 131): Same result. 0 posts.
- **Safari User-Agent**: Same result (already used by library default). 0 posts.

Conclusion: Facebook blocks all raw HTTP clients from accessing group feeds on both `m.facebook.com` and `mbasic.facebook.com`. The block is server-side and cannot be bypassed with headers or cookies alone. A real browser engine (Playwright) is the only viable path.

### Raw `fetch()` to GraphQL API — CURRENT (works but fragile)

Works for data extraction but sessions expire every few hours due to Facebook's non-browser detection. Requires manual `FB_DOC_ID` extraction and frequent cookie refresh.

## Migration Path

1. Implement Playwright client alongside existing fetch client (feature flag)
2. Test locally with real cookies — verify same posts extracted
3. Compare output with current GraphQL approach for a few runs
4. Switch CI workflow to Playwright
5. Remove old `fetch()`-based code after confirming stability
