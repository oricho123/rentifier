# Facebook Token Auto-Refresh - Design

**Spec**: `.specs/features/facebook-token-refresh/spec.md`

---

## Architecture

```
scripts/collect-facebook.ts
  │
  ▼
FacebookConnector.fetchNew(cursor, db)
  ├── Account rotation (round-robin)
  ├── extractTokensFromHomepage(cookies)        ← NEW
  │     ├── GET www.facebook.com with cookies
  │     ├── Extract fb_dtsg from HTML (3 patterns)
  │     ├── Extract lsd from HTML (2 patterns)
  │     └── Detect auth errors (login redirect, checkpoint)
  ├── Fall back to env vars if extraction fails  ← NEW
  ├── computeJazoest(fb_dtsg)
  ├── fetchGroupGraphQL(groupId, cookies, tokens)
  ├── parseGraphQLResponse(responseText, groupId)
  ├── Dedup via knownPostIds
  └── Circuit breaker
```

## What Changes

### Modified files

| File | Change |
|------|--------|
| `client.ts` | Add `extractTokensFromHomepage(cookies)` function |
| `accounts.ts` | Make `getGraphQLTokens()` return partial (docId only) |
| `index.ts` | Call token extraction before GraphQL fetch, fallback to env |
| `constants.ts` | Add `HOMEPAGE_URL`, `HOMEPAGE_TIMEOUT_MS` |
| `types.ts` | No changes needed (`FacebookGraphQLTokens` already exists) |
| `collect-facebook.yml` | Remove `FB_DTSG` and `FB_LSD` from required secrets |
| `collect-facebook.ts` | Update env var documentation comment |

### New exports

```typescript
// client.ts
export async function extractTokensFromHomepage(
  cookies: string,
): Promise<{ fbDtsg: string; lsd: string }>;
```

## Token Extraction Logic

```typescript
async function extractTokensFromHomepage(cookies: string) {
  // 1. Fetch homepage
  const response = await fetch('https://www.facebook.com/', {
    headers: { Cookie: cookies, 'User-Agent': CHROME_UA, Accept: 'text/html' },
  });
  const html = await response.text();

  // 2. Detect auth failures
  if (html.includes('id="login_form"')) throw FacebookClientError('auth_expired');
  if (html.includes('checkpoint') && html.includes('verify')) throw FacebookClientError('banned');

  // 3. Extract fb_dtsg (try 3 patterns)
  const dtsg =
    match(html, /"DTSGInitData".*?"token":"([^"]+)"/) ??
    match(html, /name="fb_dtsg" value="([^"]+)"/) ??
    match(html, /"dtsg":\{"token":"([^"]+)"/);

  // 4. Extract lsd (try 2 patterns)
  const lsd =
    match(html, /"LSD".*?\[.*?"(\w+)"\]/s) ??
    match(html, /name="lsd" value="([^"]+)"/);

  if (!dtsg) throw FacebookClientError('parse', 'Could not extract fb_dtsg from homepage');

  return { fbDtsg: dtsg, lsd: lsd ?? '' };
}
```

## Connector Flow (updated)

```typescript
// In FacebookConnector.fetchNew():

// 1. Get doc_id from env (required, stable)
const docId = process.env.FB_DOC_ID;

// 2. Try to extract fresh tokens from homepage
let tokens: FacebookGraphQLTokens;
try {
  const { fbDtsg, lsd } = await extractTokensFromHomepage(account.cookies);
  tokens = { docId, fbDtsg, lsd };
} catch (extractionError) {
  // 3. Fall back to env var tokens
  const envTokens = getGraphQLTokens();
  if (envTokens) {
    tokens = envTokens;
    log({ event: 'fb_token_extraction_failed_using_env_fallback' });
  } else {
    // 4. No tokens available — skip run
    log({ event: 'fb_no_tokens_available' });
    return { candidates: [], nextCursor: ... };
  }
}

// 5. Proceed with GraphQL fetch using tokens
const responseText = await fetchWithRetry(groupId, account.cookies, tokens);
```

## Error Handling

| Extraction result | Action |
|-------------------|--------|
| Success | Use fresh tokens |
| Failed + env vars available | Fall back to env vars, log warning |
| Failed + no env vars | Skip run, log error, bump consecutive failures |
| Auth expired during extraction | Disable account (same as GraphQL auth error) |
| Banned during extraction | Disable account (same as GraphQL ban) |

## Testing Strategy

- Unit test `extractTokensFromHomepage()` with mock HTML containing each pattern
- Unit test fallback flow: extraction fails → env vars used
- Unit test auth detection: login form → `auth_expired` error
- Integration test: connector uses extracted tokens when env vars absent
- No real HTTP in tests — all mocked
