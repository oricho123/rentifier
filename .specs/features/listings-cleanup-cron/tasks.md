# Listings Cleanup Cron Tasks

**Design**: `.specs/features/listings-cleanup-cron/design.md`
**Status**: Draft

---

## Execution Plan

### Phase 1 — DB layer (sequential)

```
T01 → T02 → T03 → T04 → T05
```

Add cleanup methods + types to `@rentifier/db` first; everything downstream depends on these.

### Phase 2 — Service layer (parallel after Phase 1)

```
        ┌→ T06 [P] ─┐
T05 ────┼→ T07 [P] ─┼──→ T08
        └→ T08 ─────┘
```

`CleanupService` orchestrator + its unit tests. Parallel because they're isolated files.

### Phase 3 — Worker scaffold (parallel)

```
        ┌→ T09 [P]
T08 ────┼→ T10 [P]
        ├→ T11 [P]
        └→ T12 [P]
```

Worker package files (package.json, tsconfig, wrangler.json, index.ts).

### Phase 4 — Wiring & tooling (sequential)

```
T12 → T13 → T14 → T15
```

Root `package.json` scripts → typecheck → tests.

### Phase 5 — Validation (sequential, manual + automated)

```
T15 → T16 → T17
```

Local end-to-end against `.wrangler` D1, then production deploy gating.

---

## Task Breakdown

### T01: Add `CleanupOpts` and `CleanupResult` types to `@rentifier/db`

**What**: Define the shared option/result types so service and worker share a single type contract.
**Where**: `packages/db/src/schema.ts` (extend) — exported via `packages/db/src/index.ts`.
**Depends on**: None.
**Reuses**: Existing export pattern in `schema.ts`.

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `CleanupOpts { retentionDays: number; batchSize: number; maxDeletesPerRun: number }` exported.
- [ ] `CleanupResult { listings_deleted: number; listings_raw_deleted: number; duplicates_deleted: number; orphan_notifications_deleted: number; capped: boolean; ms: number }` exported.
- [ ] `pnpm typecheck` passes.

**Verify**: `pnpm typecheck`.

---

### T02: Add `deleteOldListings` to `DB` interface and `createDB`

**What**: Implement the canonical-listings delete batch query.
**Where**: `packages/db/src/queries.ts` — add to interface (above `getCachedNeighborhood`) and to factory body.
**Depends on**: T01.
**Reuses**: `prepare(...).bind(...).run()` pattern (see existing methods).

**Done when**:
- [ ] Method signature `deleteOldListings(retentionDays: number, batchSize: number): Promise<number>`.
- [ ] SQL uses `DELETE FROM listings WHERE id IN (SELECT id FROM listings WHERE duplicate_of IS NULL AND COALESCE(posted_at, ingested_at) < datetime('now', ?) LIMIT ?)`.
- [ ] Returns `result.meta.changes ?? 0` so the service can detect "nothing more to delete".
- [ ] `pnpm typecheck` passes.

**Verify**: `pnpm typecheck && pnpm test`.

---

### T03: Add `deleteOldRawListings` to `DB`

**What**: Implement the raw-listings batch delete.
**Where**: `packages/db/src/queries.ts`.
**Depends on**: T01.
**Reuses**: Same pattern as T02.

**Done when**:
- [ ] Signature `deleteOldRawListings(retentionDays: number, batchSize: number): Promise<number>`.
- [ ] SQL: `DELETE FROM listings_raw WHERE id IN (SELECT id FROM listings_raw WHERE fetched_at < datetime('now', ?) LIMIT ?)`.
- [ ] Returns `meta.changes`.
- [ ] `pnpm typecheck` passes.

---

### T04: Add `deleteOrphanedDuplicates` to `DB`

**What**: Delete `listings` rows whose `duplicate_of` is missing or expired.
**Where**: `packages/db/src/queries.ts`.
**Depends on**: T01.
**Reuses**: Same query patterns.

**Done when**:
- [ ] Signature `deleteOrphanedDuplicates(retentionDays: number, batchSize: number): Promise<number>`.
- [ ] SQL: `DELETE FROM listings WHERE id IN (SELECT d.id FROM listings d LEFT JOIN listings c ON c.id = d.duplicate_of WHERE d.duplicate_of IS NOT NULL AND (c.id IS NULL OR COALESCE(c.posted_at, c.ingested_at) < datetime('now', ?)) LIMIT ?)`.
- [ ] Returns `meta.changes`.
- [ ] `pnpm typecheck` passes.

---

### T05: Add `deleteOrphanedNotifications` to `DB`

**What**: Defensive single-statement orphan-notifications sweep.
**Where**: `packages/db/src/queries.ts`.
**Depends on**: T01.

**Done when**:
- [ ] Signature `deleteOrphanedNotifications(): Promise<number>`.
- [ ] SQL: `DELETE FROM notifications_sent WHERE listing_id NOT IN (SELECT id FROM listings)`.
- [ ] Returns `meta.changes`.
- [ ] `pnpm typecheck` passes.

---

### T06: Implement `runCleanup` orchestrator [P]

**What**: Top-level service that runs the 4 deletes in the correct order with batching and the run-cap, returning `CleanupResult`.
**Where**: `apps/cleanup/src/cleanup-service.ts`.
**Depends on**: T05.
**Reuses**: Pattern from `apps/notify/src/notification-service.ts` (functional service with `db` dep).

**Done when**:
- [ ] Function signature `export async function runCleanup(db: DB, opts: CleanupOpts): Promise<CleanupResult>`.
- [ ] Validates `opts.retentionDays > 0`, `opts.batchSize > 0`, `opts.maxDeletesPerRun > 0` — throws on invalid.
- [ ] Order: `deleteOrphanedDuplicates` → `deleteOldListings` → `deleteOldRawListings` → `deleteOrphanedNotifications`.
- [ ] Each batched method runs inside `while (lastBatch > 0 && totalDeleted < maxDeletesPerRun)` loop.
- [ ] Sets `result.capped = true` if any loop hit the cap.
- [ ] Records `ms = Date.now() - startedAt`.
- [ ] `pnpm typecheck` passes.

---

### T07: Unit tests for `runCleanup` [P]

**What**: Verify orchestrator order, batching, and `capped` behaviour with a fully mocked `DB`.
**Where**: `apps/cleanup/src/__tests__/cleanup-service.test.ts`.
**Depends on**: T06.
**Reuses**: Mock-DB pattern from `apps/processor/src/__tests__/pipeline.test.ts` (see lines 14–32).

**Done when**:
- [ ] Test: calls duplicates → canonicals → raw → orphans in that order (use `vi.fn()` call-order assertion).
- [ ] Test: batches loop until method returns 0 (mock returns `[3, 2, 0]`, total = 5).
- [ ] Test: `capped=true` when `maxDeletesPerRun` reached mid-batch.
- [ ] Test: throws on `retentionDays <= 0`.
- [ ] `pnpm test` passes.

---

### T08: Add cleanup-method tests in queries (optional but recommended) [P]

**What**: Unit-level guards on the SQL strings — pinning the column expressions and `LIMIT` placement.
**Where**: `packages/db/src/__tests__/queries.test.ts` (new file; or add to existing test file if present).
**Depends on**: T05.
**Reuses**: If no test infra exists in `packages/db`, skip and rely on T07 + T16 integration coverage; mark task as **SKIPPED** in commit notes.

**Done when**:
- [ ] If file created: tests assert each `deleteOld*` method binds `('-30 days', 500)` correctly when called with `(30, 500)`.
- [ ] OR: explicit "skipped — covered by T07/T16" note added to PR description.

---

### T09: Create `apps/cleanup/package.json` [P]

**What**: New workspace package.
**Where**: `apps/cleanup/package.json`.
**Depends on**: T08 (lock-step with worker dir creation).
**Reuses**: Mirror of `apps/processor/package.json`.

**Done when**:
- [ ] `name: "@rentifier/cleanup"`, `private: true`, `main: "src/index.ts"`.
- [ ] `dependencies`: only `@rentifier/db: workspace:*` (no AI, no connectors needed).
- [ ] `devDependencies`: `@cloudflare/workers-types: ^4.20240117.0` (match processor).

---

### T10: Create `apps/cleanup/tsconfig.json` [P]

**What**: TypeScript config.
**Where**: `apps/cleanup/tsconfig.json`.
**Depends on**: T09.
**Reuses**: Direct copy of `apps/processor/tsconfig.json`.

**Done when**:
- [ ] Extends `../../tsconfig.base.json`.
- [ ] `types: ["@cloudflare/workers-types"]`.
- [ ] `include: ["src/**/*"]`.

---

### T11: Create `apps/cleanup/wrangler.json` [P]

**What**: Cloudflare Worker config with daily cron + D1 binding.
**Where**: `apps/cleanup/wrangler.json`.
**Depends on**: T09.
**Reuses**: Shape of `apps/processor/wrangler.json` minus `vars.AI_GATEWAY_ID` and `ai` block.

**Done when**:
- [ ] `name: "rentifier-cleanup"`, `main: "src/index.ts"`, `compatibility_date: "2024-01-01"`.
- [ ] `triggers.crons: ["0 4 * * *"]`.
- [ ] `d1_databases[0]`: `binding=DB`, `database_name=rentifier`, `database_id=554a9f64-3cfb-4e27-b83c-0f92907c8794`, `migrations_dir=../../packages/db/migrations`.
- [ ] `observability.logs.enabled = true`, `invocation_logs = true`.

---

### T12: Create `apps/cleanup/src/index.ts` worker entrypoint

**What**: Wire env to `runCleanup`, log result, upsert `worker_state`.
**Where**: `apps/cleanup/src/index.ts`.
**Depends on**: T06, T09, T10, T11.
**Reuses**: `apps/processor/src/index.ts` (lines 1–46) as template.

**Done when**:
- [ ] Exports `default { scheduled }` shape.
- [ ] `env` interface: `DB: D1Database`, optional `RETENTION_DAYS?: string`, optional `BATCH_SIZE?: string`, optional `MAX_DELETES_PER_RUN?: string`.
- [ ] Reads env with defaults: `30`, `500`, `50_000`. Each parsed via `parseInt(env.X, 10)` with NaN guard falling back to default.
- [ ] Wraps `runCleanup` in try/catch; on success calls `db.updateWorkerState('cleanup', new Date().toISOString(), 'ok')`; on error calls it with `'error'` + message and **re-throws**.
- [ ] `console.log('Cleanup completed:', JSON.stringify(result))` on success.

---

### T13: Add root scripts for cleanup worker

**What**: Add dev/deploy/trigger scripts so cleanup matches existing workflow.
**Where**: `package.json` (root) — `scripts` block.
**Depends on**: T12.
**Reuses**: `dev:processor`, `deploy:processor`, `trigger:processor` script triplet as exact template.

**Done when**:
- [ ] `dev:cleanup`: `pnpm --filter @rentifier/cleanup exec wrangler dev --test-scheduled --port 8790 --persist-to ../../.wrangler --inspector-port 9232`.
- [ ] `trigger:cleanup`: `curl -s http://localhost:8790/__scheduled`.
- [ ] `deploy:cleanup`: `pnpm --filter @rentifier/cleanup exec wrangler deploy`.
- [ ] `deploy:all` updated to include cleanup at the end.
- [ ] `dev` concurrently command optionally extended (low priority — daily cron, doesn't need to run during normal dev).

---

### T14: Typecheck across monorepo

**What**: Confirm no TS errors anywhere.
**Where**: Repo root.
**Depends on**: T13.

**Done when**:
- [ ] `pnpm typecheck` exits 0.

**Verify**: `pnpm typecheck`.

---

### T15: Run full test suite

**What**: Confirm new tests pass and existing tests regress to no failures.
**Where**: Repo root.
**Depends on**: T14.

**Done when**:
- [ ] `pnpm test` exits 0.
- [ ] New `cleanup-service.test.ts` shows in vitest output and passes.

**Verify**: `pnpm test`.

---

### T16: Local end-to-end on `.wrangler` D1

**What**: Seed expired rows, run scheduled handler locally, assert deletion.
**Where**: Local shell.
**Depends on**: T15.

**Steps & Done when**:
- [ ] `pnpm db:migrate:local` (no-op if migrated).
- [ ] Seed: `pnpm db:query:local "INSERT INTO listings_raw (source_id, source_item_id, url, raw_json, fetched_at) VALUES (1, 'cleanup-test-1', 'http://x', '{}', datetime('now', '-31 days'))"`.
- [ ] Seed: `pnpm db:query:local "INSERT INTO listings (source_id, source_item_id, title, url, ingested_at, posted_at) VALUES (1, 'cleanup-test-1', 'old', 'http://x', datetime('now', '-31 days'), datetime('now', '-31 days'))"`.
- [ ] Start: `pnpm dev:cleanup` (in another shell).
- [ ] Trigger: `pnpm trigger:cleanup`.
- [ ] Assert deletion: `pnpm db:query:local "SELECT COUNT(*) FROM listings_raw WHERE source_item_id='cleanup-test-1'"` returns 0.
- [ ] Assert deletion: `pnpm db:query:local "SELECT COUNT(*) FROM listings WHERE source_item_id='cleanup-test-1'"` returns 0.
- [ ] Assert worker_state: `pnpm db:query:local "SELECT * FROM worker_state WHERE worker_name='cleanup'"` shows `last_status='ok'`.

**Verify**: All four asserts return expected values.

---

### T17: Production deploy + smoke check

**What**: Deploy worker; verify cron registered; trigger manually once.
**Where**: Production (Cloudflare).
**Depends on**: T16.

**Done when**:
- [ ] `pnpm deploy:cleanup` succeeds.
- [ ] Cloudflare dashboard shows `rentifier-cleanup` Worker with cron `0 4 * * *`.
- [ ] Manual trigger: `wrangler triggers cron --test --config apps/cleanup/wrangler.json` (or via dashboard "Test cron" button) returns success.
- [ ] `pnpm db:query:remote "SELECT * FROM worker_state WHERE worker_name='cleanup'"` shows fresh `last_run_at`, `last_status='ok'`.
- [ ] Cloudflare logs show summary JSON with non-error counts.

---

## Parallel Execution Map

```
Phase 1 (DB methods, sequential):
  T01 → T02 → T03 → T04 → T05

Phase 2 (Service, parallel after T05):
  ├── T06 (orchestrator)
  └── T07 [P]   (depends on T06 internally; in practice run after)
  └── T08 [P]   (db query tests, optional)

Phase 3 (Worker scaffold, parallel after T06):
  ├── T09 [P]
  ├── T10 [P]
  ├── T11 [P]
  └── T12       (depends on T09–T11 + T06)

Phase 4 (sequential):
  T12 → T13 → T14 → T15

Phase 5 (sequential):
  T15 → T16 → T17
```

---

## Task Granularity Check

| Task | Scope | Status |
| ---- | ----- | ------ |
| T01 — types | 2 type aliases, 1 file | ✅ Granular |
| T02–T05 — one DB method each | 1 method per task | ✅ Granular |
| T06 — orchestrator | 1 function, 1 file | ✅ Granular |
| T07 — orchestrator tests | 1 test file | ✅ Granular |
| T09–T12 — worker scaffold | 1 file each | ✅ Granular |
| T13 — root scripts | 1 file edit | ✅ Granular |
| T14, T15 — typecheck/test | 1 command each | ✅ Granular |
| T16 — local E2E | 1 verification flow | ✅ Granular |
| T17 — prod deploy | 1 verification flow | ✅ Granular |
