# Facebook Groups Connector (GraphQL) - Design

**Spec**: `.specs/features/facebook-connector/spec.md`

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
  ├── Account rotation (round-robin)
  ├── fetchGroupFeed(groupId, cookies, docId)
  │     ├── POST www.facebook.com/api/graphql/
  │     └── Auth/rate-limit detection from JSON errors
  ├── parseGraphQLResponse(json, groupId)
  │     └── Extract posts from edges[] → FacebookPost[]
  ├── Dedup via knownPostIds in cursor state
  └── Circuit breaker (same pattern as YAD2)
  │
  ▼
FacebookConnector.normalize(candidate)
  └── extractAll() from @rentifier/extraction
  │
  ▼
db.insertRawListings() via D1 REST API
```

## What Changes vs Current Implementation

### Replaced (remove)
- `client.ts` — `fetchGroupPage()` + `fetchWithRetry()` that fetches mbasic HTML
- `parser.ts` — Cheerio-based HTML parser, `parseGroupPage()`, `parseRelativeTime()`
- `cheerio` dependency

### New (add)
- `graphql-client.ts` — `fetchGroupFeed()` that POSTs to `/api/graphql/` with `doc_id` + cookies
- `graphql-parser.ts` — Extract posts from GraphQL JSON response (no cheerio needed)

### Unchanged (keep as-is)
- `accounts.ts` — Cookie rotation, `getAccounts()`, `selectAccount()`
- `index.ts` — `FacebookConnector` class (update to use new client/parser)
- `types.ts` — `FacebookCursorState`, `FacebookAccount` (update `FacebookPost` for GraphQL fields)
- `collect-facebook.ts` — Collection script (no changes needed)
- `.github/workflows/collect-facebook.yml` — Add `FB_DOC_ID` env var
- Tests — Rewrite for new client/parser

## Key Decisions

1. **GraphQL API over mbasic.facebook.com** — mbasic now blocks non-browser HTTP clients with "unsupported browser" interstitial. GraphQL returns structured JSON.
2. **HTTP requests over Playwright** — GraphQL API doesn't need JS rendering; plain fetch + cookies is sufficient
3. **Cookie rotation** — Multiple accounts (`FB_COOKIES_1..N`) with round-robin selection; disabled accounts tracked in cursor state
4. **Static group list** — Groups configured in constants.ts (future: DB table)
5. **Reuse extraction** — `@rentifier/extraction` already handles Hebrew price/rooms/location/tags
6. **doc_id as env var** — Easy to rotate when Facebook changes internal query IDs

## GraphQL Request Format

### Request
```
POST https://www.facebook.com/api/graphql/
Content-Type: application/x-www-form-urlencoded
Cookie: <user cookies>

fb_api_caller_class=RelayModern
&variables={"groupID":"<GROUP_ID>","count":10,...}
&doc_id=<DOC_ID>
```

### Key Headers
```
User-Agent: <desktop Chrome UA>
Content-Type: application/x-www-form-urlencoded
Cookie: <cookies>
```

### Response (simplified expected shape)
```json
{
  "data": {
    "node": {
      "group_feed": {
        "edges": [
          {
            "node": {
              "id": "post_id",
              "creation_time": 1709312400,
              "message": { "text": "דירת 3 חדרים..." },
              "actors": [{ "name": "Author Name" }],
              "attachments": [{ "media": { "image": { "uri": "..." } } }],
              "url": "https://www.facebook.com/groups/.../posts/..."
            }
          }
        ]
      }
    }
  }
}
```

**Note:** The exact response shape depends on the `doc_id`. User must inspect the real response from DevTools and we'll adapt the parser to match the actual structure.

## Discovery Step (Pre-Implementation)

Before writing code, the user needs to:

1. Open Chrome → DevTools → Network tab
2. Go to the Facebook group page
3. Scroll to trigger the feed query
4. Filter network requests by `graphql`
5. Find the request that loads group feed posts (look for `GroupsCometFeedRegularStories` or similar)
6. From the request payload, copy:
   - `doc_id` value
   - `variables` shape (what fields are sent)
7. From the response, copy the full JSON structure
8. Save the doc_id as `FB_DOC_ID` env var
9. Save a sample response as a test fixture

## Constants Updates

```typescript
export const FB_GRAPHQL_URL = 'https://www.facebook.com/api/graphql/';

export function getDocId(): string {
  const docId = process.env.FB_DOC_ID;
  if (!docId) throw new Error('FB_DOC_ID environment variable is required');
  return docId;
}
```

## Auth / Error Detection

GraphQL API returns different error shapes than HTML:
- **Expired cookies**: HTTP 200 with `{"error":{"type":"OAuthException",...}}`
- **Rate limited**: HTTP 200 with `{"error":{"code":4,...}}`
- **Invalid doc_id**: HTTP 200 with `{"errors":[...]}`
- **Network error**: Non-200 HTTP status

The client detects these from the JSON response rather than HTML redirect patterns.

## fb_dtsg Token

Some GraphQL requests require a `fb_dtsg` CSRF token. Strategy:
1. Try without it first — some queries work without it
2. If needed, extract from a GET to `www.facebook.com` (look for `"DTSGInitData"` in page source)
3. Cache the token in cursor state (it lasts for the session)

## Data Flow

`GraphQL JSON` → `FacebookPost[]` (parsed from edges) → `ListingCandidate` (rawTitle=rawDescription=post.content) → `ListingDraft` (via extractAll + normalize)

## Removed Dependencies

- `cheerio` — No longer needed (JSON parsing replaces HTML parsing)

## Testing Strategy

- Unit tests for `graphql-parser.ts` with fixture JSON responses
- Unit tests for `graphql-client.ts` with mocked fetch
- Integration test for `FacebookConnector` with mocked client
- Manual e2e test with real cookies + doc_id
