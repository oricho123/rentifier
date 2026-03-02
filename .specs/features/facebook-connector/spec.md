# Facebook Groups Connector - Specification

## Problem Statement

Facebook Groups are a primary channel for Israeli rental listings — many landlords post there instead of Yad2 because it's free. Currently, Rentifier only monitors Yad2, missing a significant portion of the market. There is no official API for accessing Facebook group posts (the Groups API was shut down April 2024).

## Goals

- [ ] Fetch new posts from statically configured Facebook groups every ~30 minutes
- [ ] Extract structured rental data (price, rooms, city) from unstructured Hebrew posts
- [ ] Support multiple Facebook account cookies for rotation
- [ ] Notify admin via Telegram when cookies expire
- [ ] Integrate with existing connector architecture (same pattern as YAD2)

## Out of Scope

- Facebook Marketplace (not accessible via mbasic.facebook.com)
- Browser automation / Playwright (mbasic doesn't need JS rendering)
- Dynamic group configuration via DB (static list for now)
- Historical post backfill

---

## User Stories

### P1: Facebook group monitoring

**User Story**: As a user, I want to receive Telegram notifications for rental listings posted in Facebook groups, so I can find apartments not listed on Yad2.

**Acceptance Criteria**:
- Posts from configured Facebook groups are fetched every 30 minutes
- Hebrew post text is parsed to extract price, rooms, city, neighborhood
- Listings pass through the same filter matching as YAD2 listings
- Dedup prevents duplicate notifications for the same post

### P2: Cookie expiry notification

**User Story**: As an admin, I want to be notified via Telegram when a Facebook cookie expires, so I can refresh it quickly.

**Acceptance Criteria**:
- When a cookie fails auth, admin receives a Telegram message
- Message identifies which account needs refreshing
- No spam — one notification per failed account per run

---

## Approach

Use `mbasic.facebook.com` (Facebook's static HTML version) with simple HTTP requests + pre-authenticated cookies. This avoids JavaScript rendering, browser fingerprinting, and most anti-bot detection. Cookies stored as GitHub Actions secrets. See design.md for details.
