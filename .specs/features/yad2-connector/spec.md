# Yad2 Connector — Specification

## Overview

Implement a Yad2 rental listings connector that fetches apartment listings from the Yad2 real estate API, maps them to our `ListingCandidate` schema, and normalizes them into `ListingDraft` records. The connector must handle API instability gracefully with retry logic, captcha detection, and circuit-breaker behavior.

## Background

Yad2 (yad2.co.il) is Israel's largest classified ads platform. Their real estate section exposes a gateway API at `gw.yad2.co.il` that returns structured listing data (price, rooms, address, coordinates). This API is not officially documented and is protected by Radware Bot Manager which may serve captcha challenges instead of data.

### Known API Details (from existing Python scraper)

- **Base URL:** `https://gw.yad2.co.il/realestate-feed/rent/map` (rental; the existing scraper used `/forsale/map` for sales)
- **Method:** GET with query parameters
- **Headers required:** Must include `Origin: https://www.yad2.co.il`, `Referer: https://www.yad2.co.il/`, and a realistic `User-Agent`
- **Response format:** JSON with `data.markers[]` array containing listing objects
- **Listing fields:** `orderId`, `token`, `price`, `address` (city/neighborhood/street), `additionalDetails` (roomsCount, squareMeter, property type), `metaData` (images, coverImage)
- **Listing URL pattern:** `https://www.yad2.co.il/realestate/item/{token}`
- **Pagination:** The map endpoint may not have traditional cursor-based pagination; it returns all markers within the query bounds. Incremental fetching will use `orderId`-based dedup and time-based cursoring.
- **Rate limiting:** Minimum 1 second between requests recommended
- **Captcha:** Radware Bot Manager Captcha — detectable by checking for `"Radware Bot Manager Captcha"` in non-JSON responses

## Requirements

### Functional

1. **Fetch rental listings** from configured Israeli cities via the Yad2 gateway API
2. **Incremental fetching** — only fetch listings newer than the last successful run (cursor stored in `source_state`)
3. **Map Yad2 response** to `ListingCandidate` objects with structured `sourceData`
4. **Normalize** Yad2 fields to `ListingDraft` — price, rooms, city, neighborhood extracted from structured API fields (not text parsing)
5. **Deduplicate** via `orderId` as `sourceItemId` — the collector's existing `ON CONFLICT` handles DB-level dedup
6. **Register** as `'yad2'` in the connector registry and `sources` table

### Non-Functional

7. **Retry with exponential backoff** — retry transient failures (HTTP 5xx, network timeouts) up to 3 times with increasing delays
8. **Captcha detection** — detect Radware captcha responses and abort the fetch cycle immediately (do not retry captcha)
9. **Circuit breaker** — after N consecutive failures, skip the source for a cooldown period (stored in `source_state`). Prevents wasting CPU budget on a persistently unavailable API.
10. **Request timeout** — 10 second timeout per HTTP request (Cloudflare Workers have 30s wall-clock limit)
11. **Rate limiting** — minimum 1 second delay between API requests (relevant if fetching multiple city pages)
12. **Structured logging** — log fetch attempts, successes, failures, captcha events, and circuit breaker state as JSON

### Configuration

13. **Cities to fetch** — configurable list of Yad2 city codes to scrape (initially hardcoded, later from env/config)
14. **Source seed migration** — add `'yad2'` to the `sources` table via a new migration

## Out of Scope

- Fetching individual listing detail pages (we use the map/feed endpoint data only)
- Image downloading or processing
- Sale listings (this connector is rental-only)
- Proxy rotation or anti-bot evasion beyond standard headers
- Yad2 user authentication

## Constraints

- Must run within Cloudflare Workers (no Node.js-specific APIs — use `fetch`, no `axios`/`node-fetch`)
- Must stay within 10ms CPU / 30s wall-clock per invocation on free tier
- All state must be stored in D1 (no local filesystem, no external cache)
- Hebrew text in responses must be preserved correctly (UTF-8)

## Success Criteria

- Connector fetches real rental listings from at least one configured city
- Listings appear in `listings_raw` with complete `raw_json` (full `ListingCandidate`)
- Processor successfully normalizes Yad2 listings into canonical `listings` table
- Circuit breaker prevents repeated calls when API is down
- Captcha responses are detected and logged without crashing the worker
