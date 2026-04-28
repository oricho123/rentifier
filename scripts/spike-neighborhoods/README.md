# Spike: Neighborhood Resolver Strategy

Time-boxed spike to decide between two resolver strategies for `neighborhood-extraction-coverage`:

- **Strategy A** — Offline OSM polygons + point-in-polygon inside the Worker
- **Strategy B** — Live geocode (GovMap primary, Nominatim fallback) + D1 write-through cache

See spec: `.specs/features/neighborhood-extraction-coverage/spec.md` (P0 story).

## What this directory contains

| File | Purpose |
|---|---|
| `sample-listings.ts` | Pulls a stratified 100-listing sample from production D1 → `sample.json` |
| `baseline.ts` | Measures the current `neighborhood` non-null rate per source over last 30 days |
| `resolvers/osm-polygons.ts` | Strategy A resolver — fetches OSM polygons via Overpass, runs ray-casting PIP |
| `resolvers/nominatim.ts` | Strategy B fallback — public Nominatim reverse/forward geocoding |
| `resolvers/govmap.ts` | Strategy B primary — **STUB**, endpoint details TBD (see inline TODOs) |
| `run-spike.ts` | Orchestrator: runs all resolvers against the sample, writes `results.csv` + `spike-results.md` |
| `pip.ts` | Minimal ray-casting point-in-polygon implementation (no external deps) |

## Run it

```bash
# 1. Measure current baseline (for the success-criteria denominator)
pnpm tsx --env-file=.env scripts/spike-neighborhoods/baseline.ts

# 2. Pull the stratified 100-listing sample from production D1
pnpm tsx --env-file=.env scripts/spike-neighborhoods/sample-listings.ts

# 3. Run all resolvers against the sample and produce the report
pnpm tsx --env-file=.env scripts/spike-neighborhoods/run-spike.ts
```

Outputs are written to `scripts/spike-neighborhoods/out/`:

- `baseline.json` — current non-null rate per source
- `sample.json` — the 100 listings used for the spike (stable across runs)
- `results.csv` — per-listing × per-strategy resolver output (raw provider name, canonical-aligned, latency ms, status)
- `spike-results.md` — the decision memo to commit to `.specs/features/neighborhood-extraction-coverage/spike-results.md`

## GovMap is a stub — why

GovMap (`govmap.gov.il`) has an undocumented API. Rather than invent endpoints, `resolvers/govmap.ts` contains a fully-wired contract with `TODO` markers for: request URL, auth/cookie handling, request body shape, and response parsing. Fill in based on DevTools inspection of a live search and it slots into `run-spike.ts` with no other changes.

Nominatim is fully implemented so the spike is runnable end-to-end today — GovMap numbers can be added later and appended to `spike-results.md`.

## Decision rule (from the spec)

Pick the strategy with **≥80% hit rate AND ≥70% canonical-name alignment**. If both qualify, pick the simpler (live + cache). If neither, escalate to a hybrid proposal in the results memo.

The orchestrator computes these metrics automatically and drafts the memo skeleton; you fill in the final choice + AD.

## What gets committed

- `spike-results.md` → `.specs/features/neighborhood-extraction-coverage/spike-results.md`
- `sample.json` and `results.csv` → same directory, as evidence
- A new AD in `.specs/project/STATE.md` referencing the chosen strategy

Everything under `scripts/spike-neighborhoods/out/` should be gitignored until you're ready to commit the evidence files; the scripts themselves stay in the repo.
