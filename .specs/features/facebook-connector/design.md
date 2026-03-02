# Facebook Groups Connector - Design

**Spec**: `.specs/features/facebook-connector/spec.md`
**Full Plan**: `.omc/plans/facebook-connector.md`

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
  ├── FacebookClient.fetchGroupPage(groupId, cookies)
  │     ├── HTTP GET mbasic.facebook.com/groups/{id}
  │     └── Auth/ban/rate-limit detection
  ├── parseGroupPage(html, groupId) via cheerio
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

## Key Decisions

1. **mbasic.facebook.com over facebook.com** — Static HTML, no JS rendering needed, smaller detection surface
2. **HTTP requests over Playwright** — mbasic doesn't need JS; plain fetch + cookies is sufficient
3. **Cookie rotation** — Multiple accounts (`FB_COOKIES_1..N`) with round-robin selection; disabled accounts tracked in cursor state
4. **English locale** — All FB accounts set to English to get predictable time strings
5. **Static group list** — Groups configured in constants.ts (future: DB table like monitored_cities)
6. **Reuse extraction** — `@rentifier/extraction` already handles Hebrew price/rooms/location/tags

## Data Flow

`FacebookPost` (parsed from HTML) → `ListingCandidate` (rawTitle=rawDescription=post.content) → `ListingDraft` (via extractAll + normalize)

## New Dependencies

- `cheerio` — HTML parsing for mbasic pages
