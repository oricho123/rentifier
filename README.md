# Rentifier

Automated apartment-listing aggregator for Israeli rental markets. Ingests posts from multiple sources, normalizes and deduplicates them, extracts structured data, and delivers matching listings to users via Telegram.

## Architecture

Three Cloudflare Workers running on cron schedules, sharing a D1 (SQLite) database:

```
Collector (every 30min)     Processor (every 15min)     Notify (every 5min)
   │                           │                           │
   │ fetch from sources        │ normalize + extract       │ match filters
   │ store raw JSON            │ upsert canonical listings │ send Telegram
   ▼                           ▼                           ▼
┌──────────────────────── Cloudflare D1 ────────────────────────────┐
│ sources │ source_state │ listings_raw │ listings │ users │ filters│
└──────────────────────────────────────────────────────────────────-┘
```

## Project Structure

```
rentifier/
├── apps/
│   ├── collector/       # Cron-triggered source ingestion worker
│   ├── processor/       # Normalization + extraction pipeline worker
│   └── notify/          # Filter matching + Telegram notification worker
├── packages/
│   ├── core/            # Shared types, Zod schemas, constants
│   ├── db/              # D1 migrations, schema types, query helpers
│   ├── connectors/      # Connector interface + Yad2 & mock implementations
│   └── extraction/      # Rules-based field extraction (Hebrew + English)
└── .specs/              # Spec-driven development documents
    ├── project/         # PROJECT.md, ROADMAP.md
    └── features/        # Per-feature spec.md, design.md, tasks.md
```

## Tech Stack

- **Runtime:** Cloudflare Workers (TypeScript)
- **Database:** Cloudflare D1 (serverless SQLite)
- **Scheduling:** Cloudflare Cron Triggers
- **Notifications:** Telegram Bot API
- **Validation:** Zod
- **Monorepo:** pnpm workspaces
- **Testing:** Vitest
- **Tooling:** Wrangler, ESLint, Prettier

## Prerequisites

- Node.js >= 18
- pnpm >= 8
- Wrangler CLI (`npm install -g wrangler`)
- A Cloudflare account (free tier is sufficient)

## Getting Started

### Install dependencies

```bash
pnpm install
```

### Type-check all workspaces

```bash
pnpm typecheck
```

## Local Development

No Docker needed — Wrangler simulates Cloudflare Workers + D1 locally.

### 1. Set up the local database

```bash
pnpm db:migrate:local     # Create tables, indexes, seed sources
pnpm db:seed:local        # Add a dev user + catch-all filter
```

Edit `scripts/seed-local.sql` first to set your Telegram chat ID (or leave the placeholder for now).

### 2. Run all workers

```bash
pnpm dev
```

This starts all three workers concurrently (collector:8787, processor:8788, notify:8789).

### 3. Test the pipeline

```bash
# Trigger each worker's cron handler manually:
pnpm trigger:collector     # Fetch listings from sources → listings_raw
pnpm trigger:processor     # Normalize raw → canonical listings
pnpm trigger:notify        # Match filters → send Telegram

# Inspect the local DB:
pnpm db:query:local "SELECT count(*) FROM listings_raw"
pnpm db:query:local "SELECT id, title, price, city FROM listings LIMIT 5"
```

### 4. Run tests

```bash
pnpm test                  # Run all 43 tests once
pnpm test:watch            # Watch mode
pnpm typecheck             # Type-check all workspaces
```

### All convenience scripts

| Script | Description |
|--------|-------------|
| `pnpm dev` | Start all 3 workers concurrently |
| `pnpm dev:collector` | Start collector only (port 8787) |
| `pnpm dev:processor` | Start processor only (port 8788) |
| `pnpm dev:notify` | Start notify only (port 8789) |
| `pnpm trigger:collector` | Fire collector's scheduled handler |
| `pnpm trigger:processor` | Fire processor's scheduled handler |
| `pnpm trigger:notify` | Fire notify's scheduled handler |
| `pnpm db:migrate:local` | Apply all D1 migrations locally |
| `pnpm db:seed:local` | Seed dev user + filter from `scripts/seed-local.sql` |
| `pnpm db:query:local "SQL"` | Run a SQL query against the local DB |
| `pnpm db:reset:local` | Delete local DB (re-run migrate to recreate) |
| `pnpm db:migrate:remote` | Apply migrations to production D1 |
| `pnpm test` | Run all tests |
| `pnpm typecheck` | Type-check all workspaces |

## Deployment

Ready to deploy to production? See **[DEPLOYMENT.md](./DEPLOYMENT.md)** for comprehensive step-by-step instructions covering:
- D1 database setup
- Worker configuration
- Manual and automated deployment options
- Troubleshooting and monitoring

## Cron Schedules

| Worker    | Schedule     | Purpose                              |
|-----------|--------------|--------------------------------------|
| Collector | Every 30 min | Fetch new listings from sources      |
| Processor | Every 15 min | Normalize and extract structured data|
| Notify    | Every 5 min  | Match filters and send Telegram msgs |

## Development Methodology

This project uses **Spec-Driven Development** (SDD). All features go through four phases before implementation:

1. **Specify** — requirements and scope (`spec.md`)
2. **Design** — architecture and interfaces (`design.md`)
3. **Tasks** — granular implementation tasks (`tasks.md`)
4. **Implement + Validate** — code with verification

Spec documents live in `.specs/features/<feature-name>/`. The project roadmap and vision are in `.specs/project/`.

## Roadmap

| Milestone | Description | Status |
|-----------|-------------|--------|
| **M1** | Foundation — monorepo, shared packages, D1 schema, 3 workers with mock connector | Done |
| **M2** | First Live Source — YAD2 connector, extraction tuning, Telegram bot, deploy | In Progress |
| **M3** | Multi-User & Filters — Telegram bot commands, filter management | Planned |
| **M4** | Additional Sources — Facebook and other connectors | Planned |

## License

MIT
