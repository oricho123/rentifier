# Handoff — Facebook Groups Connector (M4)

**Date:** 2026-03-02
**Branch:** `feat/facebook-connector`
**Status:** GraphQL connector implemented and working. Next: auto-extract tokens.

---

## What Happened

### Approach 1: mbasic.facebook.com + HTTP (failed)

- Full implementation: HTTP client, Cheerio parser, account rotation, tests
- **Result:** Facebook returns "unsupported browser" interstitial for ALL User-Agents
- Server-side blocking — the HTML doesn't contain group posts regardless of headers

### Approach 2: GraphQL API — initial attempt (failed)

- Extracted `doc_id`, request format, response structure from Chrome DevTools
- Sent POST to `/api/graphql/` with `fb_dtsg` + `lsd` tokens
- **Result:** Error 1357054 — "There was a problem with this request"

### Approach 3: GraphQL API + jazoest (working)

- **Root cause of Approach 2 failure:** Missing `jazoest` CSRF checksum
- `jazoest = "2" + sum(charCodeAt(i) for each char in fb_dtsg)`
- Adding `jazoest` + `__comet_req=15` + `dpr=2` to the request body made it work
- **Response format:** NDJSON (newline-delimited JSON) using Relay incremental delivery
  - Line 0: Section header skeleton (`GroupsSectionHeaderUnit`)
  - Lines 1–N: Streamed `Story` nodes (actual posts)
  - Last line: `page_info` for pagination
- Successfully fetched 3 real posts from a live group

---

## Current State

### Implemented (on branch)

The Facebook connector has been fully rewritten from mbasic HTML to GraphQL:

| File | What |
|------|------|
| `constants.ts` | `GRAPHQL_API_URL`, `GRAPHQL_HEADERS`, `GRAPHQL_QUERY_NAME` |
| `types.ts` | Added `FacebookGraphQLTokens`, removed `FacebookGroupPageResult` |
| `client.ts` | GraphQL POST with jazoest, NDJSON handling, `token_expired` error type |
| `parser.ts` | NDJSON parser with safe nested access (replaces Cheerio) |
| `accounts.ts` | Added `getGraphQLTokens()` for FB_DOC_ID/FB_DTSG/FB_LSD from env |
| `index.ts` | Updated connector to use new client/parser |
| `parser.test.ts` | 9 tests for GraphQL JSON parsing |
| `connector.test.ts` | 6 tests including token validation and dedup |
| `collect-facebook.yml` | Added FB_DOC_ID, FB_DTSG, FB_LSD secrets |
| `collect-facebook.ts` | Updated env var docs |
| `src/index.ts` | Added `FacebookGraphQLTokens` export |

**Verification:** 166 tests pass, 0 TypeScript errors, architect approved.

### Problem: Token Expiry

The current approach requires 3 env vars extracted from Chrome DevTools:
- `FB_DOC_ID` — stable (weeks–months)
- `FB_DTSG` — expires in ~24–48 hours (session-tied CSRF token)
- `FB_LSD` — expires with fb_dtsg

**FB_DTSG expires too fast for a 30-min cron job.** Storing it in GitHub Secrets requires manual refresh every 1-2 days — not practical.

### Next Feature: Auto-Extract Tokens

Auto-extract `fb_dtsg` and `lsd` from the Facebook homepage HTML on each run, so only cookies + `doc_id` are needed as secrets. See spec at `.specs/features/facebook-token-refresh/spec.md`.

---

## GraphQL Response Structure (confirmed from real data)

```
NDJSON format (one JSON object per line):

Line 0 (skip): Section header
Lines 1-N (parse): Story nodes at path data.node
  post_id          → "3055855104610318"
  permalink_url    → "https://www.facebook.com/groups/.../posts/.../"
  actors[0].name   → "Zoar Akilov"
  comet_sections.content.story.message.text → "מציאה אמיתית - למכירה..."
  comet_sections.timestamp.story.creation_time → 1772471819 (unix)
  attachments[0].styles.attachment.all_subattachments.nodes[0].media.image.uri → image URL
  to.name          → "דירות להשכרה בתל אביב" (group name)
Last line (skip): page_info
```

---

## Quick Resume

```bash
git checkout feat/facebook-connector
cat .specs/HANDOFF.md
cat .specs/features/facebook-token-refresh/spec.md
```
