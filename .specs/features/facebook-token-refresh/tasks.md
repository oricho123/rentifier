# Facebook Token Auto-Refresh - Tasks

**Design**: `.specs/features/facebook-token-refresh/design.md`
**Status**: Ready

---

## Execution Plan

### Phase 1: Token Extraction (Sequential)

```
T1 → T2 → T3
```

### Phase 2: Cleanup + Validation (Parallel)

```
T4 [P] T5
T6 (after all)
```

---

## Task Breakdown

### T1: Add extractTokensFromHomepage() to client.ts

**What**: New function that fetches `www.facebook.com` with cookies and extracts `fb_dtsg` + `lsd` from the HTML using regex patterns.
**Where**: `packages/connectors/src/facebook/client.ts`
**Changes**:
- Add `extractTokensFromHomepage(cookies: string)` → `{ fbDtsg: string; lsd: string }`
- Try 3 patterns for fb_dtsg: `DTSGInitData`, form input, `dtsg.token`
- Try 2 patterns for lsd: `LSD` array, form input
- Detect auth failures: login form → `auth_expired`, checkpoint → `banned`
- Timeout: 15s (homepage is ~500KB, should be fast)
- Add `HOMEPAGE_URL` and `HOMEPAGE_TIMEOUT_MS` to constants.ts
**Verify**:
- Function extracts tokens from mock HTML with each pattern variant
- Throws `FacebookClientError('auth_expired')` on login page
- Throws `FacebookClientError('banned')` on checkpoint page
- Throws `FacebookClientError('parse')` when no patterns match
- Cookies never logged

### T2: Wire token extraction into connector

**What**: Update `FacebookConnector.fetchNew()` to call `extractTokensFromHomepage()` before making GraphQL requests, with fallback to env vars.
**Where**: `packages/connectors/src/facebook/index.ts`, `accounts.ts`
**Depends on**: T1
**Changes**:
- In `fetchNew()`: call `extractTokensFromHomepage(account.cookies)` after account selection
- On success: use fresh tokens
- On failure: fall back to `getGraphQLTokens()` from env vars
- On both fail: log `fb_no_tokens_available`, return empty, bump failures
- Handle `auth_expired`/`banned` from extraction same as from GraphQL (disable account)
- Update `getGraphQLTokens()` to make `fbDtsg`/`lsd` optional (only `docId` required)
**Verify**:
- Connector uses fresh tokens when extraction succeeds
- Connector falls back to env vars when extraction fails
- Connector skips run when both fail
- Account disabled on auth_expired during extraction

### T3: Update tests

**What**: Add unit tests for token extraction and fallback flow.
**Where**: `packages/connectors/src/facebook/__tests__/`
**Depends on**: T1, T2
**Changes**:
- New tests in `parser.test.ts` or `client.test.ts` for `extractTokensFromHomepage()`:
  - Extracts from DTSGInitData pattern
  - Extracts from form input pattern
  - Extracts from dtsg.token pattern
  - Detects login page → auth_expired
  - Detects checkpoint → banned
  - Returns error when no patterns match
- Update `connector.test.ts`:
  - Mock `extractTokensFromHomepage` to return tokens
  - Test fallback to env when extraction fails
  - Test skip when both fail
**Verify**:
- All new tests pass
- All existing tests still pass
- `npx vitest run` — 0 failures

### T4: Update CI and env var docs

**What**: Remove `FB_DTSG` and `FB_LSD` from required GitHub Secrets. Update documentation.
**Where**: `.github/workflows/collect-facebook.yml`, `scripts/collect-facebook.ts`
**Depends on**: T2
**Changes**:
- Remove `FB_DTSG` and `FB_LSD` lines from workflow env (or mark as optional with comment)
- Update collect-facebook.ts header comment: mark FB_DTSG/FB_LSD as optional fallback
- Update `.specs/features/facebook-connector/spec.md` "What the user needs to provide" section
**Verify**:
- Workflow YAML is valid
- No reference to FB_DTSG/FB_LSD as "required"

### T5: Update handoff and state docs

**What**: Update project docs to reflect token auto-refresh.
**Where**: `.specs/HANDOFF.md`, `.specs/project/STATE.md`, `.specs/project/ROADMAP.md`
**Depends on**: T2
**Changes**:
- HANDOFF: Mark token problem as resolved
- STATE: Add AD-019 for token auto-refresh decision
- ROADMAP: Update Facebook connector status
**Verify**:
- Docs are consistent with implementation

### T6: Manual E2E Validation

**What**: Run collection script without FB_DTSG/FB_LSD env vars to confirm auto-extraction works.
**Where**: Local terminal
**Depends on**: T1–T5
**Steps**:
1. Comment out `FB_DTSG` and `FB_LSD` from `.env`
2. Run `npx tsx --env-file=.env scripts/debug-facebook-graphql.ts`
3. Confirm tokens extracted from homepage and posts fetched
**Verify**:
- `fb_token_extraction` log shows fresh tokens extracted
- `fb_fetch_complete` log shows `totalPosts > 0`
- No manual token refresh needed
