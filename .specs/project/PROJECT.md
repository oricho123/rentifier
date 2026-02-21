# Rentifier

**Vision:** An automated apartment-listing aggregator for Israeli rental markets that ingests posts from multiple sources, normalizes and deduplicates them, extracts structured data, and delivers matching listings to users via Telegram.
**For:** Myself initially, expanding to multiple users in the future.
**Solves:** The pain of manually monitoring scattered rental sources (YAD2, Facebook groups/marketplace, etc.) and missing good listings.

## Goals

- Automatically collect rental listings from configured Israeli cities across multiple sources
- Deduplicate and normalize listings into a canonical schema with structured fields (price, rooms, neighborhood, tags)
- Notify users in real-time via Telegram when new listings match their saved filters
- Maintain zero-cost operation within Cloudflare's free tier for low-volume personal use

## Tech Stack

**Core:**

- Runtime: Cloudflare Workers (TypeScript)
- Database: Cloudflare D1 (serverless SQLite)
- Scheduling: Cloudflare Cron Triggers
- Notifications: Telegram Bot API

**Key dependencies:**

- Zod (schema validation)
- Wrangler (Cloudflare CLI / dev tooling)
- pnpm workspaces (monorepo management)

**Optional / Future:**

- Cloudflare Pages (web UI)
- Cloudflare KV (cursor/state caching)
- Cloudflare Workers AI or local LLM (ambiguous listing extraction)

## Scope

**v1 includes:**

- Monorepo with shared packages (types, DB, connectors, extraction)
- Collector worker: scheduled fetch from connectors with cursor-based incremental ingestion
- Processor worker: normalize, deduplicate, extract structured fields (regex/rules first, AI fallback)
- API/Notify worker: match new listings against user filters, send Telegram notifications (no double-send)
- D1 schema covering sources, listings (raw + canonical), users, filters, and notification tracking
- Connector interface with at least one implemented source (YAD2)
- Single-user Telegram notifications (hardcoded chat_id)

**Explicitly out of scope:**

- Specific connector implementations beyond the interface contract (YAD2/Facebook details are separate feature specs)
- Web UI (deferred to a later milestone)
- Multi-user auth or registration flows
- Geo-polygon / map-based filtering
- Image storage or processing
- Payment or monetization

## Constraints

- **Cost:** Must operate within Cloudflare free tier (100K requests/day, 10ms CPU/request, 5GB D1, 1GB KV)
- **Legal:** Each connector must respect the source's ToS; no unauthorized scraping
- **Solo developer:** Architecture should be maintainable by one person
- **Israeli market:** Hebrew text handling required in extraction logic
