# Facebook Groups Connector (GraphQL) - Tasks

**Design**: `.specs/features/facebook-connector/design.md`
**Status**: Ready
**Replaces**: mbasic HTML approach (blocked by Facebook)

---

## Pre-Requisite (User Action)

Before implementation can begin, the user must extract the GraphQL query details from Chrome DevTools:

1. Open Chrome → DevTools → Network tab → filter by `graphql`
2. Navigate to the target Facebook group
3. Find the group feed query (look for `GroupsCometFeedRegularStories` or similar name)
4. Save from the request payload:
   - `doc_id` value
   - `variables` JSON shape
   - Any additional form fields (`fb_dtsg`, `lsd`, etc.)
5. Save the full JSON response body as `packages/connectors/src/facebook/__tests__/fixtures/graphql-response.json`

This provides the exact request format and response shape needed for T1 and T2.

---

## Execution Plan

### Phase 1: Foundation (Parallel, after pre-requisite)

```
T1 [P] GraphQL Client
T2 [P] GraphQL Response Parser
```

### Phase 2: Integration (Sequential)

```
T1, T2 complete → T3 → T4
```

### Phase 3: Cleanup + Validation

```
T5 (parallel with T4)
T6 (after all tasks)
```

---

## Task Breakdown

### T1: GraphQL Client
**What**: Replace `client.ts` — new HTTP client that POSTs to `www.facebook.com/api/graphql/` with `doc_id`, `variables`, and cookies. Retry with exponential backoff. Detect auth errors from JSON response (not HTML redirects).
**Where**: `packages/connectors/src/facebook/graphql-client.ts` (new), update `constants.ts`
**Depends on**: Pre-requisite (need real request format)
**Changes**:
- New `fetchGroupFeed(groupId, cookies, docId)` → returns parsed JSON
- New `fetchWithRetry()` wrapping `fetchGroupFeed`
- Update `constants.ts`: add `FB_GRAPHQL_URL`, `getDocId()`, remove `MBASIC_BASE_URL`, `MBASIC_HEADERS`
- Auth detection: check for `OAuthException` in JSON response
- Rate limit detection: check for error code 4
- Keep `FacebookClientError` class (same error types)
**Verify**:
- `fetchGroupFeed` sends correct POST with `doc_id` + `variables` + cookies
- Expired cookies detected from JSON error response
- Rate limiting detected from JSON error response
- Cookie values never appear in logs
- Retry works with exponential backoff

### T2: GraphQL Response Parser
**What**: Replace `parser.ts` — parse the GraphQL JSON response into `FacebookPost[]`. No cheerio needed.
**Where**: `packages/connectors/src/facebook/graphql-parser.ts` (new), update `types.ts`
**Depends on**: Pre-requisite (need real response shape)
**Changes**:
- New `parseGraphQLResponse(json, groupId)` → `FacebookPost[]`
- Navigate `data.node.group_feed.edges[].node` (adapt to real shape)
- Extract: `id` → postId, `creation_time` → postedAt (unix→ISO), `message.text` → content, `actors[0].name` → authorName, `attachments[0].media.image.uri` → imageUrl, `url` → permalink
- Update `FacebookPost` type if needed (fields should stay the same)
- Remove `FacebookGroupPageResult` type (no pagination URL needed)
- Add `FacebookGraphQLNode` type for raw response typing
- Canary check: warn if response has data but edges is empty
**Verify**:
- Parses fixture JSON into correct `FacebookPost[]` array
- Handles missing fields gracefully (null for optional)
- Handles empty edges array
- Handles error responses without crashing
- Unix timestamp → ISO string conversion correct

### T3: Wire Connector to GraphQL
**What**: Update `FacebookConnector` to use the new GraphQL client/parser instead of mbasic HTML.
**Where**: `packages/connectors/src/facebook/index.ts`
**Depends on**: T1, T2
**Changes**:
- Import `fetchGroupFeed`/`fetchWithRetry` from `graphql-client` instead of `client`
- Import `parseGraphQLResponse` from `graphql-parser` instead of `parser`
- In `fetchNew()`: call `fetchWithRetry(groupId, cookies, docId)` → `parseGraphQLResponse(json, groupId)`
- Get `docId` from `getDocId()` in constants
- Rest stays the same: dedup, circuit breaker, cursor state, account rotation
**Verify**:
- `fetchNew()` calls GraphQL client instead of mbasic client
- Dedup via `knownPostIds` still works
- Circuit breaker still works
- `normalize()` unchanged — still uses `extractAll()`

### T4: Update Tests
**What**: Rewrite tests for new GraphQL client/parser. Remove HTML fixture tests.
**Where**: `packages/connectors/src/facebook/__tests__/`
**Depends on**: T1, T2, T3
**Changes**:
- Delete `parser.test.ts` (HTML parser tests)
- New `graphql-parser.test.ts`: parse fixture JSON, empty edges, missing fields, error response
- Update `connector.test.ts`: mock `graphql-client` instead of `client`, mock `constants` for `getDocId()`
- Add fixture: `__tests__/fixtures/graphql-response.json` (from pre-requisite)
**Verify**:
- All new tests pass
- `pnpm test` passes across all packages
- No references to old `parser.ts` or `client.ts`

### T5: Cleanup
**What**: Remove old mbasic files and cheerio dependency.
**Where**: `packages/connectors/`
**Depends on**: T3, T4
**Changes**:
- Delete `client.ts` (mbasic HTTP client)
- Delete `parser.ts` (cheerio HTML parser)
- Remove `cheerio` from `packages/connectors/package.json`
- Update `packages/connectors/src/index.ts` exports if needed
- Update `.github/workflows/collect-facebook.yml`: add `FB_DOC_ID` to env vars
- Delete `scripts/debug-facebook-html.ts` (debug script no longer needed)
**Verify**:
- `pnpm install` clean (no cheerio)
- `pnpm -r exec tsc --noEmit` — zero TypeScript errors
- `pnpm test` — all tests pass
- No imports of deleted files anywhere

### T6: Manual E2E Validation
**What**: Run the full pipeline locally with real cookies and doc_id to confirm posts are fetched.
**Where**: Local terminal
**Depends on**: T1–T5
**Steps**:
1. Add `FB_DOC_ID` to `.env`
2. Run `npx tsx --env-file=.env scripts/collect-facebook.ts`
3. Confirm `candidateCount > 0` in output
4. Confirm posts have valid content, postId, postedAt
**Verify**:
- `fb_fetch_complete` log shows `totalPosts > 0` and `newPosts > 0`
- `collect_complete` log shows `candidateCount > 0`
- No auth errors
