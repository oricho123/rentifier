# Monorepo Setup - Task Breakdown

## Overview
This document breaks down the monorepo setup into atomic, executable tasks. Each task is one file or one configuration.

---

## Tasks

### T1: Create root package.json [P]

**What**: Define workspace configuration, shared scripts, engines, and dev dependencies
**Where**: `package.json`
**Depends on**: None
**Done when**:
- [ ] File contains workspace scripts (build, lint, format, typecheck)
- [ ] Engines field enforces node >=18.0.0 and pnpm >=8.0.0
- [ ] DevDependencies include typescript, eslint, prettier, @types/node
- [ ] "private": true is set
**Verify**: `cat package.json | grep -E "(workspace|engines|devDependencies)"`

---

### T2: Create pnpm workspace configuration [P]

**What**: Define workspace glob patterns for apps and packages
**Where**: `pnpm-workspace.yaml`
**Depends on**: None
**Done when**:
- [ ] File contains `packages: ['apps/*', 'packages/*']`
**Verify**: `cat pnpm-workspace.yaml`

---

### T3: Create base TypeScript configuration [P]

**What**: Shared TypeScript config with strict mode and ES2022 target
**Where**: `tsconfig.base.json`
**Depends on**: None
**Done when**:
- [ ] Compiler options include strict: true, target: ES2022, moduleResolution: bundler
- [ ] noEmit: true is set (Wrangler handles bundling)
- [ ] isolatedModules and skipLibCheck are enabled
**Verify**: `cat tsconfig.base.json | grep -E "(strict|ES2022|bundler)"`

---

### T4: Create ESLint configuration [P]

**What**: Shared linting rules for TypeScript
**Where**: `.eslintrc.json`
**Depends on**: None
**Done when**:
- [ ] Parser set to @typescript-eslint/parser
- [ ] Extends recommended TypeScript rules
- [ ] Ignore patterns include dist, node_modules, .wrangler
**Verify**: `cat .eslintrc.json | grep "@typescript-eslint"`

---

### T5: Create Prettier configuration [P]

**What**: Auto-formatting config for consistent code style
**Where**: `.prettierrc.json`
**Depends on**: None
**Done when**:
- [ ] Config includes semi, singleQuote, trailingComma, tabWidth, printWidth
**Verify**: `cat .prettierrc.json`

---

### T6: Create gitignore file [P]

**What**: Ignore node_modules, build artifacts, and Cloudflare outputs
**Where**: `.gitignore`
**Depends on**: None
**Done when**:
- [ ] Includes node_modules, dist, .wrangler, .env
**Verify**: `cat .gitignore | grep -E "(node_modules|.wrangler)"`

---

### T7: Create apps/collector directory structure

**What**: Create directory for collector worker
**Where**: `apps/collector/`
**Depends on**: None
**Done when**:
- [ ] Directory exists with src/ subdirectory
**Verify**: `ls -la apps/collector/src`

---

### T8: Create apps/collector/package.json

**What**: Package manifest for collector worker
**Where**: `apps/collector/package.json`
**Depends on**: T7
**Done when**:
- [ ] name is @rentifier/collector
- [ ] Contains @cloudflare/workers-types as devDependency
- [ ] Main field points to src/index.ts
**Verify**: `cat apps/collector/package.json | grep "@rentifier/collector"`

---

### T9: Create apps/collector/tsconfig.json

**What**: TypeScript config extending base for collector
**Where**: `apps/collector/tsconfig.json`
**Depends on**: T3, T7
**Done when**:
- [ ] Extends ../../tsconfig.base.json
- [ ] Types array includes @cloudflare/workers-types
- [ ] Include points to src/**/*
**Verify**: `cat apps/collector/tsconfig.json | grep "extends"`

---

### T10: Create apps/collector/wrangler.toml

**What**: Wrangler deployment config for collector worker
**Where**: `apps/collector/wrangler.toml`
**Depends on**: T7
**Done when**:
- [ ] name = "rentifier-collector"
- [ ] main = "src/index.ts"
- [ ] D1 binding named "DB" is configured
- [ ] Cron trigger is defined (e.g., */30 * * * *)
**Verify**: `cat apps/collector/wrangler.toml | grep -E "(name|main|DB)"`

---

### T11: Create apps/collector/src/index.ts

**What**: Stub entry point for collector worker
**Where**: `apps/collector/src/index.ts`
**Depends on**: T7
**Done when**:
- [ ] Exports default fetch handler or scheduled handler
- [ ] TypeScript compiles without errors
**Verify**: `cat apps/collector/src/index.ts`

---

### T12: Create apps/processor directory structure

**What**: Create directory for processor worker
**Where**: `apps/processor/`
**Depends on**: None
**Done when**:
- [ ] Directory exists with src/ subdirectory
**Verify**: `ls -la apps/processor/src`

---

### T13: Create apps/processor/package.json

**What**: Package manifest for processor worker
**Where**: `apps/processor/package.json`
**Depends on**: T12
**Done when**:
- [ ] name is @rentifier/processor
- [ ] Contains @cloudflare/workers-types as devDependency
**Verify**: `cat apps/processor/package.json | grep "@rentifier/processor"`

---

### T14: Create apps/processor/tsconfig.json

**What**: TypeScript config extending base for processor
**Where**: `apps/processor/tsconfig.json`
**Depends on**: T3, T12
**Done when**:
- [ ] Extends ../../tsconfig.base.json
- [ ] Types array includes @cloudflare/workers-types
**Verify**: `cat apps/processor/tsconfig.json | grep "extends"`

---

### T15: Create apps/processor/wrangler.toml

**What**: Wrangler deployment config for processor worker
**Where**: `apps/processor/wrangler.toml`
**Depends on**: T12
**Done when**:
- [ ] name = "rentifier-processor"
- [ ] D1 binding named "DB" is configured
**Verify**: `cat apps/processor/wrangler.toml | grep "DB"`

---

### T16: Create apps/processor/src/index.ts

**What**: Stub entry point for processor worker
**Where**: `apps/processor/src/index.ts`
**Depends on**: T12
**Done when**:
- [ ] Exports default handler
- [ ] TypeScript compiles without errors
**Verify**: `cat apps/processor/src/index.ts`

---

### T17: Create apps/notify directory structure

**What**: Create directory for notify worker
**Where**: `apps/notify/`
**Depends on**: None
**Done when**:
- [ ] Directory exists with src/ subdirectory
**Verify**: `ls -la apps/notify/src`

---

### T18: Create apps/notify/package.json

**What**: Package manifest for notify worker
**Where**: `apps/notify/package.json`
**Depends on**: T17
**Done when**:
- [ ] name is @rentifier/notify
- [ ] Contains @cloudflare/workers-types as devDependency
**Verify**: `cat apps/notify/package.json | grep "@rentifier/notify"`

---

### T19: Create apps/notify/tsconfig.json

**What**: TypeScript config extending base for notify
**Where**: `apps/notify/tsconfig.json`
**Depends on**: T3, T17
**Done when**:
- [ ] Extends ../../tsconfig.base.json
- [ ] Types array includes @cloudflare/workers-types
**Verify**: `cat apps/notify/tsconfig.json | grep "extends"`

---

### T20: Create apps/notify/wrangler.toml

**What**: Wrangler deployment config for notify worker
**Where**: `apps/notify/wrangler.toml`
**Depends on**: T17
**Done when**:
- [ ] name = "rentifier-notify"
- [ ] D1 binding named "DB" is configured
**Verify**: `cat apps/notify/wrangler.toml | grep "DB"`

---

### T21: Create apps/notify/src/index.ts

**What**: Stub entry point for notify worker
**Where**: `apps/notify/src/index.ts`
**Depends on**: T17
**Done when**:
- [ ] Exports default handler
- [ ] TypeScript compiles without errors
**Verify**: `cat apps/notify/src/index.ts`

---

### T22: Create packages/core directory structure

**What**: Create directory for core shared package
**Where**: `packages/core/`
**Depends on**: None
**Done when**:
- [ ] Directory exists with src/ subdirectory
**Verify**: `ls -la packages/core/src`

---

### T23: Create packages/core/package.json

**What**: Package manifest for core types package
**Where**: `packages/core/package.json`
**Depends on**: T22
**Done when**:
- [ ] name is @rentifier/core
- [ ] Contains zod dependency
**Verify**: `cat packages/core/package.json | grep "@rentifier/core"`

---

### T24: Create packages/core/tsconfig.json

**What**: TypeScript config extending base for core
**Where**: `packages/core/tsconfig.json`
**Depends on**: T3, T22
**Done when**:
- [ ] Extends ../../tsconfig.base.json
- [ ] Include points to src/**/*
**Verify**: `cat packages/core/tsconfig.json | grep "extends"`

---

### T25: Create packages/core/src/index.ts

**What**: Stub barrel export for core package
**Where**: `packages/core/src/index.ts`
**Depends on**: T22
**Done when**:
- [ ] File exists (can be empty or export placeholder)
**Verify**: `cat packages/core/src/index.ts`

---

### T26: Create packages/db directory structure

**What**: Create directory for database package
**Where**: `packages/db/`
**Depends on**: None
**Done when**:
- [ ] Directory exists with src/ and migrations/ subdirectories
**Verify**: `ls -la packages/db/src && ls -la packages/db/migrations`

---

### T27: Create packages/db/package.json

**What**: Package manifest for db package
**Where**: `packages/db/package.json`
**Depends on**: T26
**Done when**:
- [ ] name is @rentifier/db
- [ ] Contains @cloudflare/workers-types and @rentifier/core dependencies
**Verify**: `cat packages/db/package.json | grep "@rentifier/db"`

---

### T28: Create packages/db/tsconfig.json

**What**: TypeScript config extending base for db
**Where**: `packages/db/tsconfig.json`
**Depends on**: T3, T26
**Done when**:
- [ ] Extends ../../tsconfig.base.json
- [ ] Include points to src/**/*
**Verify**: `cat packages/db/tsconfig.json | grep "extends"`

---

### T29: Create packages/db/src/index.ts

**What**: Stub barrel export for db package
**Where**: `packages/db/src/index.ts`
**Depends on**: T26
**Done when**:
- [ ] File exists
**Verify**: `cat packages/db/src/index.ts`

---

### T30: Create packages/connectors directory structure

**What**: Create directory for connectors package
**Where**: `packages/connectors/`
**Depends on**: None
**Done when**:
- [ ] Directory exists with src/ subdirectory
**Verify**: `ls -la packages/connectors/src`

---

### T31: Create packages/connectors/package.json

**What**: Package manifest for connectors package
**Where**: `packages/connectors/package.json`
**Depends on**: T30
**Done when**:
- [ ] name is @rentifier/connectors
- [ ] Contains @rentifier/core dependency
**Verify**: `cat packages/connectors/package.json | grep "@rentifier/connectors"`

---

### T32: Create packages/connectors/tsconfig.json

**What**: TypeScript config extending base for connectors
**Where**: `packages/connectors/tsconfig.json`
**Depends on**: T3, T30
**Done when**:
- [ ] Extends ../../tsconfig.base.json
- [ ] Include points to src/**/*
**Verify**: `cat packages/connectors/tsconfig.json | grep "extends"`

---

### T33: Create packages/connectors/src/index.ts

**What**: Stub barrel export for connectors package
**Where**: `packages/connectors/src/index.ts`
**Depends on**: T30
**Done when**:
- [ ] File exists
**Verify**: `cat packages/connectors/src/index.ts`

---

### T34: Create packages/extraction directory structure

**What**: Create directory for extraction package
**Where**: `packages/extraction/`
**Depends on**: None
**Done when**:
- [ ] Directory exists with src/ subdirectory
**Verify**: `ls -la packages/extraction/src`

---

### T35: Create packages/extraction/package.json

**What**: Package manifest for extraction package
**Where**: `packages/extraction/package.json`
**Depends on**: T34
**Done when**:
- [ ] name is @rentifier/extraction
- [ ] Contains @rentifier/core dependency
**Verify**: `cat packages/extraction/package.json | grep "@rentifier/extraction"`

---

### T36: Create packages/extraction/tsconfig.json

**What**: TypeScript config extending base for extraction
**Where**: `packages/extraction/tsconfig.json`
**Depends on**: T3, T34
**Done when**:
- [ ] Extends ../../tsconfig.base.json
- [ ] Include points to src/**/*
**Verify**: `cat packages/extraction/tsconfig.json | grep "extends"`

---

### T37: Create packages/extraction/src/index.ts

**What**: Stub barrel export for extraction package
**Where**: `packages/extraction/src/index.ts`
**Depends on**: T34
**Done when**:
- [ ] File exists
**Verify**: `cat packages/extraction/src/index.ts`

---

### T38: Install dependencies

**What**: Run pnpm install to resolve all workspace dependencies
**Where**: Root directory
**Depends on**: T1, T2, T8, T13, T18, T23, T27, T31, T35
**Done when**:
- [ ] pnpm install completes without errors
- [ ] node_modules exists in root and all packages
**Verify**: `pnpm install && ls node_modules`

---

### T39: Verify TypeScript compilation

**What**: Run typecheck across all workspaces
**Where**: Root directory
**Depends on**: T38
**Done when**:
- [ ] `pnpm -r exec tsc --noEmit` exits with code 0
**Verify**: `pnpm -r exec tsc --noEmit`

---

### T40: Verify linting configuration

**What**: Run lint command to ensure ESLint works
**Where**: Root directory
**Depends on**: T38
**Done when**:
- [ ] `pnpm lint` runs without config errors
**Verify**: `pnpm lint`

---

### T41: Verify formatting configuration

**What**: Run format check to ensure Prettier works
**Where**: Root directory
**Depends on**: T38
**Done when**:
- [ ] `pnpm format --check` runs without config errors
**Verify**: `pnpm format --check`

---

### T42: Verify collector dev environment

**What**: Test wrangler dev starts for collector worker
**Where**: `apps/collector/`
**Depends on**: T10, T11, T38
**Done when**:
- [ ] `cd apps/collector && wrangler dev` starts without config errors (can stop after confirming)
**Verify**: `cd apps/collector && timeout 5 wrangler dev || true`

---

### T43: Verify processor dev environment

**What**: Test wrangler dev starts for processor worker
**Where**: `apps/processor/`
**Depends on**: T15, T16, T38
**Done when**:
- [ ] `cd apps/processor && wrangler dev` starts without config errors
**Verify**: `cd apps/processor && timeout 5 wrangler dev || true`

---

### T44: Verify notify dev environment

**What**: Test wrangler dev starts for notify worker
**Where**: `apps/notify/`
**Depends on**: T20, T21, T38
**Done when**:
- [ ] `cd apps/notify && wrangler dev` starts without config errors
**Verify**: `cd apps/notify && timeout 5 wrangler dev || true`

---

## Execution Plan

### Phase 1: Foundation (Parallel)
All root config files and directory structures can be created simultaneously:
- T1, T2, T3, T4, T5, T6 (root configs)
- T7, T12, T17 (app directories)
- T22, T26, T30, T34 (package directories)

### Phase 2: App Configurations (Parallel per app)
Once directories exist, create app-specific files:
- **Collector**: T8, T9, T10, T11 (depends on T7, T3)
- **Processor**: T13, T14, T15, T16 (depends on T12, T3)
- **Notify**: T18, T19, T20, T21 (depends on T17, T3)

### Phase 3: Package Configurations (Parallel per package)
Once package directories exist, create package-specific files:
- **Core**: T23, T24, T25 (depends on T22, T3)
- **DB**: T27, T28, T29 (depends on T26, T3)
- **Connectors**: T31, T32, T33 (depends on T30, T3)
- **Extraction**: T35, T36, T37 (depends on T34, T3)

### Phase 4: Installation (Sequential)
- T38 (install dependencies - depends on all package.json files)

### Phase 5: Verification (Parallel)
Once dependencies are installed, run verification tasks:
- T39, T40, T41 (type/lint/format checks)
- T42, T43, T44 (wrangler dev checks)

---

## Parallel Execution Map

```
Phase 1 (13 parallel tasks):
  [T1] [T2] [T3] [T4] [T5] [T6] [T7] [T12] [T17] [T22] [T26] [T30] [T34]
                                    ↓         ↓      ↓      ↓      ↓      ↓       ↓        ↓
Phase 2 (12 parallel tasks):
  [T8 → T9 → T10 → T11]  [T13 → T14 → T15 → T16]  [T18 → T19 → T20 → T21]
                                    ↓
  [T23 → T24 → T25]  [T27 → T28 → T29]  [T31 → T32 → T33]  [T35 → T36 → T37]
                                    ↓
Phase 4 (1 task):
  [T38] (Install dependencies)
                                    ↓
Phase 5 (7 parallel tasks):
  [T39] [T40] [T41] [T42] [T43] [T44]
```

**Total Tasks**: 44
**Parallelizable**: 32 tasks (73%)
**Sequential**: 12 tasks (27%)
**Estimated Time**: ~15-20 minutes (5 min setup + 5 min install + 5 min verification)

---

## Success Criteria Checklist

- [ ] All 44 tasks completed
- [ ] `pnpm install` completes in < 30 seconds
- [ ] `pnpm -r build` or `pnpm typecheck` passes with zero errors
- [ ] Cross-package imports resolve (verified in Phase 3)
- [ ] Each worker can start with `wrangler dev` (T42-T44)
- [ ] All verification tasks (T39-T44) pass
