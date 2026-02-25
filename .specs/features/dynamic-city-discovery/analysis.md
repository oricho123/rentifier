# Dynamic City Code Discovery - Analysis

**Date:** 2026-02-25
**Context:** M2 completion revealed that all city codes are currently hardcoded. Exploring options for dynamic discovery.

---

## Problem Statement

**Current approach limitations:**
- City codes hardcoded in constants.ts
- Manual SQL inserts required to add new cities
- No automatic discovery of new cities YAD2 adds
- Doesn't scale for multi-user city preferences

**YAD2 API constraints:**
- Max 200 results per request
- Requires city code parameter for effective filtering
- No discovered metadata/cities endpoint

---

## Discovery Attempts

### Attempt 1: Cities API Endpoint
```bash
GET https://gw.yad2.co.il/realestate-feed/rent/cities
Result: 404 - Cannot GET /rent/cities
```

### Attempt 2: Metadata Endpoint
```bash
GET https://gw.yad2.co.il/metadata/cities
Result: 404 page
```

**Conclusion:** YAD2 does not expose a public cities metadata API.

---

## Alternative Approaches

### Option 1: Extract from YAD2 Frontend
**Method:** Scrape city dropdown from www.yad2.co.il rent search page

**Pros:**
- Gets official YAD2 city list with codes
- Would stay in sync with YAD2's data
- One-time fetch to populate database

**Cons:**
- Scraping HTML is fragile (changes break it)
- May violate YAD2 ToS
- Requires maintenance when frontend changes
- Anti-bot protection (Radware) may block

**Implementation:**
- Fetch https://www.yad2.co.il/realestate/rent
- Parse city dropdown options
- Extract (city_name, city_code) pairs
- Bulk insert into monitored_cities

### Option 2: Reverse-Engineer from Map API Responses
**Method:** Infer city codes by analyzing listing addresses

**Pros:**
- Uses existing legitimate API access
- No additional scraping needed
- Passive discovery

**Cons:**
- Slow (requires many API calls)
- Incomplete (only discovers cities with active listings)
- Complex logic to map address.city.text → city_code
- May discover incorrect codes

**Implementation:**
- Track unique (city_name, city_code) from listing responses
- Store in a discovery table
- Admin reviews and promotes to monitored_cities

### Option 3: Maintain Static Mapping with Periodic Updates
**Method:** Keep hardcoded list, update manually/semi-automatically

**Pros:**
- Simple and reliable
- Full control over monitored cities
- No API dependencies
- No ToS concerns

**Cons:**
- Manual maintenance required
- May lag behind YAD2 additions
- Doesn't scale to user-driven city selection

**Implementation:**
- Keep current approach
- Add admin script to bulk-load from CSV/JSON
- Document where to find city codes (YAD2 URL params)

### Option 4: User-Provided City Codes
**Method:** Let users find and input city codes themselves

**Pros:**
- No scraping or reverse-engineering
- Users know what they want
- Scalable to any YAD2 city

**Cons:**
- Poor UX (users must find codes)
- Error-prone (invalid codes)
- Requires validation

**Implementation:**
- Telegram command: `/addcity <name> <code>`
- Validate by test-fetching from YAD2
- Store if valid

---

## Recommendation

**Hybrid Approach: Static Mapping + Optional User Input**

1. **Maintain curated static list** for common cities (current approach)
   - 10-20 major Israeli cities
   - Updated manually when YAD2 adds new cities
   - Stored in constants.ts for reference
   - Seeded via migration for production

2. **Add admin utility** for bulk import from CSV
   ```bash
   pnpm city:import cities.csv
   ```
   Format: `city_name,city_code,priority`

3. **Optional: Add `/addcity` Telegram command** (M4 or later)
   - Power users can add niche cities
   - Validates code by test-fetching
   - Requires admin approval or auto-enables after verification

4. **Document how to find city codes** in README
   - Inspect YAD2 search URL parameters
   - Example: `https://www.yad2.co.il/realestate/rent?city=5000`

---

## Implementation Priority

**Not urgent for M2/M3:**
- Current 3-city seed is sufficient for initial deployment
- Manual SQL inserts work for adding cities
- Can revisit when scaling to multi-user with diverse locations

**Consider for M4:**
- If users request cities not in default list
- If YAD2 adds new cities to their platform
- If we want self-service city management

---

## Decision

**Defer dynamic discovery to M4 or later.**

**Rationale:**
- Current static approach works well for MVP
- No clear, reliable dynamic discovery method available
- Adding complexity now would delay M2 completion
- Can easily add cities manually as needed

**Action items:**
- Document city code discovery process in README ✅ (done in M2)
- Keep hardcoded list in constants.ts for reference
- Revisit if scaling demands it
