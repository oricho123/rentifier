# Feature Spec: M2 - YAD2 Production Readiness

**Status:** Specified
**Created:** 2026-02-23
**Owner:** TLC Spec-Driven

---

## Problem Statement

The YAD2 connector exists but has critical issues preventing production use:

1. **200-result API limit with national fetching:** YAD2's map API returns max 200 results per request. Without city filtering, results are random across all of Israel, causing us to miss new posts in target cities.

2. **Mock connector pollution:** The `MockConnector` is still registered and enabled in the database, creating noise in production data.

3. **Unverified rental endpoint:** The API endpoint is based on the sales endpoint (`/forsale/map`). The actual rental endpoint (`/rent/map`) needs verification with real data.

4. **Hardcoded city list:** Cities are hardcoded in `constants.ts` with no way to configure which cities to monitor per deployment or user.

5. **No coverage guarantee:** With round-robin fetching (1 city per collector run every 30min), we don't know if we're catching all new posts in active markets.

---

## Goals

### Primary
- Verify YAD2 rental API endpoint works and returns quality data
- Remove mock connector completely (code + database)
- Implement configurable city filtering to ensure coverage of target markets
- Test end-to-end collector → processor → notify flow with real YAD2 data

### Secondary
- Document YAD2 API behavior (response format, rate limits, error patterns)
- Establish monitoring to detect when we're hitting the 200-result limit
- Consider fetching strategies for high-volume cities (multiple filters to stay under 200)

---

## User Stories

**As a** solo developer deploying Rentifier
**I want to** configure which cities to monitor
**So that** I get complete coverage of my target rental markets without wasting quota on irrelevant areas

**As the** collector worker
**I want to** fetch from specific cities in rotation
**So that** I maximize the chance of catching all new posts in each city before they're buried by newer listings

**As a** future multi-user system
**I want** city selection to be data-driven
**So that** users can customize their monitored cities without code changes

---

## Requirements

### Functional

1. **Mock Connector Removal**
   - [ ] Remove `MockConnector` class from codebase
   - [ ] Remove or disable mock source in database (migration or manual cleanup)
   - [ ] Remove mock from connector registry

2. **YAD2 Endpoint Verification**
   - [ ] Test `/rent/map` endpoint with real requests
   - [ ] Verify response structure matches expectations (data.markers array)
   - [ ] Document actual response fields vs. TypeScript types
   - [ ] Confirm city filtering works (city code parameter)

3. **Configurable City Selection**
   - [ ] Move city list from hardcoded constants to configurable source
   - [ ] Options:
     - Environment variable (simple, deployment-level config)
     - Database table `monitored_cities` (user-level config, future-proof)
     - Cloudflare KV (deployment config without DB migration)
   - [ ] Connector should read city list from config, not hardcoded
   - [ ] Support empty city list (fetch nationally as fallback)

4. **Coverage Monitoring**
   - [ ] Log when a city fetch returns exactly 200 results (potential truncation)
   - [ ] Track results-per-city in source_state cursor
   - [ ] Consider warning or alert when consistently hitting limit

5. **End-to-End Testing**
   - [ ] Manual test: trigger collector → verify listings_raw inserted
   - [ ] Manual test: trigger processor → verify listings table populated with normalized data
   - [ ] Manual test: trigger notify → verify Telegram notification sent
   - [ ] Verify Hebrew city names, street addresses, images all working

### Non-Functional

- **Zero new dependencies:** Use existing Cloudflare primitives
- **Backward compatible cursor:** Existing source_state should not break
- **Cost:** Stay within free tier (no increase in request volume)

---

## Constraints

1. **YAD2 API Limitations:**
   - Max 200 results per request
   - Rate limiting unknown (handled by existing circuit breaker)
   - Captcha protection (Radware Bot Manager) already handled

2. **Cloudflare Free Tier:**
   - 100K requests/day across all workers
   - 10ms CPU per request
   - Cannot use expensive polling or scraping

3. **Solo Developer:**
   - No infrastructure beyond Cloudflare
   - Configuration must be simple to manage

---

## Success Metrics

- **Zero mock data** in production listings_raw table
- **YAD2 rental endpoint** confirmed working with ≥5 real listings fetched
- **Configurable cities** with ability to change list without code deployment
- **End-to-end flow verified:** collector → processor → notify with real data
- **Coverage visibility:** logs show results-per-city, flag cities hitting 200-limit

---

## Out of Scope

- Multi-source aggregation (Facebook, other platforms)
- Advanced filtering (price ranges, neighborhoods within cities)
- Fetching multiple times per city per run (handled in future milestone)
- Web UI for city configuration
- Geographic polygon filtering

---

## Open Questions

1. **Configuration method:** Environment variable vs. database table vs. KV?
   - **Recommendation:** Start with database table for future multi-user support

2. **What to do when a city hits 200 results?**
   - Log warning for now
   - Future: split into multiple queries (price ranges, neighborhoods)

3. **Should we disable the mock source or delete it?**
   - **Recommendation:** Disable in migration (set enabled=0), keep code for tests

4. **National fallback:** If city list is empty, fetch nationally or error?
   - **Recommendation:** Fetch nationally but log warning

5. **How many cities should we monitor initially?**
   - **Recommendation:** Start with 3-5 high-activity cities (תל אביב, ירושלים, חיפה)

---

## Dependencies

- M1 Foundation (complete)
- Database migrations 0001-0009 (complete)
- YAD2 connector scaffolding (complete)

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| YAD2 rental endpoint differs from sales endpoint | Medium | High | Test early; fallback to sales endpoint if needed |
| 200-result limit causes missed posts | High | High | Fetch specific cities, monitor logs, future: multi-query |
| Rate limiting triggers circuit breaker | Medium | Medium | Already handled; monitor frequency |
| ~~Captcha blocks during testing~~ | ~~Low~~ | ~~Medium~~ | **RESOLVED** — Cloudflare Workers AS13335 is hard-blocked by Radware. Moved yad2 scraping to GitHub Actions (see [GitHub Actions Scraper](#github-actions-scraper)). |

## GitHub Actions Scraper

**Added post-spec:** Radware Bot Manager permanently blocks Cloudflare's AS13335 IP range on yad2.co.il. No header combination bypasses this — the IP itself is flagged. GitHub Actions runners use different, unblocked IPs.

**Solution implemented:**
- `scripts/collect-yad2.ts` — standalone scraper using `@rentifier/connectors` via `tsx`; reads/writes D1 state via Cloudflare REST API
- `.github/workflows/collect-yad2.yml` — cron every 30 min + `workflow_dispatch`
- `apps/collector/src/registry.ts` — Yad2Connector removed from Worker in production; conditionally enabled via `ENABLE_YAD2_CONNECTOR=true` for local dev

**Required GitHub secrets:** `CF_ACCOUNT_ID`, `CF_API_TOKEN` (D1:Edit), `CF_D1_DATABASE_ID`

---

## Notes

- Current round-robin fetches 1 city per run (every 30min)
- With 10 cities, each city is fetched every 5 hours
- For high-volume cities (תל אביב), this may not be frequent enough
- Consider increasing collector frequency or reducing city list initially
