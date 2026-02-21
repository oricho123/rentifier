# Monorepo Setup Design

**Spec**: `.specs/features/monorepo-setup/spec.md`
**Status**: Draft

---

## Architecture Overview

The monorepo uses pnpm workspaces to house three Cloudflare Workers apps and four shared packages. The root owns all dev tooling (TypeScript, ESLint, Prettier) while each package declares its own runtime dependencies. Workers reference shared packages via workspace protocol (`workspace:*`), enabling real-time cross-package development without publish cycles.

```
rentifier/
├── apps/
│   ├── collector/          # Cron-triggered ingestion worker
│   ├── processor/          # Raw → canonical transformation worker
│   └── notify/             # Filter matching + Telegram worker
├── packages/
│   ├── core/               # Types, schemas, constants
│   ├── db/                 # D1 migrations + query helpers
│   ├── connectors/         # Connector interface
│   └── extraction/         # Text → structured field extraction
├── package.json            # Root workspace config + shared scripts
├── pnpm-workspace.yaml     # Workspace glob patterns
├── tsconfig.base.json      # Shared TS config (strict mode, ES2022, bundler resolution)
└── .eslintrc.json          # Shared lint rules
```

**Key constraint**: Cloudflare Workers require bundling with `esbuild`. Each app's `wrangler.toml` points to its entry file; Wrangler bundles transitively, so shared packages don't need their own build step.

---

## Code Reuse Analysis

**Greenfield — no existing code.**

Patterns to establish:
- **Workspace imports**: `"@rentifier/core": "workspace:*"` in app `package.json` dependencies
- **Shared TS config inheritance**: `"extends": "../../tsconfig.base.json"` in all packages
- **Unified script aliases**: `pnpm -r` (recursive) for monorepo-wide operations
- **Consistent D1 binding name**: `DB` in all `wrangler.toml` files to simplify shared DB package usage

---

## Components

### Root Package Configuration
- **Purpose**: Define workspace boundaries, shared scripts, and dev dependencies
- **Location**: `package.json` at repo root
- **Interfaces**:
  ```typescript
  // package.json structure
  {
    "name": "rentifier-monorepo",
    "private": true,
    "scripts": {
      "build": "pnpm -r build",
      "lint": "eslint .",
      "format": "prettier --write .",
      "typecheck": "pnpm -r exec tsc --noEmit"
    },
    "engines": {
      "node": ">=18.0.0",
      "pnpm": ">=8.0.0"
    },
    "devDependencies": {
      "@types/node": "^20.0.0",
      "typescript": "^5.3.0",
      "eslint": "^8.0.0",
      "prettier": "^3.0.0"
    }
  }
  ```
- **Dependencies**: None (this is the root)

### Workspace Configuration
- **Purpose**: Define which directories are workspaces
- **Location**: `pnpm-workspace.yaml`
- **Interfaces**:
  ```yaml
  packages:
    - 'apps/*'
    - 'packages/*'
  ```
- **Dependencies**: None

### Base TypeScript Config
- **Purpose**: Enforce strict types, modern target, and package path resolution
- **Location**: `tsconfig.base.json`
- **Interfaces**:
  ```json
  {
    "compilerOptions": {
      "target": "ES2022",
      "module": "ESNext",
      "lib": ["ES2022"],
      "moduleResolution": "bundler",
      "strict": true,
      "esModuleInterop": true,
      "skipLibCheck": true,
      "forceConsistentCasingInFileNames": true,
      "resolveJsonModule": true,
      "isolatedModules": true,
      "noEmit": true
    }
  }
  ```
- **Dependencies**: None

### Worker App Structure (Template)
- **Purpose**: Each worker extends base config and declares Cloudflare Workers types
- **Location**: `apps/{collector,processor,notify}/tsconfig.json`
- **Interfaces**:
  ```json
  {
    "extends": "../../tsconfig.base.json",
    "compilerOptions": {
      "types": ["@cloudflare/workers-types"]
    },
    "include": ["src/**/*"]
  }
  ```
- **Dependencies**: `@cloudflare/workers-types` (devDependency)

### Worker Wrangler Config (Template)
- **Purpose**: Configure worker deployment, bindings, and cron schedule
- **Location**: `apps/{collector,processor,notify}/wrangler.toml`
- **Interfaces**:
  ```toml
  name = "{worker-name}"
  main = "src/index.ts"
  compatibility_date = "2024-01-01"

  [[d1_databases]]
  binding = "DB"
  database_name = "rentifier"
  database_id = "" # Set after `wrangler d1 create rentifier`

  [triggers]
  crons = ["*/30 * * * *"] # Example for collector; varies per worker
  ```
- **Dependencies**: D1 database must be created before first deploy

### Shared Package Structure (Template)
- **Purpose**: Each shared package extends base config, declares dependencies
- **Location**: `packages/{core,db,connectors,extraction}/tsconfig.json`
- **Interfaces**:
  ```json
  {
    "extends": "../../tsconfig.base.json",
    "include": ["src/**/*"]
  }
  ```
- **Dependencies**: Package-specific (e.g., `zod` for core, none for connectors)

### ESLint Configuration
- **Purpose**: Enforce consistent code style across all packages
- **Location**: `.eslintrc.json`
- **Interfaces**:
  ```json
  {
    "parser": "@typescript-eslint/parser",
    "extends": [
      "eslint:recommended",
      "plugin:@typescript-eslint/recommended"
    ],
    "plugins": ["@typescript-eslint"],
    "env": {
      "node": true,
      "es2022": true
    },
    "ignorePatterns": ["dist", "node_modules", ".wrangler"]
  }
  ```
- **Dependencies**: `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin`

### Prettier Configuration
- **Purpose**: Auto-format all TypeScript and JSON files
- **Location**: `.prettierrc.json`
- **Interfaces**:
  ```json
  {
    "semi": true,
    "singleQuote": true,
    "trailingComma": "es5",
    "tabWidth": 2,
    "printWidth": 100
  }
  ```
- **Dependencies**: None

---

## Data Models

No runtime data models in this feature (monorepo setup is pure tooling).

---

## Error Handling Strategy

| Scenario | Detection | Handling |
|----------|-----------|----------|
| Incompatible Node version | `pnpm install` fails with engine check | `package.json` engines field enforces min version; install aborts with clear error |
| Circular dependency between packages | `pnpm install` detects cycle | pnpm prints dependency path; developer must break cycle by refactoring |
| Missing workspace package | Import fails at build time | TypeScript error: "Cannot find module '@rentifier/core'"; add to `dependencies` in consuming package |
| Type errors in shared package | `pnpm -r exec tsc --noEmit` fails | Build halts; fix types in shared package; all consumers see the fix immediately |
| Wrangler config missing D1 binding | `wrangler dev` starts but crashes on DB access | Add `[[d1_databases]]` block to `wrangler.toml` with binding name `DB` |
| Build step missing for package | Worker import fails at runtime | Add build script to package if needed; Wrangler bundles TypeScript automatically, so explicit build is optional |

---

## Tech Decisions

| Decision | Rationale | Trade-off |
|----------|-----------|-----------|
| **pnpm workspaces over npm/yarn** | Faster installs, strict workspace protocol, better monorepo DX | Requires pnpm installed globally; not compatible with npm/yarn lock files |
| **`workspace:*` protocol for internal deps** | Enforces workspace resolution; prevents accidental publish of placeholder versions | Requires transform to real versions if packages are published (not applicable here) |
| **No build step for shared packages** | Wrangler bundles TypeScript on deploy; simpler workflow | Can't pre-compile shared packages for faster iteration; acceptable for small codebase |
| **Shared `tsconfig.base.json` with `extends`** | Single source of truth for compiler options; easier to enforce strict mode | Packages can't deviate (e.g., disable strict for one package); enforced consistency is the goal |
| **Consistent D1 binding name (`DB`)** | Shared `@rentifier/db` package can reference `env.DB` without per-worker config | All workers must use the same binding name; conflicts if multiple D1 databases needed (unlikely) |
| **`noEmit: true` in base TS config** | Wrangler handles bundling; TypeScript only for type checking | Can't use `tsc` to generate JS output; must use Wrangler for deployment |
| **Root-level dev dependencies only** | Reduces duplication; all tooling (TS, ESLint, Prettier) shared | Runtime dependencies still per-package; adds some root `package.json` bloat |
| **`.wrangler` and `dist` in `.gitignore`** | Cloudflare artifacts not versioned | Must rebuild/redeploy from source; typical for compiled output |

---

## File Structure Summary

```
rentifier/
├── package.json                      # Root workspace config + shared scripts
├── pnpm-workspace.yaml               # Workspace globs
├── tsconfig.base.json                # Base TS config (strict, ES2022)
├── .eslintrc.json                    # Shared ESLint rules
├── .prettierrc.json                  # Shared Prettier config
├── .gitignore                        # Ignore node_modules, .wrangler, dist
├── apps/
│   ├── collector/
│   │   ├── package.json              # name: @rentifier/collector
│   │   ├── tsconfig.json             # extends ../../tsconfig.base.json
│   │   ├── wrangler.toml             # collector worker config, D1 binding
│   │   └── src/index.ts              # Worker entry point
│   ├── processor/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── wrangler.toml
│   │   └── src/index.ts
│   └── notify/
│       ├── package.json
│       ├── tsconfig.json
│       ├── wrangler.toml
│       └── src/index.ts
└── packages/
    ├── core/
    │   ├── package.json              # name: @rentifier/core
    │   ├── tsconfig.json
    │   └── src/index.ts              # Export types, schemas, constants
    ├── db/
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── src/index.ts              # Export query helpers
    │   └── migrations/               # SQL migration files
    ├── connectors/
    │   ├── package.json
    │   ├── tsconfig.json
    │   └── src/index.ts              # Export connector interface
    └── extraction/
        ├── package.json
        ├── tsconfig.json
        └── src/index.ts              # Export extraction functions
```

---

## Implementation Checklist

- [ ] Create root `package.json` with workspace scripts and engines enforcement
- [ ] Create `pnpm-workspace.yaml` with `apps/*` and `packages/*` globs
- [ ] Create `tsconfig.base.json` with strict mode and bundler resolution
- [ ] Create `.eslintrc.json` with TypeScript parser and recommended rules
- [ ] Create `.prettierrc.json` with standard formatting
- [ ] Create all app directories with `package.json`, `tsconfig.json`, `wrangler.toml`, and stub `src/index.ts`
- [ ] Create all package directories with `package.json`, `tsconfig.json`, and stub `src/index.ts`
- [ ] Run `pnpm install` and verify all workspaces resolve
- [ ] Run `pnpm -r exec tsc --noEmit` and verify zero errors
- [ ] Run `wrangler dev` in each app directory and verify it starts without config errors
- [ ] Run `pnpm lint` and `pnpm format --check` to verify tooling works

---

## References

- pnpm workspaces: https://pnpm.io/workspaces
- Cloudflare Workers TypeScript: https://developers.cloudflare.com/workers/languages/typescript/
- Wrangler configuration: https://developers.cloudflare.com/workers/wrangler/configuration/
- D1 bindings: https://developers.cloudflare.com/d1/configuration/bindings/
