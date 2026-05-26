# Neighborhood Extraction Coverage Specification

## Problem Statement

`listings.neighborhood` is null for a large share of our canonical listings because today's extractor only matches text against a hand-curated Hebrew neighborhood dictionary (`CITY_NEIGHBORHOODS` in `@rentifier/extraction`). The field is missed whenever a post says "Rothschild 47, Tel Aviv" without naming the neighborhood, which is most Yad2 listings and a majority of Facebook posts. We already collect two signals that would fill the gap — exact `latitude`/`longitude` on every Yad2 listing (from the map API), and `street`/`city` on many Facebook listings — but we don't use them. The downstream cost is poor notification context, weaker duplicate detection, and a neighborhood-based filter UX we can't ship until coverage is healthy.

## Goals

- [ ] Lift `listings.neighborhood` non-null rate to **≥90% for Yad2 listings** and **≥70% for Facebook listings** across the top 10 M3 cities, measured over a 7-day production window
- [ ] Keep per-listing resolution cost negligible at steady state — either zero external calls (offline polygons) or cache-hit dominated with a strict per-batch external-call budget (live geocode + cache). Exact mechanism decided by the P0 spike.
- [ ] Record per-listing provenance via a `neighborhood_source` column (values include `regex`, `ai`, and strategy-specific tags such as `coords_polygon`/`coords_live`/`street_polygon`/`street_live`) so we can measure coverage, audit accuracy, and re-run backfills selectively
- [ ] Backfill at least the last 90 days of canonical listings with the new extraction

## Out of Scope

- Any UI changes to the Telegram bot — filter-side changes are in the sibling feature `granular-area-filters`
- Interactive geospatial queries at request time (no user-facing "find listings within radius" endpoints in this feature)
- Building our own neighborhood polygon editor / admin UI
- Sub-neighborhood ("shchuna kta") granularity — one canonical neighborhood per listing
- Non-Israeli geographies

---

## Resolution Strategy — Open Decision

Two viable architectures have been identified. The P0 spike below picks between them (or a hybrid) *before* P1 implementation begins. The rest of the user stories are written in **strategy-agnostic** language so they apply regardless of which resolver wins.

| Strategy | Mechanism | Pros | Cons |
|---|---|---|---|
| **A. Offline polygons** | Bundle neighborhood GeoJSON (OSM Overpass export) for top 10 M3 cities; run point-in-polygon in the Worker | Zero runtime cost, deterministic, no external dep, no rate limit | Asset curation burden, polygons drift, separate path needed for no-coords (Facebook) |
| **B. Live geocode + write-through cache** | On miss, call GovMap (primary) or Nominatim (fallback); cache `(coord_rounded)` and `(street, city)` in D1; cache hits thereafter | Handles both coords and street+city with one code path; no curated dataset; always current | External dep, rate limits, upstream name-space may not match our `CITY_NEIGHBORHOODS` vocabulary |

A spike is required because the deciding variable — Hebrew-name alignment between the chosen provider and our existing filter vocabulary — cannot be predicted without measurement.

---

## User Stories

### P0: Resolution-strategy spike & decision ⭐ GATE

**User Story**: As the engineering owner, I want a time-boxed spike that measures the two candidate resolvers on real production listings, so that P1 is built on evidence rather than a reflexive architecture bet.

**Why P0**: Committing to polygons-vs-live-lookup without data is guessing. A 1-2 hour spike closes the question cheaply and the losing path becomes the P3 contingency rather than dead work.

**Acceptance Criteria**:

1. WHEN the spike runs THEN it SHALL sample **100 real production listings** stratified as: 50 Yad2 in top-3 cities (TLV/JLM/Haifa), 20 Yad2 in other M3 cities (Herzliya/Ramat Gan/Netanya/etc.), 20 Facebook with `street` + `city` but no coords, 10 edge cases (coords on city borders, new-development areas, non-M3 cities)
2. WHEN the spike evaluates **Strategy A** THEN it SHALL export a small OSM polygon bundle for the top 3 cities via Overpass and run an offline point-in-polygon pass
3. WHEN the spike evaluates **Strategy B** THEN it SHALL issue live reverse-geocode calls to GovMap as primary and Nominatim as fallback, measuring both providers separately
4. The spike SHALL record the following per-strategy metrics:
   - **Hit rate**: % of the 100 listings where the strategy returned a non-null neighborhood
   - **Canonical-name alignment**: % of hits whose raw provider output is already a key in `CITY_NEIGHBORHOODS` (i.e., no manual alias work needed)
   - **Latency**: p50 and p95 lookup time (cache-cold for Strategy B)
   - **Failure modes**: categorized count of misses (out-of-coverage, ambiguous, provider error, timeout)
5. The spike output SHALL be committed as `.specs/features/neighborhood-extraction-coverage/spike-results.md` with the raw 100-row CSV attached or linked
6. A decision rule SHALL be applied: pick the strategy with ≥80% hit rate AND ≥70% canonical-name alignment; if both qualify, pick the simpler (live + cache); if neither qualifies, escalate to a hybrid proposal in the results memo
7. The decision SHALL be recorded as a new AD in `.specs/project/STATE.md` before P1 begins

**Independent Test**: Reviewer can read `spike-results.md`, see the 100-row table, reproduce the metrics from raw data, and verify the decision rule was applied correctly. Spike is "done" when the AD referencing the chosen strategy is merged.

---

### P1: Neighborhood resolution for listings with coordinates ⭐ MVP

**User Story**: As the processor pipeline, I want to resolve a listing's neighborhood from its `(latitude, longitude)` when the regex extractor returned null, so that Yad2 listings (our highest-volume source, all with coords) are consistently tagged with a canonical Hebrew neighborhood name.

**Why P1**: Yad2 already provides exact coordinates for every listing. Whatever strategy P0 selects (polygons or live+cache), coord-based resolution is the highest-volume win and most reliable signal.

**Acceptance Criteria** (strategy-agnostic):

1. WHEN a canonical listing is produced with `latitude` and `longitude` set and `neighborhood` null THEN the processor SHALL attempt resolution via the strategy chosen in P0
2. WHEN the resolver returns a named neighborhood THEN the processor SHALL normalize it via `CITY_NEIGHBORHOODS` and set `listing.neighborhood` to the canonical Hebrew form
3. WHEN the resolved neighborhood is **not** a known canonical/variant key THEN the processor SHALL store the raw provider output in `listing.neighborhood` verbatim AND log it for later inclusion in the variant dictionary (alias-learning)
4. WHEN the resolver returns no match THEN the processor SHALL leave `neighborhood` null and set `neighborhood_source = null`
5. `neighborhood_source` SHALL take the value of the winning strategy (`'coords_polygon'`, `'coords_live'`, or future variants)
6. WHEN the regex extractor already returned a non-null neighborhood THEN this step SHALL be skipped and `neighborhood_source = 'regex'` SHALL be recorded
7. Amortized resolution SHALL add no more than **10 ms per listing** to processor CPU time (cache-warm for Strategy B)
8. For Strategy B specifically: resolver calls SHALL use a shared KV-backed rate limiter (≤1 req/sec to public Nominatim; provider-appropriate for GovMap) and SHALL be capped at a per-batch budget (default 50) so cold caches can't blow the Worker CPU budget — overflow listings defer to the next run

**Independent Test**: Run the processor against a batch of 20 Yad2 candidates with known coords spanning 5 TLV neighborhoods; verify ≥18 get the correct neighborhood name and `neighborhood_source` equals the P0-chosen tag. Verify a coord outside Israel yields null.

---

### P2: Neighborhood resolution for listings with street+city but no coordinates

**User Story**: As the processor pipeline, I want to resolve a listing's neighborhood from its `(street, city)` when coordinates are unavailable, so that Facebook listings still get neighborhood attribution.

**Why P2**: Facebook is our second source and has no coords. Street names are extracted today but not leveraged for area attribution.

**Acceptance Criteria** (strategy-agnostic):

1. WHEN a canonical listing has `neighborhood` null, `latitude`/`longitude` null, and non-null `street` + `city` THEN the processor SHALL attempt street-based resolution via the P0-chosen strategy
2. For **Strategy A**: a precomputed `street × city → neighborhood` lookup table SHALL be built offline from the same polygon dataset + OSM street centerlines, committed to `packages/extraction/data/`, and queried at runtime with normalized street names (Hebrew prefixes `רחוב`/`רח'`/`שדרות`/`שד'` stripped)
3. For **Strategy B**: the same live-geocode + cache mechanism from P1 SHALL be used with forward-geocode input (`"{street} {house_number}, {city}, Israel"`); the cache key SHALL be `(street_normalized, city, house_number)`
4. WHEN a street is ambiguous (spans multiple neighborhoods in the city and no house number is available) THEN the processor SHALL leave `neighborhood` null and log `ambiguous_street`
5. Name normalization (canonical-form storage, alias logging) SHALL match the rules defined in P1 AC #2 and #3
6. `neighborhood_source` SHALL take the value `'street_polygon'` or `'street_live'` matching P0

**Independent Test**: Feed 15 Facebook candidate listings (synthetic) with street + city but no coords spanning 3 TLV neighborhoods; verify ≥12 resolve correctly and the remainder log `ambiguous_street` or `unknown_street`.

---

### P3: Contingency / fallback for the strategy *not* chosen in P0

**User Story**: As the processor pipeline, I want the losing P0 strategy available as an opt-in fallback for listings the primary path misses, so that edge cases (out-of-coverage coords, rate-limited batches, new developments) still get best-effort attribution.

**Why P3**: Small tail of volume, not required to hit the success criteria. Kept out of P1 to bound scope; available if in production the chosen strategy leaves visible gaps.

**Acceptance Criteria**:

1. WHEN the primary strategy returns null AND `NEIGHBORHOOD_FALLBACK_ENABLED` env flag is true THEN the processor SHALL attempt the fallback strategy
2. WHEN the fallback succeeds THEN `neighborhood_source` SHALL be recorded with a distinct tag (e.g., `'coords_live_fallback'`) so fallback-reliance is observable
3. Fallback SHALL be OFF by default in wrangler config — enabling it is a conscious operational decision based on production coverage metrics
4. Fallback SHALL respect the same rate-limit and batch-budget constraints as P1

**Independent Test**: With the flag enabled and the primary strategy forced to return null (mock), send 3 listings spanning Yad2 coords and Facebook street+city; verify the fallback resolves at least 1 and all three produce a defined `neighborhood_source` (including null).

---

### P1b: Historical backfill

**User Story**: As an operator, I want a one-shot backfill script that reruns neighborhood attribution on existing listings, so that the coverage improvement applies retroactively to listings already notified or queryable.

**Why P1b**: Without a backfill, the feature only improves listings ingested after deploy. Users see a mixed historical view in `/list` or future web UI.

**Acceptance Criteria**:

1. WHEN `scripts/backfill-neighborhoods.ts` is run with `--since=YYYY-MM-DD` THEN it SHALL iterate listings ingested on or after that date where `neighborhood` is null
2. WHEN the script processes a listing THEN it SHALL apply the P1 (and P2 if applicable) attribution steps and update `listings.neighborhood` + `listings.neighborhood_source` in place
3. WHEN a row is updated THEN the script SHALL **NOT** trigger a new notification (notifications are gated by `notifications_sent` which already contains the row if previously matched)
4. The script SHALL support `--dry-run` mode that prints counts without writing
5. The script SHALL print a summary: total scanned, filled via coords, filled via street, still null

**Independent Test**: On a local D1 snapshot, run with `--dry-run --since=2026-01-01`; confirm the summary counts are non-zero and no writes occurred. Run without `--dry-run` and verify `SELECT neighborhood_source, COUNT(*) FROM listings GROUP BY 1` shows the new distribution.

---

## Edge Cases

- WHEN a listing has `(latitude, longitude) = (0, 0)` THEN the processor SHALL treat it as missing and skip coords lookup (Yad2 returns 0/0 as "unknown"; see connector.test.ts)
- WHEN a point falls exactly on a polygon boundary THEN the point-in-polygon implementation SHALL use a consistent tie-break (e.g., include left/bottom edge) to stay deterministic
- WHEN the listing's `city` normalizes to a different city than the polygon's owning city (e.g., `city = "Bat Yam"` but coord is in TLV/Jaffa) THEN the processor SHALL **trust the coord-resolved neighborhood** and log a `city_coord_mismatch` warning for review
- WHEN the polygon dataset is updated between deploys THEN backfill SHALL be re-runnable and idempotent
- WHEN two cities share a neighborhood name (e.g., "מרכז העיר" appears in many cities) THEN the canonical storage SHALL remain the simple neighborhood name (join key is `(city, neighborhood)` for filters) — no city prefix in the neighborhood field itself
- WHEN the street-lookup build encounters a street that does not cross any neighborhood polygon (e.g., highway shoulder) THEN the build SHALL omit it, not emit null

---

## Success Criteria

- [ ] Over a 7-day window after deploy, Yad2 listings with non-null `neighborhood` ≥ 90% (baseline to be measured in the design phase; expected current baseline ~40-55%)
- [ ] Facebook listings with non-null `neighborhood` ≥ 70% over the same window (baseline expected ~15-25%)
- [ ] Amortized per-listing resolution cost ≤10 ms (cache-warm if Strategy B)
- [ ] Neighborhood source distribution observable via a simple SQL query (`SELECT neighborhood_source, COUNT(*) FROM listings WHERE ingested_at > ?`)
- [ ] Backfill completes on the last 90 days of production data without downtime — target under 10 minutes for Strategy A; weekend-scale (cron-paced) for cold-cache Strategy B is acceptable
- [ ] If Strategy B wins: per-batch external-call budget never exceeded in production (observable via processor metrics)

---

## Dependencies / Prerequisites

**Unconditional:**

- Schema migration: `ALTER TABLE listings ADD COLUMN neighborhood_source TEXT` (new migration)
- Canonical neighborhood name registry: reuse and extend `CITY_NEIGHBORHOODS` variant map; alias-learning log surface (simple SQL-queryable table or log line) so unknown provider outputs can be reviewed and added to the variant dictionary over time
- Baseline measurement before implementation begins: current `neighborhood` non-null rate per source over the last 30 days, committed alongside `spike-results.md` so success criteria have a real denominator

**Conditional on P0 spike outcome — Strategy A wins:**

- New package path `packages/extraction/data/neighborhoods/` hosting bundled GeoJSON polygons and a precomputed street × city JSON (design phase decides inline-import vs R2 vs KV given Workers bundle budget)
- OSM Overpass export pipeline: `place=suburb` + `place=neighbourhood` + `admin_level=10` boundaries for the top 10 M3 cities
- Point-in-polygon implementation small enough for Workers bundle — candidates include a ~2KB inlined ray-casting implementation (preferred over `@turf/boolean-point-in-polygon` which pulls a lot)

**Conditional on P0 spike outcome — Strategy B wins:**

- New D1 table `neighborhood_cache` keyed by `(lat_rounded_5dp, lng_rounded_5dp)` for coords lookups and `(street_normalized, city, house_number)` for street lookups, with columns for raw provider output, canonical name, provider, resolved_at
- Provider adapters: GovMap primary (undocumented API — needs small reverse-engineering effort during the spike), Nominatim fallback (well-documented, requires descriptive `User-Agent` per usage policy)
- KV-backed token bucket for rate limiting (1 req/sec for public Nominatim; GovMap terms TBD in the spike)
- Backfill script awareness: cold cache + 1 req/sec ≈ ~22 hours for 80k listings worst case, amortized over a weekend cron

---

## Related

- Sibling feature: `.specs/features/granular-area-filters/spec.md` — consumes this feature's improved coverage
- Prior work on extraction: `.specs/features/ai-extraction/` (AD-022 AI hardening)
- Project constraint: PROJECT.md — "Geo-polygon / map-based filtering" out of scope for v1 user-facing UI; this feature uses polygons *internally only*
