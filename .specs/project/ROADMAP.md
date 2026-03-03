# Roadmap

**Current Milestone:** M4 - Additional Sources
**Status:** In Progress

---

## M1 - Foundation — DONE

**Goal:** Monorepo scaffolding, shared packages, D1 schema, and the connector interface — everything needed before building the first real connector.
**Completed:** 2026-02-21

### Features

**Monorepo Setup** - DONE
**Shared Packages** - DONE (core, db, connectors, extraction)
**D1 Database Schema** - DONE (7 tables, indexes, seed data)
**Collector Worker** - DONE
**Processor Worker** - DONE
**Notify Worker** - DONE

---

## M2 - First Live Source — DONE

**Goal:** YAD2 connector fully operational, delivering real listings to Telegram.
**Completed:** 2026-03-01

### Features

**YAD2 Production Readiness** - ✅ COMPLETE (.specs/features/m2-yad2-production-readiness/)

- ✅ Removed mock connector (disabled in database, kept for tests)
- ✅ Verified YAD2 rental API endpoint (all 3 cities working, 200 results each)
- ✅ Implemented configurable city selection (monitored_cities table)
- ✅ Addressed 200-result API limit with targeted city fetching
- ✅ Monitor coverage with result count tracking and warnings
- ✅ End-to-end testing: collector → processor → notify (1868 listings, 100 notifications)

**Extraction Tuning** - DEFERRED

- Tune regex/rules for YAD2's data format (if needed after real data testing)
- Handle Hebrew text patterns for price, rooms, neighborhoods

**Deploy to Cloudflare** - ✅ COMPLETE

- ✅ All three workers deployed with D1 bindings
- ✅ Cron schedules configured (collector: 30min, processor: 15min, notify: 5min)
- ✅ Cloudflare secrets set (Telegram bot token, webhook secret)
- ✅ GitHub Actions yad2 scraper (bypasses Radware IP block)
- ✅ CI workflow for PRs (typecheck + tests)

---

## M3 - Multi-User & Filters — DONE

**Goal:** Multiple users can register via Telegram, set custom filters, and receive personalized notifications.
**Completed:** 2026-03-01

### Features

**Telegram Bot Commands** - ✅ COMPLETE

- ✅ `/start` registration flow
- ✅ `/filter` create filters with guided conversation (city, price range, rooms, keywords)
- ✅ `/list` show all user filters
- ✅ `/pause` / `/resume` notification control
- ✅ `/delete` remove filters
- ✅ `/help` command reference
- ✅ Webhook handler with secret token validation
- ✅ Conversation state management with 10-minute TTL
- ✅ Inline keyboard support for interactive prompts

**Telegram Bot Improvements** - ✅ COMPLETE

- ✅ Hebrew localization with RTL support
- ✅ Telegram command menu integration (BotCommands API)
- ✅ Interactive filter creation with inline keyboards
- ✅ Quick-select buttons for common cities
- ✅ Interactive list management (edit/delete buttons)
- ✅ Rich message formatting with emojis
- ✅ Progress indicators for multi-step flows
- ✅ One-tap confirmation for actions
- ✅ Street addresses with clickable Google Maps links
- ✅ Listing images in photo messages

**Filter Matching Engine** - ✅ COMPLETE

- ✅ Match listings against multiple users' filters (matchesFilter in notification-service.ts)
- ✅ Price range, room count, city, neighborhood, keyword (OR), must-have tags (AND), exclude tags (NOT)
- ✅ Deduplication via notifications_sent table
- ✅ 37 unit tests covering all matching criteria

---

## M4 - Additional Sources

**Goal:** Add Facebook and other connectors to broaden listing coverage.

### Features

**Facebook Connector** - ✅ COMPLETE

- ✅ Research: Graph API shut down (April 2024), mbasic blocked, GraphQL API works
- ✅ Initial GraphQL implementation (PR #26-#31, merged)
- ✅ **Playwright migration** (PR #32) — replaced GraphQL fetch() with headless browser
  - Sessions survive weeks instead of hours (no more manual token refresh)
  - Eliminated FB_DOC_ID, FB_DTSG, FB_LSD env vars
  - DOM selectors validated against live Facebook (data-ad-rendering-role attributes)
  - 10 posts extracted from 3 groups in ~30s E2E
- ✅ Multi-account cookie rotation with disabled account tracking
- ✅ Collection script with admin Telegram notification on cookie expiry
- ✅ GitHub Actions workflow (30-min cron, Playwright chromium install)

**Extraction Improvements** - ✅ COMPLETE

- ✅ Group default cities with configurable `defaultCities` per monitored group (PR #34)
- ✅ Word boundary checking prevents substring false positives (e.g., "הדר" in "נהדר")
- ✅ Street regex: Hebrew word-based capture (2-10 chars per word, 1-2 words max)
- ✅ Two-word street prefix whitelist (בן, נחלת, קרית, אבן, בר, הרב, שדרות)
- ✅ Missing neighborhood variants (צפון הישן, צפון החדש, מרכז העיר)
- ✅ Type fix in FacebookNormalizer.matchNeighborhoodInCity (PR #35)
- ✅ 228 tests passing across 11 files

---

## M5 - Data Quality & Intelligence

**Goal:** Improve listing quality with AI extraction, duplicate detection, and listing classification to reduce noise and increase relevance.

### Features

**AI-Powered Extraction** - COMPLETE

- Cloudflare Workers AI (Llama 3.1 8B) as fallback when regex misses fields
- Field-gated: only invoked when neighborhood/street/price/city are null
- Budget-capped: max 20 AI calls per processor batch
- Weighted confidence scoring (price 0.30, city 0.25, bedrooms 0.20, neighborhood 0.10, street 0.05, tags 0.05)
- AI Gateway enabled for observability (rentifier-ai-gateway)
- Status: Deployed to production (PR #36, migration 0012)

**Duplicate Detection** - SPECIFIED

- Detect same listing posted across YAD2 + Facebook via field-based matching
- Match on city + bedrooms + price (±10%) + street/neighborhood/coordinates
- Source priority: YAD2 preferred as canonical over Facebook
- Notify worker filters out duplicates via `WHERE duplicate_of IS NULL`
- Spec: `.specs/features/duplicate-detection/spec.md`

**Brokerage Detection** - PLANNED

- Identify posts from real estate agents vs. private landlords
- Tag listings as `broker` or `private`
- Allow users to filter out brokerage listings

**Sublet vs. Rent Classification** - PLANNED

- Distinguish sublet/short-term from long-term rental listings
- Tag listings as `sublet`, `short-term`, or `long-term`
- Allow users to filter by rental type

---

## M6 - User Experience

**Goal:** Expand notification channels and add a web interface for browsing and managing listings.

### Features

**Web UI** - PLANNED

- Browse all collected listings with search and filters
- Manage filters (create, edit, delete) from web interface
- View notification history
- Map view with geo-based filtering

**WhatsApp Notification Channel** - PLANNED

- Alternative to Telegram for users who prefer WhatsApp
- Same filter matching and notification logic

**Listing Price Trends** - PLANNED

- Track price changes over time per area/neighborhood
- Show average prices in Telegram notifications or web UI
- Historical price data for market insights

---

## M7 - Infrastructure & Scale

**Goal:** Improve reliability, monitoring, and automation for production scale.

### Features

**Dynamic City Discovery** - PLANNED

- Auto-discover YAD2 city codes instead of manual mapping
- Options: scrape frontend dropdown, reverse-engineer from API, user-provided codes
- See: `.specs/features/dynamic-city-discovery/analysis.md`

**Monitoring & Alerting** - PLANNED

- Error rate tracking per connector (auth failures, timeouts, parse errors)
- API health dashboards
- Alert on degraded collection (fewer posts than expected)

**Additional Source Connectors** - PLANNED

- Other Israeli rental platforms as identified (Homeless, Yad1, etc.)

**Rate Limiting & Quota Management** - PLANNED

- Per-user notification rate limits
- Connector request budgets to avoid bans
- Graceful degradation under load
