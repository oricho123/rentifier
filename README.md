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

## Telegram Bot Setup

### 1. Create Your Bot

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow prompts to create your bot
3. Save the bot token (looks like `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`)
4. (Optional) Configure bot description, about text, and profile picture via BotFather

### 2. Get Your Chat ID

To receive notifications, you need your Telegram chat ID:

1. Message [@userinfobot](https://t.me/userinfobot) on Telegram
2. It will reply with your user info, including your chat ID (a number like `123456789`)
3. Save this chat ID — you'll need it for seeding the database

## Local Development

No Docker needed — Wrangler simulates Cloudflare Workers + D1 locally.

**⚠️ VPN Note:** If you experience "internal error; reference = ..." errors when making API calls in local development, try **disabling your VPN**. This is a known issue with Wrangler's local mode where VPN interferes with Miniflare's network stack.

### 1. Set up environment variables

You need two environment files:

**For scripts** (webhook setup, etc.):

```bash
cp .env.example .env
```

Edit `.env` and set:

- `TELEGRAM_BOT_TOKEN`: Your bot token from BotFather
- `TELEGRAM_WEBHOOK_SECRET`: Any random string for local development
- `TELEGRAM_WEBHOOK_URL`: Your ngrok URL (update this when you start ngrok)

**For the worker** (runtime):

```bash
cp apps/notify/.dev.vars.example apps/notify/.dev.vars
```

Edit `apps/notify/.dev.vars` and set:

- `TELEGRAM_BOT_TOKEN`: Your bot token from BotFather (same as above)
- `TELEGRAM_WEBHOOK_SECRET`: Same secret as in `.env`

### 2. Set up the local database

```bash
pnpm db:migrate:local     # Create tables, indexes, seed sources
pnpm db:seed:local        # Add a dev user + catch-all filter
```

Edit `scripts/seed-local.sql` first to set your Telegram chat ID (or leave the placeholder for now).

### 3. Run all workers

```bash
pnpm dev
```

This starts all three workers concurrently (collector:8787, processor:8788, notify:8789).

### 4. Test the Telegram bot locally

You have two options for local testing:

#### Option A: ngrok tunnel (recommended for full testing)

```bash
# Install ngrok if needed: brew install ngrok
ngrok http 8789

# Copy the HTTPS URL (e.g., https://abc123.ngrok.io/webhook)
# Update TELEGRAM_WEBHOOK_URL in your .env file, then:
tsx scripts/setup-webhook.ts

# Now send commands to your bot on Telegram:
# /start, /help, /filter, etc.
```

#### Option B: Mock testing without ngrok

```bash
# Test webhook handler directly with curl
curl -X POST http://localhost:8789/webhook \
  -H "Content-Type: application/json" \
  -H "X-Telegram-Bot-Api-Secret-Token: local-dev-secret" \
  -d '{
    "update_id": 1,
    "message": {
      "message_id": 1,
      "from": {"id": 123456789, "first_name": "Test"},
      "chat": {"id": 123456789, "type": "private"},
      "date": 1234567890,
      "text": "/start"
    }
  }'
```

### 5. Test the pipeline

```bash
# Trigger each worker's cron handler manually:
pnpm trigger:collector     # Fetch listings from sources → listings_raw
pnpm trigger:processor     # Normalize raw → canonical listings
pnpm trigger:notify        # Match filters → send Telegram

# Inspect the local DB:
pnpm db:query:local "SELECT count(*) FROM listings_raw"
pnpm db:query:local "SELECT id, title, price, city FROM listings LIMIT 5"
```

### 6. Run tests

```bash
pnpm test                  # Run all 43 tests once
pnpm test:watch            # Watch mode
pnpm typecheck             # Type-check all workspaces
```

### All convenience scripts

| Script                      | Description                                          |
| --------------------------- | ---------------------------------------------------- |
| `pnpm dev`                  | Start all 3 workers concurrently                     |
| `pnpm dev:collector`        | Start collector only (port 8787)                     |
| `pnpm dev:processor`        | Start processor only (port 8788)                     |
| `pnpm dev:notify`           | Start notify only (port 8789)                        |
| `pnpm trigger:collector`    | Fire collector's scheduled handler                   |
| `pnpm trigger:processor`    | Fire processor's scheduled handler                   |
| `pnpm trigger:notify`       | Fire notify's scheduled handler                      |
| `pnpm db:migrate:local`     | Apply all D1 migrations locally                      |
| `pnpm db:seed:local`        | Seed dev user + filter from `scripts/seed-local.sql` |
| `pnpm db:query:local "SQL"` | Run a SQL query against the local DB                 |
| `pnpm db:reset:local`       | Delete local DB (re-run migrate to recreate)         |
| `pnpm db:migrate:remote`    | Apply migrations to production D1                    |
| `pnpm test`                 | Run all tests                                        |
| `pnpm typecheck`            | Type-check all workspaces                            |

## Telegram Bot Commands

Once registered via `/start`, users can manage their notification preferences:

| Command                 | Description                                                                    |
| ----------------------- | ------------------------------------------------------------------------------ |
| `/start`                | Register as a new user and receive welcome message                             |
| `/help`                 | Show available commands and usage instructions                                 |
| `/filter`               | Create a new filter with guided prompts (name, cities, price, rooms, keywords) |
| `/list`                 | Show all your active filters                                                   |
| `/pause <filter_name>`  | Pause notifications for a specific filter                                      |
| `/resume <filter_name>` | Resume notifications for a paused filter                                       |
| `/delete <filter_name>` | Delete a filter permanently                                                    |

Example workflow:

```
User: /start
Bot: Welcome! You're now registered. Use /filter to create your first filter.

User: /filter
Bot: Let's create a new filter. What should we call it?
User: Tel Aviv Apartments
Bot: Great! Which cities? (comma-separated)
User: תל אביב-יפו, רמת גן
Bot: Min price? (or 'skip')
User: 3000
Bot: Max price? (or 'skip')
User: 6000
Bot: Min rooms? (or 'skip')
User: 2
Bot: Max rooms? (or 'skip')
User: 3
Bot: Any keywords to include? (comma-separated, or 'skip')
User: מרפסת, חניה
Bot: ✅ Filter "Tel Aviv Apartments" created successfully!

User: /list
Bot: Your active filters:
📌 Tel Aviv Apartments (active)
   Cities: תל אביב-יפו, רמת גן
   Price: ₪3,000 - ₪6,000
   Rooms: 2-3
   Keywords: מרפסת, חניה
```

## Production Deployment

### Telegram Bot Webhook

After deploying your workers to Cloudflare:

1. Set secrets in Cloudflare:

   ```bash
   pnpm --filter @rentifier/notify exec wrangler secret put TELEGRAM_BOT_TOKEN --name rentifier-notify
   pnpm --filter @rentifier/notify exec wrangler secret put TELEGRAM_WEBHOOK_SECRET --name rentifier-notify
   ```

2. Register webhook with Telegram:

   ```bash
   # Update .env with your production webhook URL:
   # TELEGRAM_WEBHOOK_URL=https://notify.your-subdomain.workers.dev/webhook

   tsx scripts/setup-webhook.ts
   ```

3. Verify webhook is registered:
   ```bash
   curl https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getWebhookInfo
   ```

See **[DEPLOYMENT.md](./DEPLOYMENT.md)** for comprehensive deployment instructions covering:

- D1 database setup and migrations
- Worker configuration and secrets
- Telegram bot setup and webhook registration
- Manual and automated deployment workflows
- Troubleshooting and monitoring

## Cron Schedules

| Worker    | Schedule     | Purpose                               |
| --------- | ------------ | ------------------------------------- |
| Collector | Every 30 min | Fetch new listings from sources       |
| Processor | Every 15 min | Normalize and extract structured data |
| Notify    | Every 5 min  | Match filters and send Telegram msgs  |

## Development Methodology

This project uses **Spec-Driven Development** (SDD). All features go through four phases before implementation:

1. **Specify** — requirements and scope (`spec.md`)
2. **Design** — architecture and interfaces (`design.md`)
3. **Tasks** — granular implementation tasks (`tasks.md`)
4. **Implement + Validate** — code with verification

Spec documents live in `.specs/features/<feature-name>/`. The project roadmap and vision are in `.specs/project/`.

## Roadmap

| Milestone | Description                                                                      | Status      |
| --------- | -------------------------------------------------------------------------------- | ----------- |
| **M1**    | Foundation — monorepo, shared packages, D1 schema, 3 workers with mock connector | Done        |
| **M2**    | First Live Source — YAD2 connector, extraction tuning, Telegram bot, deploy      | In Progress |
| **M3**    | Multi-User & Filters — Telegram bot commands, filter management                  | Planned     |
| **M4**    | Additional Sources — Facebook and other connectors                               | Planned     |

## License

MIT
