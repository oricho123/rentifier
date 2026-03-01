# YAD2 Listing Recency - Specification

## Problem Statement

The YAD2 map API (`/realestate-feed/rent/map`) returns up to 200 markers per city with no date fields. This means old, stale listings get ingested alongside fresh ones, and users receive notifications for apartments that may have been rented out weeks ago. There's no way to distinguish a listing posted today from one posted a month ago.

## Goals

- [ ] Filter out old/stale YAD2 listings so users only get notified about recent ones
- [ ] Extract approximate listing age from available data (orderId, image URLs)
- [ ] Provide a configurable recency threshold

## Out of Scope

- Switching to a different YAD2 API endpoint (the map endpoint is the only one that bypasses Radware)
- Scraping individual listing detail pages for exact dates
- Historical date backfill for existing listings

---

## User Stories

### P1: orderId-based recency filtering

**User Story**: As a user, I want to only receive notifications for recent listings so that I don't waste time on apartments already taken.

**Why P1**: The orderId is sequential (higher = newer), always present, and requires no external parsing. This is the most reliable signal.

**Acceptance Criteria**:

1. WHEN a new batch of markers is fetched THEN the system SHALL record the highest orderId seen per city
2. WHEN processing markers THEN the system SHALL skip markers whose orderId is below a configurable recency threshold
3. WHEN the system starts fresh (no prior state) THEN it SHALL accept all markers from the first fetch and establish the baseline orderId
4. WHEN a marker's orderId is above the threshold THEN it SHALL be processed normally through the pipeline

**Independent Test**: Fetch listings, verify only markers with orderId above threshold are converted to candidates.

---

### P2: Image URL date extraction

**User Story**: As a system operator, I want to extract the listing creation date from image URLs so that I have a more precise date for display and filtering.

**Why P2**: Image URLs contain upload timestamps (e.g. `y2_1pa_010164_20260228202920.jpeg` → 2026-02-28 20:29:20). This gives actual dates but depends on URL format stability and not all listings have images.

**Acceptance Criteria**:

1. WHEN a marker has a coverImage URL THEN the system SHALL attempt to extract the date from the URL path
2. WHEN the date is successfully extracted THEN it SHALL be used as `rawPostedAt` on the ListingCandidate
3. WHEN the URL format doesn't match the expected pattern THEN the system SHALL fall back to null (no date) without errors
4. WHEN `rawPostedAt` is populated THEN notifications SHALL display the listing age

**Independent Test**: Parse known image URLs, verify correct date extraction. Verify graceful fallback on unknown formats.

---

### P3: Listing age display in notifications

**User Story**: As a user, I want to see how old a listing is in the notification so I can prioritize fresher ones.

**Why P3**: Nice context but not critical — the main value is filtering, not display.

**Acceptance Criteria**:

1. WHEN a listing has a `posted_at` date THEN the notification message SHALL include relative age (e.g. "2 days ago")

---

## Edge Cases

- WHEN all markers in a city have orderIds below the threshold THEN the system SHALL return zero candidates (not crash)
- WHEN orderId values are not strictly sequential (gaps exist) THEN the threshold SHALL still work correctly (it's a minimum, not sequential)
- WHEN an image URL has an unexpected format THEN date extraction SHALL return null gracefully
- WHEN a listing has no images THEN the system SHALL skip image date extraction and rely on orderId only

---

## Technical Notes

### orderId observations
- orderIds are numeric and roughly sequential (e.g. 49352852 vs 55788702)
- Higher orderId = more recently posted
- Not strictly sequential — gaps exist between IDs

### Image URL date format
- Pattern: `https://img.yad2.co.il/Pic/YYYYMM/DD/.../y2_*_YYYYMMDDHHMMSS.jpeg`
- Example: `y2_1pa_010164_20260228202920.jpeg` → 2026-02-28 at 20:29:20
- This is the image upload date, which closely approximates the listing creation date

---

## Success Criteria

- [ ] Users only receive notifications for listings posted within a configurable time window
- [ ] Zero false negatives on genuinely new listings
- [ ] No performance regression in the collector pipeline
