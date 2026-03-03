# Facebook Playwright Migration - Specification

## Problem Statement

The current Facebook connector uses raw `fetch()` calls with manually exported browser cookies. Facebook detects this non-browser behavior (no JS execution, no DOM interaction, no navigation patterns) and aggressively invalidates sessions — cookies expire every few hours, requiring manual refresh of `FB_COOKIES_N` GitHub secrets.

This is not scalable: the admin must re-export cookies from Chrome DevTools multiple times per day.

## Goals

- [ ] Replace raw `fetch()` HTTP calls with Playwright headless browser for Facebook interactions
- [ ] Extend cookie/session lifetime from hours to weeks (browser fingerprint keeps sessions alive)
- [ ] Eliminate manual `fb_dtsg`/`lsd` token extraction (browser handles CSRF natively)
- [ ] Eliminate `FB_DOC_ID` dependency (scrape rendered DOM instead of replaying GraphQL)
- [ ] Maintain existing connector architecture (parser, state management, circuit breaker)
- [ ] Keep GitHub Actions as the runtime (Playwright runs on ubuntu-latest)

## Out of Scope

- Fully automated login (user still provides initial cookies or credentials)
- CAPTCHA solving
- Facebook Marketplace scraping
- Persistent browser profiles across GitHub Actions runs (stateless per run)
- Changing the collection schedule (remains every 30 minutes)

---

## User Stories

### P1: Long-lived sessions

**User Story**: As an admin, I want Facebook sessions to last weeks instead of hours, so I don't have to refresh cookies multiple times per day.

**Acceptance Criteria**:
- Playwright launches a real Chromium browser with the provided cookies
- Facebook sees legitimate browser behavior (JS engine, WebGL, DOM interaction)
- Sessions survive for 2+ weeks without manual intervention
- Cookie expiry notifications still work when sessions do eventually expire

### P2: No manual token management

**User Story**: As an admin, I want to stop manually extracting `fb_dtsg`, `lsd`, and `doc_id` tokens, so the system is fully self-maintaining.

**Acceptance Criteria**:
- Playwright navigates to the group page and reads rendered content directly
- No need for `FB_DOC_ID`, `FB_DTSG`, or `FB_LSD` environment variables
- Only `FB_COOKIES_N` (or username/password) required as secrets

### P3: Same data quality

**User Story**: As a user, I want to continue receiving the same rental notifications from Facebook groups, with no regression in data quality.

**Acceptance Criteria**:
- Same fields extracted: post text, author, timestamp, permalink, image URL
- Same deduplication via `knownPostIds`
- Same filter matching and notification flow downstream

---

## Approach

### Strategy: DOM scraping via Playwright

Instead of replaying Facebook's internal GraphQL API (which requires manual token extraction and is fragile), use Playwright to:

1. Launch headless Chromium with injected cookies
2. Navigate to each group's page (`https://www.facebook.com/groups/{groupId}?sorting_setting=CHRONOLOGICAL`)
3. Wait for feed posts to render in the DOM
4. Extract post data from rendered HTML using Playwright selectors
5. Return the same `FacebookPost[]` structure the parser currently produces

### Why this is the only viable approach

All non-browser approaches have been tested and confirmed blocked by Facebook:

1. **Raw `fetch()` to GraphQL API** (current approach) — works but sessions expire every few hours because Facebook detects non-browser behavior patterns (no JS execution, no DOM interaction).
2. **`moda20/facebook-scraper` Python library** (tested 2026-03-03) — uses `requests-html` against `m.facebook.com`. Facebook 301-redirects all `m.facebook.com/groups/*` requests to `www.facebook.com` and serves an "unsupported browser" interstitial. Tested with: raw cookie strings, Chrome cookie jar via `browser_cookie3`, `noscript` cookie mode, multiple user agents (Safari, Chrome). All return 0 posts.
3. **`mbasic.facebook.com`** (tested 2026-03-02, AD-018) — same "unsupported browser" block for all non-browser HTTP clients.

The fundamental issue is server-side: Facebook detects raw HTTP clients and blocks them regardless of cookies, headers, or user agent. A real browser engine is required.

### Why Playwright works

- Facebook sees a real Chromium browser with proper JS execution, WebGL, etc.
- Cookies are injected into the browser context — Facebook validates them in a real session
- No need to reverse-engineer GraphQL mutations, CSRF tokens, or NDJSON formats
- The browser handles all token refresh, cookie rotation, and session management internally

### Trade-offs

| Aspect | Current (fetch) | Playwright |
|--------|-----------------|------------|
| Session lifetime | Hours | Weeks |
| Manual tokens | `FB_DOC_ID` + fallback `FB_DTSG`/`FB_LSD` | None |
| Runtime overhead | ~2s per group | ~10-15s per group (browser startup + render) |
| CI resource usage | Minimal | Higher (Chromium download ~150MB cached) |
| Complexity | HTTP + regex token extraction | Browser automation + DOM selectors |
| Fragility | GraphQL `doc_id` changes, NDJSON format changes | DOM selector changes (more visible, easier to debug) |
| GitHub Actions timeout | Well within 5 min | May need 8-10 min timeout |

### What changes

| Component | Change |
|-----------|--------|
| `client.ts` | **Rewrite**: Replace `fetch()` calls with Playwright browser automation |
| `parser.ts` | **Rewrite**: Replace NDJSON parsing with DOM element extraction |
| `index.ts` | **Minor**: Remove token extraction logic, simplify to browser-based flow |
| `accounts.ts` | **Keep**: Cookie rotation still needed (inject different cookies per account) |
| `types.ts` | **Update**: Remove `FacebookGraphQLTokens`, simplify `FacebookConfig` |
| `constants.ts` | **Simplify**: Remove GraphQL-specific constants (`doc_id`, mutation names) |
| `collect-facebook.ts` | **Minor**: Remove `FB_DOC_ID`/`FB_DTSG`/`FB_LSD` references |
| `collect-facebook.yml` | **Update**: Add Playwright install step, remove token env vars, increase timeout |
| `packages/connectors/package.json` | **Update**: Add `playwright` dependency, remove `cheerio` |

### What stays the same

- `FacebookConnector` class structure and `Connector` interface
- `FacebookCursorState` and cursor-based deduplication
- Circuit breaker pattern
- Account rotation via `selectAccount()`
- Downstream: extraction, normalization, DB insertion, notifications
- Admin Telegram alerts on cookie expiry

### Runtime considerations

- **GitHub Actions**: Playwright has official support. Use `npx playwright install --with-deps chromium` in CI.
- **Browser startup**: ~3-5s cold start. Reuse a single browser instance across all groups in one run.
- **Memory**: Chromium uses ~200-300MB. GitHub Actions runners have 7GB RAM — well within limits.
- **Timeout**: Increase workflow timeout from 5 to 10 minutes to accommodate browser overhead.

### Cookie format change

Current: raw cookie string (`c_user=123; xs=abc; ...`)
New: Playwright expects an array of cookie objects:
```typescript
{ name: 'c_user', value: '123', domain: '.facebook.com', path: '/' }
```

The connector will parse the raw cookie string into Playwright's format automatically — no change to `FB_COOKIES_N` secret format.

---

## What the user needs to provide

1. **Facebook cookies** (`FB_COOKIES_1..N`) — same format as today, from Chrome DevTools
2. **Group IDs** — same static config in `constants.ts`
3. That's it — no more `FB_DOC_ID`, `FB_DTSG`, or `FB_LSD`
