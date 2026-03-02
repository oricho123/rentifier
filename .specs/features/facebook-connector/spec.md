# Facebook Groups Connector (GraphQL) - Specification

## Problem Statement

Facebook Groups are a primary channel for Israeli rental listings — many landlords post there instead of Yad2 because it's free. Currently, Rentifier only monitors Yad2, missing a significant portion of the market. There is no official API for accessing Facebook group posts (the Groups API was shut down April 2024).

The initial approach using `mbasic.facebook.com` with plain HTTP requests is blocked — Facebook now serves an "unsupported browser" interstitial page for all non-browser HTTP clients regardless of User-Agent.

## Goals

- [ ] Fetch new posts from statically configured Facebook groups every ~30 minutes
- [ ] Extract structured rental data (price, rooms, city) from unstructured Hebrew posts
- [ ] Support multiple Facebook account cookies for rotation
- [ ] Notify admin via Telegram when cookies expire
- [ ] Integrate with existing connector architecture (same pattern as YAD2)

## Out of Scope

- Facebook Marketplace
- Browser automation / Playwright
- Dynamic group configuration via DB (static list for now)
- Historical post backfill
- Pagination (fetch first page only per run)

---

## User Stories

### P1: Facebook group monitoring

**User Story**: As a user, I want to receive Telegram notifications for rental listings posted in Facebook groups, so I can find apartments not listed on Yad2.

**Acceptance Criteria**:
- Posts from configured Facebook groups are fetched every 30 minutes
- Hebrew post text is parsed to extract price, rooms, city, neighborhood
- Listings pass through the same filter matching as YAD2 listings
- Dedup prevents duplicate notifications for the same post

### P2: Cookie expiry notification

**User Story**: As an admin, I want to be notified via Telegram when a Facebook cookie expires, so I can refresh it quickly.

**Acceptance Criteria**:
- When a cookie fails auth, admin receives a Telegram message
- Message identifies which account needs refreshing
- No spam — one notification per failed account per run

---

## Approach

Use Facebook's internal GraphQL API (`POST /api/graphql/`) with cookie-based authentication. This is the same API that Facebook's own frontend JavaScript calls when a user browses a group. It returns structured NDJSON data (Relay incremental delivery), bypasses browser detection, and is more reliable than scraping HTML.

### Key discovery: jazoest checksum

The GraphQL API requires a `jazoest` CSRF checksum in every request, computed as:
```
jazoest = "2" + sum(charCodeAt(i) for each char in fb_dtsg)
```
Without it, Facebook rejects the request with error 1357054 even with valid `fb_dtsg`.

### How it works

1. User exports cookies from Chrome DevTools (one-time, lasts 30–90 days)
2. User extracts `doc_id` from DevTools Network tab (one-time, lasts weeks–months)
3. On each run, connector extracts fresh `fb_dtsg`/`lsd` from homepage HTML (automatic)
4. Connector computes `jazoest` and replays the GraphQL request with fresh tokens

### Trade-offs

- **`doc_id` stability**: Internal query IDs can change when Facebook deploys. More stable than HTML selectors but still requires monitoring.
- **Cookie auth**: 30–90 day expiry. Admin notification on expiry.
- **Token extraction**: `fb_dtsg`/`lsd` auto-extracted from homepage HTML on each run. Adds ~1–2s latency but eliminates manual refresh.
- **NDJSON response**: Facebook uses Relay incremental delivery — response is newline-delimited JSON, not a single object.
- **ToS**: Violates Facebook ToS — use secondary accounts only.

### What the user needs to provide

1. Facebook cookies (`FB_COOKIES_1..N`) — from Chrome DevTools, refresh every 30–90 days
2. The `doc_id` for the group feed query (`FB_DOC_ID`) — one-time extraction from DevTools Network tab
3. The group IDs to monitor — configured in `constants.ts`
