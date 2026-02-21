# Monorepo Setup Specification

## Problem Statement

The Rentifier project consists of three Cloudflare Workers and multiple shared packages. Without a monorepo, shared types, utilities, and DB logic would be duplicated or require publishing internal packages. A well-configured monorepo with consistent tooling is the foundation everything else builds on.

## Goals

- [ ] Single repo with pnpm workspaces housing all apps and shared packages
- [ ] Consistent TypeScript, linting, and formatting config across all packages
- [ ] Each worker app deployable independently via its own `wrangler.toml`

## Out of Scope

- CI/CD pipeline configuration (can deploy manually via Wrangler for now)
- Docker or containerization
- Environment-specific config beyond Cloudflare bindings

---

## User Stories

### P1: Workspace Structure

**User Story**: As a developer, I want a single repo with clearly separated apps and packages so that I can share code without duplication.

**Why P1**: Everything depends on the repo structure existing first.

**Acceptance Criteria**:

1. WHEN I clone the repo and run `pnpm install` THEN all dependencies SHALL be installed across all workspaces
2. WHEN I import from `@rentifier/core` in any app THEN TypeScript SHALL resolve the import without errors
3. WHEN I add a new type to `packages/core` THEN all apps referencing it SHALL see the change without re-publishing

**Independent Test**: Run `pnpm install && pnpm -r build` from the root — all packages compile.

---

### P1: TypeScript Configuration

**User Story**: As a developer, I want consistent TypeScript settings across all packages so that types are strict and interoperable.

**Why P1**: Inconsistent TS configs cause subtle type bugs across package boundaries.

**Acceptance Criteria**:

1. WHEN I create a new package THEN it SHALL extend a shared `tsconfig.base.json` from the root
2. WHEN I enable strict mode in the base config THEN all packages SHALL enforce strict null checks, no implicit any, etc.
3. WHEN a worker app imports from a shared package THEN TypeScript SHALL resolve paths correctly without `any` fallback

**Independent Test**: `pnpm -r exec tsc --noEmit` passes with zero errors.

---

### P1: Wrangler Configuration Per Worker

**User Story**: As a developer, I want each worker to have its own `wrangler.toml` so that I can deploy them independently.

**Why P1**: Workers have different cron schedules, bindings, and entry points.

**Acceptance Criteria**:

1. WHEN I run `wrangler deploy` in `apps/collector` THEN only the collector worker SHALL be deployed
2. WHEN each worker's `wrangler.toml` references D1 bindings THEN the binding name SHALL be consistent (`DB`) across all workers
3. WHEN I run `wrangler dev` for any worker THEN it SHALL start a local dev server with D1 bindings available

**Independent Test**: `cd apps/collector && wrangler dev` starts without config errors.

---

### P2: Linting and Formatting

**User Story**: As a developer, I want shared ESLint and Prettier configs so that code style is consistent everywhere.

**Why P2**: Important for maintainability but not strictly blocking other features.

**Acceptance Criteria**:

1. WHEN I run `pnpm lint` from the root THEN ESLint SHALL check all packages and apps
2. WHEN I run `pnpm format` from the root THEN Prettier SHALL format all `.ts` files consistently
3. WHEN a file violates lint rules THEN the lint command SHALL report it with a non-zero exit code

**Independent Test**: `pnpm lint && pnpm format --check` passes.

---

## Edge Cases

- WHEN `pnpm install` is run with an incompatible Node version THEN `package.json` engines field SHALL enforce the minimum version
- WHEN a circular dependency exists between packages THEN `pnpm` SHALL report it at install time
- WHEN a shared package has a build step THEN workspace imports SHALL reference the built output, not raw source

---

## Success Criteria

- [ ] `pnpm install` from root installs all workspaces in < 30s
- [ ] `pnpm -r build` compiles all packages and apps with zero errors
- [ ] Cross-package imports resolve correctly in all apps
- [ ] Each worker can be developed and deployed independently
