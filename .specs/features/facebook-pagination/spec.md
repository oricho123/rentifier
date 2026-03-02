# Facebook GraphQL Pagination — Fetch More Posts

## Problem

The Facebook GraphQL feed query (`GroupsCometFeedRegularStoriesPaginationQuery`) currently returns only ~3 posts per request, even though `GRAPHQL_POST_COUNT` is set to 10. Facebook's response uses Relay-style cursor pagination — the first response returns a small initial batch plus a `page_info.end_cursor` for loading more. Without following the cursor, we only get the first page.

## Goals

1. Follow Facebook's pagination cursor to fetch more posts per group per run
2. Make the target post count configurable (e.g. 20-50 posts per group)
3. Avoid over-fetching that could trigger rate limiting or bans
4. Maintain deduplication and circuit breaker behavior across pages

## Current Behavior

- `GRAPHQL_POST_COUNT = 10` is sent in the GraphQL `variables.count` field
- Facebook ignores the exact count and returns a small first page (~3 posts)
- The NDJSON response includes `page_info` with `end_cursor` and `has_next_page` on the last line
- We currently discard `page_info` and only process the first page

## Proposed Solution

### Phase 1: Basic cursor pagination

1. Parse `page_info` from the GraphQL response (last NDJSON line)
2. If `has_next_page` is true, make follow-up requests with `after: end_cursor`
3. Add a `MAX_PAGES_PER_GROUP` constant (default: 3-5) to cap pagination depth
4. Add a `TARGET_POSTS_PER_GROUP` constant (default: 20) as a soft target — stop paginating once enough posts are collected
5. Aggregate posts from all pages before deduplication

### Phase 2: Smart pagination

- Track how many new (non-duplicate) posts each page yields
- Stop paginating early if a page returns mostly known posts (diminishing returns)
- Add inter-page delay to avoid rate limiting (e.g. 1-2 seconds between pages)
- Consider reducing pagination depth for groups with low post volume

## Implementation Plan

1. Update `parseGraphQLResponse()` to also return `pageInfo: { endCursor, hasNextPage }`
2. Add `fetchGroupFeedPaginated()` that loops over pages using cursor
3. Add constants: `MAX_PAGES_PER_GROUP`, `TARGET_POSTS_PER_GROUP`, `INTER_PAGE_DELAY_MS`
4. Update `FacebookConnector.fetchNew()` to use paginated fetch
5. Update tests for multi-page scenarios
6. Monitor logs for rate limiting signals after deployment

## Risks

- More requests per run increases rate limiting / ban risk
- Longer execution time per collector run (may need to increase Worker timeout)
- Cursor format may change without notice

## Dependencies

- None (can be implemented independently)
- Benefits from all-groups fetch (PR #29) being merged first
