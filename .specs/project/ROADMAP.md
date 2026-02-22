# Roadmap

**Current Milestone:** M2 - First Live Source
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

## M2 - First Live Source

**Goal:** YAD2 connector fully operational, delivering real listings to Telegram.

### Features

**YAD2 Connector** - IN PROGRESS

- Implement Yad2 rental API client with Cloudflare Workers `fetch`
- Cursor-based incremental fetching with page tracking
- Normalize Yad2 structured fields to canonical schema
- Safety mechanisms: retry with backoff, captcha detection, circuit breaker

**Extraction Tuning** - PLANNED

- Tune regex/rules for YAD2's data format
- Handle Hebrew text patterns for price, rooms, neighborhoods

**Telegram Bot Setup** - PLANNED

- Create bot, configure chat_id as Cloudflare secret
- Format listing messages (title, price, rooms, link)

**Deploy to Cloudflare** - PLANNED

- Deploy all three workers with D1 bindings
- Configure cron schedules (collector: 30min, processor: 15min, notify: 5min)
- Verify end-to-end flow with real data

---

## M3 - Multi-User & Filters

**Goal:** Multiple users can register via Telegram, set custom filters, and receive personalized notifications.
**Status:** COMPLETE
**Completed:** 2026-02-22

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

**Filter Matching Engine** - PLANNED

- Match listings against multiple users' filters efficiently
- Support: price range, room count, city, neighborhood, keyword inclusion/exclusion, tags

---

## M4 - Additional Sources

**Goal:** Add Facebook and other connectors to broaden listing coverage.

### Features

**Facebook Connector** - PLANNED

- Research compliant access method (Graph API, partnership, browser extension, etc.)
- Implement connector interface

**Additional Source Connectors** - PLANNED

- Other Israeli rental platforms as identified

---

## Future Considerations

- Web UI for browsing listings, managing filters, viewing history
- AI-powered relevance scoring and listing summarization
- Geo-based filtering with map view
- Listing price trend analytics
- WhatsApp notification channel
