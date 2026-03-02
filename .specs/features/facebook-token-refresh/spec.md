# Facebook Token Auto-Refresh - Specification

## Problem Statement

The Facebook GraphQL connector requires `fb_dtsg` and `lsd` CSRF tokens for every API request. These tokens are session-tied and expire within 24–48 hours. Currently they're stored as GitHub Secrets (`FB_DTSG`, `FB_LSD`), requiring manual refresh every 1–2 days — impractical for a 30-minute cron job.

The `doc_id` is stable (weeks–months) and cookies last 30–90 days, so those are fine as secrets. Only `fb_dtsg`/`lsd` need dynamic refresh.

## Goals

- [x] Auto-extract `fb_dtsg` and `lsd` from `www.facebook.com` homepage on each collection run
- [x] Remove `FB_DTSG` and `FB_LSD` from required env vars / GitHub Secrets
- [x] Fail gracefully with structured logging if token extraction fails
- [x] Notify admin via Telegram if token extraction fails repeatedly

## Out of Scope

- Refreshing cookies (still 30–90 day manual process)
- Refreshing `doc_id` (stable, manual)
- Caching tokens between runs (each run extracts fresh)
- Browser automation / Playwright

---

## User Stories

### P1: Automated token extraction

**User Story**: As an admin, I want the Facebook collector to automatically obtain fresh CSRF tokens on each run, so I don't need to manually update secrets every 1–2 days.

**Acceptance Criteria**:
- Collection script fetches `www.facebook.com` with account cookies before making GraphQL requests
- `fb_dtsg` extracted from page source via known patterns (`DTSGInitData`, `dtsg.token`, form input)
- `lsd` extracted from page source via known patterns (`LSD`, form input)
- `jazoest` computed from the fresh `fb_dtsg`
- GraphQL request uses the freshly extracted tokens
- `FB_DTSG` and `FB_LSD` env vars become optional (used as fallback if extraction fails)

### P2: Extraction failure handling

**User Story**: As an admin, I want to be notified if token extraction starts failing, so I can investigate before data collection stops.

**Acceptance Criteria**:
- If homepage fetch fails or returns no tokens, error is logged with structured JSON
- Fallback to env var tokens if available
- If both extraction and env fallback fail, admin receives Telegram notification
- Error type distinguishes: network failure, login redirect (cookies expired), parse failure (pattern changed)

---

## Approach

### How fb_dtsg extraction works

Facebook embeds CSRF tokens in every page load. When you fetch `www.facebook.com` with valid cookies, the HTML contains the tokens in several locations:

```
Pattern 1: "DTSGInitData".*?"token":"([^"]+)"
Pattern 2: name="fb_dtsg" value="([^"]+)"
Pattern 3: "dtsg":\{"token":"([^"]+)"
```

The `lsd` token appears as:
```
Pattern 1: "LSD".*?\[.*?"(\w+)"\]
Pattern 2: name="lsd" value="([^"]+)"
```

This is the same approach used in `scripts/debug-facebook-graphql.ts` (`fetchFreshTokens()`) which has been tested and confirmed working.

### Token lifecycle per run

```
1. Select account (cookies) via round-robin
2. GET www.facebook.com with cookies → extract fb_dtsg + lsd
3. Compute jazoest from fresh fb_dtsg
4. POST /api/graphql/ with fresh tokens
```

### Trade-offs

- **Extra HTTP request per run**: One GET to homepage (~500KB) before the GraphQL call. Adds ~1–2s latency. Acceptable for a 30-min cron.
- **Pattern fragility**: Facebook could change where tokens appear in HTML. Mitigated by trying 3 patterns for each token and logging canary on failure.
- **No caching**: Extracts fresh tokens every run. Could cache in cursor state, but tokens are cheap to extract and caching adds staleness risk.

### What the user needs to provide

1. Facebook cookies (`FB_COOKIES_1..N`) — same as before
2. `FB_DOC_ID` — same as before
3. ~~`FB_DTSG`~~ — no longer required (auto-extracted)
4. ~~`FB_LSD`~~ — no longer required (auto-extracted)

---

## Error Scenarios

| Scenario | Detection | Response |
|----------|-----------|----------|
| Homepage returns login page | HTML contains `id="login_form"` | Treat as `auth_expired` — cookies are dead |
| Homepage returns checkpoint | HTML contains `checkpoint` + `verify` | Treat as `banned` |
| Homepage returns HTML but no tokens | Regex patterns find nothing | Log `fb_token_extraction_failed`, fall back to env vars |
| Homepage network error | fetch throws | Log error, fall back to env vars |
| Env var fallback also missing | No FB_DTSG in env | Log `fb_no_tokens_available`, skip run, notify admin |
