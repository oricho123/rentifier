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

### Create the D1 database

```bash
wrangler d1 create rentifier
```

Copy the returned `database_id` into each `wrangler.toml` file under `apps/collector/`, `apps/processor/`, and `apps/notify/`.

### Apply migrations

```bash
# Local development
wrangler d1 migrations apply rentifier --local

# Production
wrangler d1 migrations apply rentifier --remote
```

### Run tests

```bash
pnpm test          # run all tests once
pnpm test:watch    # run in watch mode
```

### Run all workers locally

```bash
pnpm dev
```

This starts all three workers concurrently with colored output. Or run individually:

```bash
pnpm dev:collector    # port 8787
pnpm dev:processor    # port 8788
pnpm dev:notify       # port 8789
```

### Trigger a scheduled worker manually

While a worker is running locally, trigger its cron handler:

```bash
pnpm trigger:collector
pnpm trigger:processor
pnpm trigger:notify
```

### Deploy to Cloudflare

```bash
# Set Telegram bot token as a secret (notify worker)
cd apps/notify
wrangler secret put TELEGRAM_BOT_TOKEN

# Deploy all workers
cd apps/collector && wrangler deploy
cd apps/processor && wrangler deploy
cd apps/notify && wrangler deploy
```

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
