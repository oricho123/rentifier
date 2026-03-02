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

**Facebook Connector** - ✅ IMPLEMENTED (PR #26 — pending merge)

- ✅ Research: Graph API shut down (April 2024), mbasic blocked, GraphQL API works
- ✅ GraphQL client (`POST /api/graphql/`) with jazoest CSRF checksum
- ✅ NDJSON parser for Relay incremental delivery response format
- ✅ Multi-account cookie rotation with disabled account tracking
- ✅ FacebookConnector implementing Connector interface
- ✅ Collection script with admin Telegram notification on cookie expiry
- ✅ GitHub Actions workflow (30-min cron)
- ✅ DB migration seeding facebook source row
- ✅ 15 unit tests (parser + connector), 166 total
- ✅ Manual testing: 3 posts fetched from live group via GraphQL
- ⬜ Auto-extract fb_dtsg/lsd tokens (see facebook-token-refresh spec)
- ⬜ Merge PR #26 to main

**Additional Source Connectors** - PLANNED

- Other Israeli rental platforms as identified

---

## Future Considerations

### User Experience
- Web UI for browsing listings, managing filters, viewing history
- WhatsApp notification channel
- Mobile app (React Native)

### Data & Intelligence
- AI-powered relevance scoring and listing summarization
- Listing price trend analytics
- Geo-based filtering with map view
- Duplicate detection across sources

### Infrastructure & Automation
- **Dynamic city discovery** - Auto-discover YAD2 city codes instead of manual mapping
  - Options: scrape frontend dropdown, reverse-engineer from API, user-provided codes
  - Benefit: Easier to add new cities, better multi-user support
  - See: `.specs/features/dynamic-city-discovery/analysis.md`
- Automated deployment pipeline (CI/CD)
- Monitoring and alerting (error rates, API health)
- Rate limiting and quota management
