# Roadmap

**Current Milestone:** M1 - Foundation
**Status:** Planning

---

## M1 - Foundation

**Goal:** Monorepo scaffolding, shared packages, D1 schema, and the connector interface — everything needed before building the first real connector.
**Target:** All infrastructure in place; a dummy/mock connector can run end-to-end through collector → processor → notify.

### Features

**Monorepo Setup** - PLANNED

- pnpm workspace with `apps/` and `packages/` directories
- Shared TypeScript config, linting, formatting
- Wrangler configs per worker app

**Shared Packages** - PLANNED

- `packages/core`: canonical types (`Listing`, `ListingCandidate`, `Filter`, etc.), Zod schemas, constants
- `packages/db`: D1 migrations, schema, query helpers
- `packages/connectors`: connector interface (`fetchNew`, `normalize`, `nextCursor`)
- `packages/extraction`: rule-based extraction engine (price, rooms, tags from Hebrew/English text)

**D1 Database Schema** - PLANNED

- `sources` + `source_state` (connector registry and cursor tracking)
- `listings_raw` (raw ingested payloads)
- `listings` (canonical normalized listings)
- `users` + `filters` (user preferences and match criteria)
- `notifications_sent` (dedup tracking for sent notifications)

**Collector Worker** - PLANNED

- Cron-triggered fetching from enabled connectors
- Writes raw payloads to `listings_raw`, updates `source_state` cursor
- Idempotent: safe to re-run without duplicating data

**Processor Worker** - PLANNED

- Reads unprocessed raw listings
- Runs extraction pipeline (regex/rules, then optional AI fallback)
- Deduplicates against existing canonical listings
- Upserts into `listings`

**Notify Worker** - PLANNED

- Matches new listings against saved filters
- Sends Telegram messages for matches not yet sent
- Records in `notifications_sent` to prevent double-sends

---

## M2 - First Live Source

**Goal:** YAD2 connector fully operational, delivering real listings to Telegram.

### Features

**YAD2 Connector** - PLANNED

- Research and implement YAD2 API/data access
- Cursor-based incremental fetching
- Normalize YAD2 fields to canonical schema

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

### Features

**Telegram Bot Commands** - PLANNED

- `/start` registration flow
- `/filter` create/edit/delete filters (city, price range, rooms, keywords)
- `/pause` / `/resume` notification control

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
