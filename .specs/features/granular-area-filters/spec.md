# Granular Area Filters Specification

> **Status:** Stub — full spec to be written after `neighborhood-extraction-coverage` ships.
> **Depends on:** `.specs/features/neighborhood-extraction-coverage/spec.md` reaching its P1+P2 success criteria (≥90% Yad2, ≥70% Facebook neighborhood coverage).

## Problem Statement

Users can filter by city today but not by neighborhood, even though the database schema and match engine already support neighborhood inclusion. They also cannot exclude areas ("anywhere in Tel Aviv except Florentin"). The result is noisy notifications for users who live in one part of a city but get alerts for the entire city.

The Telegram `/filter` conversation has no neighborhood step, and no columns exist for area exclusion. `filters.neighborhoods_json` is already populated end-to-end by `bot-service.ts` and enforced by `matchesFilter()` in `notification-service.ts` — we just never ask the user for it.

## Goals

- [ ] Let users pick neighborhoods during `/filter` creation and edit, with quick-select buttons scoped to the cities they chose
- [ ] Let users exclude specific neighborhoods from a filter
- [ ] Keep the feature demo-able in Telegram alone — no web UI, no map

## Out of Scope

- Map / polygon / radius-based area selection — deferred to M6 Web UI milestone per `PROJECT.md`
- City exclusion — deferred to P3 / later iteration; initial release scopes exclusion to neighborhoods only
- Bulk import of neighborhoods from an external source
- Sub-neighborhood granularity

---

## User Stories (Outline)

### P1: Neighborhood include step in /filter ⭐ MVP

**User Story**: As a Telegram bot user creating a filter, I want to pick neighborhoods scoped to the cities I selected, so that I only get notified about listings in the areas I actually care about.

**Open questions for full spec**:
- Keyboard layout: paginated buttons per city vs. free-text input vs. hybrid (given existing hybrid text/button pattern per AD-008)
- Cap on neighborhoods per filter (storage is JSON, but UX breaks past ~10)
- "Include listings with unknown neighborhood" toggle — **user chose this as default-on per earlier clarification**; full spec defines the DB column and UI

---

### P2: Neighborhood exclusion

**User Story**: As a user, I want to exclude specific neighborhoods from a filter, so that I can say "all of Tel Aviv except the south side".

**Open questions for full spec**:
- New column `filters.exclude_neighborhoods_json` and match-engine precedence rules (exclude wins over include)
- UI: second-pass question after include step, or inline in a single step
- Interaction with the "unknown neighborhood" toggle

---

### P3: City exclusion (deferred)

Initial release excludes at neighborhood granularity only. City exclusion is additive once the neighborhood pattern is validated.

---

## Edge Cases (placeholders)

- Exclude and include lists overlap → exclude wins
- Neighborhood selected for a city that is then removed from the filter → warn and drop
- Listing has a neighborhood not in any known list (new/renamed area) → honors "include unknown" toggle

---

## Success Criteria (placeholders)

- [ ] Users can create a filter with neighborhoods in ≤3 additional taps over today's flow
- [ ] Zero regressions in existing match-engine tests (37 passing today)
- [ ] Neighborhood-scoped filters show measurably fewer notifications per user than city-only filters (observable via notify worker logs)

---

## Hard Dependency

This feature MUST NOT ship until `neighborhood-extraction-coverage` has hit its P1+P2 coverage targets in production, otherwise users who set neighborhood filters will silently miss valid listings whose neighborhood the extractor failed to resolve.
