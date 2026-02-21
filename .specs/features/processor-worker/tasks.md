# Processor Worker - Task Breakdown

**Feature**: Processor Worker (Cron-triggered listing normalization and extraction)
**Spec**: `/Users/orila/Development/rentifier/.specs/features/processor-worker/spec.md`
**Design**: `/Users/orila/Development/rentifier/.specs/features/processor-worker/design.md`

---

## Execution Plan

### Phase 1: Database Layer (Sequential)
T1 → T2 → T3

### Phase 2: Core Services (Parallel after Phase 1)
T4, T5, T6 [P]

### Phase 3: Pipeline Integration (Sequential after Phase 2)
T7 → T8

### Phase 4: Worker Entry Point (Sequential after Phase 3)
T9 → T10

### Phase 5: Configuration & Testing (Parallel after Phase 4)
T11, T12 [P]

---

## Tasks

### T1: Create unprocessed raw listings query

**What**: SQL query helper function to find raw listings not yet in canonical table
**Where**: `packages/db/src/queries/listings-raw.ts`
**Depends on**: None
**Done when**:
- [ ] Function `findUnprocessedRaw(db: D1Database, limit: number): Promise<RawListing[]>` exported
- [ ] Uses LEFT JOIN anti-pattern: `listings_raw` LEFT JOIN `listings` WHERE `listings.id IS NULL`
- [ ] Accepts configurable LIMIT parameter
- [ ] Returns array of `{ source_id, source_item_id, url, raw_json, fetched_at }`
**Verify**: Unit test with mock D1 — insert 3 raw, 1 canonical → expect 2 returned

---

### T2: Create canonical listing upsert query

**What**: SQL query helper function to upsert into listings table with conflict resolution
**Where**: `packages/db/src/queries/listings.ts`
**Depends on**: None
**Done when**:
- [ ] Function `upsertListing(db: D1Database, draft: ListingDraft): Promise<void>` exported
- [ ] Uses `INSERT ... ON CONFLICT(source_id, source_item_id) DO UPDATE`
- [ ] Sets `ingested_at = CURRENT_TIMESTAMP` only on INSERT (not on UPDATE)
- [ ] Updates all extracted fields (price, bedrooms, city, tags_json, etc.) on conflict
**Verify**: Insert listing, upsert with different price → verify 1 row, new price, original ingested_at

---

### T3: Export query helpers from db package

**What**: Re-export new query functions from main db package index
**Where**: `packages/db/src/index.ts`
**Depends on**: T1, T2
**Done when**:
- [ ] `findUnprocessedRaw` exported from package root
- [ ] `upsertListing` exported from package root
- [ ] TypeScript builds without errors
**Verify**: Import in external file: `import { findUnprocessedRaw, upsertListing } from '@rentifier/db'`

---

### T4: Create NormalizationService class [P]

**What**: Service that delegates raw listing normalization to appropriate connector
**Where**: `workers/processor/src/normalization.ts`
**Depends on**: T3
**Done when**:
- [ ] Class `NormalizationService` with constructor accepting `ConnectorRegistry`
- [ ] Method `normalize(candidate: ListingCandidate): Promise<ListingDraft | null>`
- [ ] Returns null when connector not found for source_id
- [ ] Catches normalization errors and returns null (per-item isolation)
- [ ] Logs warning when connector missing
**Verify**: Unit test with mock connector → verify `ListingDraft` returned; test with unknown source_id → verify null

---

### T5: Create ExtractionService class [P]

**What**: Service that wraps extraction pipeline with error handling and confidence scoring
**Where**: `workers/processor/src/extraction.ts`
**Depends on**: T3
**Done when**:
- [ ] Class `ExtractionService` with method `extract(draft: ListingDraft): Promise<ListingDraft>`
- [ ] Calls `runExtractionPipeline()` from `@rentifier/extraction`
- [ ] Enriches draft with: price, currency, price_period, bedrooms, city, neighborhood, tags_json, relevance_score
- [ ] Catches extraction errors and returns draft unchanged (graceful degradation)
- [ ] Logs extraction failures with source context
**Verify**: Unit test with sample draft → verify extracted fields populated

---

### T6: Create ProcessingPipeline class [P]

**What**: Core orchestration class for batch processing loop
**Where**: `workers/processor/src/pipeline.ts`
**Depends on**: T3
**Done when**:
- [ ] Class `ProcessingPipeline` with constructor: `(db: D1Database, connectors: ConnectorRegistry, batchSize: number)`
- [ ] Method `processBatch(): Promise<ProcessingResult>` with interface: `{ processed: number, failed: number, errors: ProcessingError[] }`
- [ ] Fetches unprocessed via `findUnprocessedRaw()`
- [ ] Per-item try/catch isolation (one failure doesn't crash batch)
- [ ] Returns early if 0 unprocessed
**Verify**: Unit test with mock DB/services → verify batch loop calls normalize → extract → upsert

---

### T7: Integrate services into ProcessingPipeline

**What**: Wire NormalizationService and ExtractionService into pipeline batch loop
**Where**: `workers/processor/src/pipeline.ts`
**Depends on**: T4, T5, T6
**Done when**:
- [ ] `ProcessingPipeline` constructor accepts `NormalizationService` and `ExtractionService` as dependencies
- [ ] Batch loop calls `normalizationService.normalize()` for each raw listing
- [ ] On successful normalization, calls `extractionService.extract(draft)`
- [ ] On successful extraction, calls `upsertListing(enriched)`
- [ ] Increments `results.processed` on success, `results.failed` on error
**Verify**: Integration test: mock services return expected outputs → verify upsert called with enriched draft

---

### T8: Add structured logging to pipeline

**What**: Add contextual logging with source_id, source_item_id, batch stats
**Where**: `workers/processor/src/pipeline.ts`
**Depends on**: T7
**Done when**:
- [ ] Log at start: `{ event: 'batch_start', batchSize, unprocessedCount }`
- [ ] Log per-item errors: `{ event: 'item_failed', sourceId, sourceItemId, error }`
- [ ] Log at end: `{ event: 'batch_complete', processed, failed, errors }`
- [ ] Use `console.log()` with JSON.stringify for Cloudflare Workers compatibility
**Verify**: Run pipeline with 1 success, 1 failure → verify 4 log lines with correct context

---

### T9: Create worker scheduled handler

**What**: Cloudflare Workers scheduled entry point that orchestrates pipeline
**Where**: `workers/processor/src/index.ts`
**Depends on**: T8
**Done when**:
- [ ] Default export with `scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void>`
- [ ] Interface `Env` with: `DB: D1Database`, `BATCH_SIZE?: string`
- [ ] Parses `BATCH_SIZE` env var (default: 50)
- [ ] Instantiates `ProcessingPipeline` with DB, connectors, batchSize
- [ ] Calls `pipeline.processBatch()` and logs result
- [ ] Returns void (no HTTP response needed for cron)
**Verify**: Mock ScheduledEvent + Env → verify pipeline.processBatch() called with correct batchSize

---

### T10: Initialize ConnectorRegistry in worker

**What**: Create ConnectorRegistry instance and pass to pipeline
**Where**: `workers/processor/src/index.ts`
**Depends on**: T9
**Done when**:
- [ ] Import `ConnectorRegistry` from `@rentifier/connectors`
- [ ] Instantiate registry in scheduled handler (or module scope)
- [ ] Pass registry to `NormalizationService` constructor
- [ ] Handle case where registry is empty (log warning, exit gracefully)
**Verify**: Run handler with empty registry → verify logs warning and exits without crashing

---

### T11: Create wrangler.toml configuration [P]

**What**: Cloudflare Workers configuration for processor
**Where**: `workers/processor/wrangler.toml`
**Depends on**: T10
**Done when**:
- [ ] `name = "rentifier-processor"`
- [ ] `main = "src/index.ts"`
- [ ] `compatibility_date = "2024-01-01"`
- [ ] D1 binding: `[[d1_databases]]` with `binding = "DB"`
- [ ] Cron trigger: `crons = ["*/15 * * * *"]` (every 15 minutes)
- [ ] Var: `BATCH_SIZE = "50"`
**Verify**: `wrangler dev` starts without errors

---

### T12: Create worker package.json [P]

**What**: Package manifest for processor worker with dependencies
**Where**: `workers/processor/package.json`
**Depends on**: T10
**Done when**:
- [ ] `name: "@rentifier/processor-worker"`
- [ ] Dependencies: `@rentifier/core`, `@rentifier/db`, `@rentifier/connectors`, `@rentifier/extraction`
- [ ] DevDependencies: `wrangler`, `vitest`, `@cloudflare/workers-types`
- [ ] Scripts: `dev`, `deploy`, `test`
**Verify**: `npm install` completes without errors

---

## Parallel Execution Map

```
T1 ─┐
T2 ─┤─→ T3 ─┬─→ T4 ─┐
     │       ├─→ T5 ─┤
     │       └─→ T6 ─┘─→ T7 ─→ T8 ─→ T9 ─→ T10 ─┬─→ T11
     │                                            └─→ T12
```

**Sequential bottlenecks**: T3 (query exports), T7 (service integration), T8 (logging), T9 (handler), T10 (registry init)
**Parallel opportunities**: Phase 2 (T4, T5, T6 can run simultaneously), Phase 5 (T11, T12 can run simultaneously)

**Total tasks**: 12
**Estimated parallelizable**: 5 tasks (T4, T5, T6, T11, T12)
**Critical path length**: 8 tasks (T1→T2→T3→T6→T7→T8→T9→T10)
