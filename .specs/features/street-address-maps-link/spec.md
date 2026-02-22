# Feature: Street Address with Google Maps Link in Telegram Notifications

**Status:** Specified
**Created:** 2026-02-22
**Priority:** HIGH

## Problem

Telegram notifications currently show only city and neighborhood, which is insufficient for users to locate listings. YAD2 API already provides street address and house number data, but we're not capturing or displaying it.

Users need to quickly identify the exact location of a listing to assess commute time, proximity to amenities, and neighborhood familiarity.

## Solution

Add street address and house number to:
1. Database schema (new columns)
2. TypeScript types
3. YAD2 connector normalization
4. Telegram message formatter with clickable Google Maps link

## Requirements

### Functional

**FR-1: Capture Street Data**
- Add `street` (TEXT, nullable) and `house_number` (TEXT, nullable) to `listings` table
- Update YAD2 connector to extract `marker.address.street.text` and `marker.address.house.number`
- Store in database during listing ingestion

**FR-2: Display in Telegram Messages**
- Format: `📍 [Street] [HouseNumber], [Neighborhood], [City]`
- Make the address a clickable link to Google Maps
- Google Maps URL format: `https://www.google.com/maps/search/?api=1&query={encoded_address}`
- Show only available fields (handle missing street/house gracefully)

**FR-3: Fallback Behavior**
- If street is missing: show `📍 [Neighborhood], [City]` (current behavior)
- If house number is missing but street exists: show `📍 [Street], [Neighborhood], [City]`
- Always link to Google Maps if we have city (minimum requirement)

### Non-Functional

**NFR-1: Backward Compatibility**
- Existing listings without street data continue to work
- Migration is non-destructive (new nullable columns)

**NFR-2: Hebrew Text Support**
- Google Maps handles Hebrew addresses correctly (URL encoding)
- RTL display in Telegram works correctly

**NFR-3: Performance**
- No additional API calls or processing time
- Data is already available from YAD2 API

## Design Decisions

**DD-1: Store street and house_number separately**
- Rationale: Flexibility for filtering, querying, and display formatting
- Trade-off: Two columns instead of one `full_address` field

**DD-2: Use Google Maps Search API**
- Rationale: No API key required, works with approximate addresses, handles Hebrew
- Alternative considered: `geo:{lat},{lon}` using coordinates - rejected because it doesn't show address context in Maps
- URL format: `https://www.google.com/maps/search/?api=1&query={street}+{house}+{city}`

**DD-3: Make entire address text clickable**
- Rationale: Large tap target, clear affordance
- Format: `📍 <a href="...">Street HouseNumber, Neighborhood, City</a>`

## Acceptance Criteria

**AC-1: Database Migration**
- [ ] New migration file adds `street TEXT` and `house_number TEXT` to `listings` table
- [ ] Migration runs successfully on existing database
- [ ] Existing data unaffected (columns are nullable)

**AC-2: Type Updates**
- [ ] `Listing` interface includes `street?: string | null` and `houseNumber?: string | null`
- [ ] `ListingDraft` interface includes same fields
- [ ] `ListingRow` database type includes `street` and `house_number`

**AC-3: YAD2 Connector**
- [ ] `normalize()` method extracts `street` from `marker.address.street.text`
- [ ] `normalize()` method extracts `houseNumber` from `marker.address.house.number`
- [ ] Test case validates street and house number extraction

**AC-4: Message Formatter**
- [ ] When street exists: displays full address with Google Maps link
- [ ] When street missing: displays city/neighborhood only (current behavior)
- [ ] Google Maps URL correctly encodes Hebrew characters
- [ ] Link opens Google Maps in Telegram's in-app browser
- [ ] Formatted message passes HTML validation

**AC-5: End-to-End Verification**
- [ ] New listing from YAD2 with street address appears in Telegram with clickable Maps link
- [ ] Clicking link opens Google Maps to correct location
- [ ] Listings without street data still display correctly
- [ ] TypeScript compiles with 0 errors

## Scope

**In Scope:**
- Database schema changes
- Type updates
- YAD2 connector normalization
- Telegram message formatting
- Google Maps link generation

**Out of Scope:**
- Backfilling existing listings (can be done later if needed)
- Other connector types (only YAD2 for now)
- Address validation or geocoding
- Map preview images in Telegram
- Custom map provider (Waze, Apple Maps)

## Dependencies

- YAD2 API provides street and house number (already confirmed)
- Google Maps Search API (no key required)
- Existing database migration infrastructure

## Risks & Mitigation

**Risk 1: YAD2 doesn't always provide street data**
- Mitigation: Make fields nullable, implement fallback display logic
- Impact: Low - graceful degradation to current behavior

**Risk 2: Hebrew URL encoding issues**
- Mitigation: Use JavaScript `encodeURIComponent()` for proper encoding
- Impact: Low - well-understood problem with standard solution

**Risk 3: Google Maps link doesn't work in some regions**
- Mitigation: Link still shows address as plain text if Maps fails to load
- Impact: Very Low - Google Maps works globally
