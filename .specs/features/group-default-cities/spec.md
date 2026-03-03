# Feature: Group Default Cities

## Problem

Three related issues with city/neighborhood extraction from Facebook posts:

### P1: Substring false positives in neighborhood matching
The extraction uses `text.includes(variant)` which matches substrings inside words. "נהדר" (wonderful) contains "הדר" (Hadar, Haifa neighborhood), causing false city assignment. Real example: "דירה במצב נהדר" → wrongly matches הדר → infers city חיפה.

### P2: Missing neighborhoods
"התקווה" / "שכונת התקווה" (HaTikva) is a well-known Tel Aviv neighborhood but is not in CITY_NEIGHBORHOODS. Posts mentioning it get no neighborhood match and no city inference.

### P3: No group context for city defaults
Facebook group posts often don't mention the city explicitly. A post in "דירות להשכרה בתל אביב" saying "3 חדרים, 7500 ש״ח" doesn't mention Tel Aviv — it's implied by the group context. The extraction pipeline has no awareness of which group a post came from, so the listing gets `city: null`.

Since all 3 currently monitored groups are Tel Aviv groups, most posts should default to תל אביב when no city is explicitly mentioned.

## Requirements

### R0: Word boundary checks for neighborhood/city matching
Short Hebrew names (e.g., "הדר", "יפו") must not match as substrings of longer words. Use word-boundary-aware matching: check that the character before/after the match is a space, punctuation, or string boundary. This fixes P1.

### R0b: Add missing neighborhoods
Add "התקווה" / "שכונת התקווה" (HaTikva) to Tel Aviv neighborhoods. Review and add other common missing neighborhoods.

### R1: Group-level default cities
Each monitored Facebook group should have a list of default cities (1 or more). When the text extraction finds no city, the first city in the list is used as the default.

### R2: Multi-city groups
Some groups cover multiple cities (e.g., "דירות להשכרה במרכז" covers Tel Aviv, Ramat Gan, Givatayim, etc.). The config should support a list of cities per group. The first city is the primary default; the full list can be used for validation/filtering in the future.

### R3: Extraction priority
The default city should only apply when text-based extraction finds NO city. If the post explicitly mentions a city (even a different one), that should take priority. Priority order:
1. City explicitly mentioned in post text (extraction confidence 0.8+)
2. City inferred from neighborhood reverse-lookup (confidence 0.85)
3. Group default city (new — confidence 0.6)

### R4: Neighborhood resolution with default city
When a default city is applied, the system should also attempt to match neighborhoods within that city's known neighborhoods. Example: post says "בפלורנטין" with no city → default city is תל אביב → check if פלורנטין is a known Tel Aviv neighborhood → set both city and neighborhood.

### R5: Minimal changes
- No database migration — group config stays in code (MONITORED_GROUPS constant)
- No new env vars
- Changes scoped to: constants config, normalizer, and extraction flow

## Non-goals

- Database-driven group configuration (future, when we have a management UI)
- Automatic city detection from group name (fragile, not worth the complexity)
- Changing how YAD2 city extraction works (YAD2 API provides structured city data)

## Acceptance Criteria

- [ ] "נהדר" does NOT match "הדר" neighborhood (word boundary check)
- [ ] "שכונת התקווה" matches התקווה neighborhood in Tel Aviv
- [ ] MONITORED_GROUPS includes a `defaultCities` field per group
- [ ] A Facebook post with no city mention in a Tel Aviv group gets `city: "תל אביב"`
- [ ] A Facebook post that explicitly mentions חיפה in a Tel Aviv group keeps `city: "חיפה"`
- [ ] A Facebook post mentioning only "פלורנטין" in a Tel Aviv group gets both `city: "תל אביב"` and `neighborhood: "פלורנטין"`
- [ ] Unit tests cover all scenarios (substring false positives, missing neighborhoods, group defaults)
- [ ] Existing tests remain passing
