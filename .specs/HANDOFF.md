# Handoff — Facebook Groups Connector (M4)

**Date:** 2026-03-02
**Branch:** `feat/facebook-connector`
**Status:** GraphQL connector with auto-token extraction implemented and E2E verified. Ready for merge.

---

## What Happened

### Approach 1: mbasic.facebook.com + HTTP (failed)

- Full implementation: HTTP client, Cheerio parser, account rotation, tests
- **Result:** Facebook returns "unsupported browser" interstitial for ALL User-Agents

### Approach 2: GraphQL API — initial attempt (failed)

- Extracted `doc_id`, request format, response structure from Chrome DevTools
- **Result:** Error 1357054 — missing `jazoest` CSRF checksum

### Approach 3: GraphQL API + jazoest (working)

- `jazoest = "2" + sum(charCodeAt(i) for each char in fb_dtsg)`
- **Response format:** NDJSON (newline-delimited JSON) via Relay incremental delivery
- Successfully fetched real posts from a live group

### Token Auto-Extraction (implemented)

- `fb_dtsg` and `lsd` are now auto-extracted from Facebook homepage HTML on each run
- Only `FB_COOKIES_N` and `FB_DOC_ID` are required as GitHub Secrets
- `FB_DTSG` and `FB_LSD` env vars kept as optional fallback
- Chronological sorting via `GroupsCometFeedSortingSwitcherMenuMutation` before feed query

---

## Current State

### Implemented (on branch)

| File | What |
|------|------|
| `constants.ts` | GraphQL URLs, headers, sorting mutation, homepage constants |
| `types.ts` | `FacebookGraphQLTokens`, post types |
| `client.ts` | GraphQL POST, token extraction from homepage, sorting mutation, retry |
| `parser.ts` | NDJSON parser with safe nested access |
| `accounts.ts` | `getDocId()` + `getGraphQLTokens()` (fallback) |
| `index.ts` | Connector with auto-extraction → env fallback flow |
| `client.test.ts` | 8 tests for token extraction (patterns, auth, checkpoint, errors) |
| `parser.test.ts` | 9 tests for GraphQL JSON parsing |
| `connector.test.ts` | 8 tests including token extraction fallback |
| `collect-facebook.yml` | FB_DTSG/FB_LSD marked as optional fallback |
| `collect-facebook.ts` | Updated env var docs, admin notifications |

**Verification:** 176 tests pass, 0 TypeScript errors, E2E token extraction confirmed.

### Key Implementation Details

- **Homepage fetch requires full browser headers:** `Sec-Fetch-Dest: document`, `Sec-Ch-Ua-*` — without these Facebook returns HTTP 400
- **Checkpoint false positive fix:** Normal pages contain "checkpoint" in JS code. Detection checks for `/checkpoint/block/` AND absence of `DTSGInitData`
- **Token extraction patterns:** 3 patterns for fb_dtsg (DTSGInitData, form input, dtsg.token), 2 for lsd (LSD array, form input)

---

## Required Secrets

| Secret | Required | Stability |
|--------|----------|-----------|
| `FB_COOKIES_N` | Yes | Weeks–months (browser session) |
| `FB_DOC_ID` | Yes | Weeks–months (Facebook deploys) |
| `FB_DTSG` | No (auto-extracted) | Fallback only |
| `FB_LSD` | No (auto-extracted) | Fallback only |

---

## Quick Resume

```bash
git checkout feat/facebook-connector
cat .specs/HANDOFF.md
```
