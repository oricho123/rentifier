# Rentifier

Automated apartment-listing aggregator for Israeli rental markets. Ingests posts from multiple sources (YAD2, Facebook Groups), normalizes and extracts structured data using regex rules and AI fallback, and delivers matching listings to users via Telegram.

## Architecture

```
GitHub Actions (every 30min)       Processor Worker (every 15min)     Notify Worker (every 5min)
   │                                    │                                  │
   ├─ scrape YAD2 via D1 REST API      │ normalize + extract fields       │ match user filters
   ├─ scrape Facebook via Playwright    │ AI fallback for missing fields   │ send Telegram photos
   │  (headless Chromium)               │ upsert canonical listings        │ with Google Maps links
   ▼                                    ▼                                  ▼
┌──────────────────────────────── Cloudflare D1 ──────────────────────────────────────┐
│ sources │ source_state │ listings_raw │ listings │ users │ filters │ worker_state   │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

> **Why GitHub Actions for scraping?** Cloudflare Workers' AS13335 IP range is blocked by Radware Bot Manager on yad2.co.il, and Facebook requires a real browser engine (Playwright). GitHub Actions runners use unblocked IPs and can run headless Chromium. Locally, both connectors work via your machine's IP.

## Project Structure

```
rentifier/
├── apps/
│   ├── collector/          # Cron-triggered source ingestion worker
│   ├── processor/          # Normalization + extraction + AI fallback worker
│   └── notify/             # Filter matching + Telegram notification worker
├── packages/
│   ├── core/               # Shared types, Zod schemas, constants
│   ├── db/                 # D1 migrations (12), schema types, query helpers, REST client
│   ├── connectors/         # Connector interface + implementations
│   │   ├── yad2/           #   YAD2 map API connector
│   │   └── facebook/       #   Facebook Groups Playwright scraper + normalizer
│   └── extraction/         # Rules-based + AI field extraction (Hebrew + English)
├── scripts/                # Collection scripts, webhook setup, debugging tools
├── .github/workflows/      # CI + scheduled scrapers (YAD2, Facebook)
└── .specs/                 # Spec-driven development documents
    ├── project/            #   PROJECT.md, ROADMAP.md, STATE.md
    └── features/           #   Per-feature spec, design, tasks
```

## Tech Stack

| Layer           | Technology                                            |
| --------------- | ----------------------------------------------------- |
| Runtime         | Cloudflare Workers (TypeScript)                       |
| Database        | Cloudflare D1 (serverless SQLite)                     |
| AI Extraction   | Cloudflare Workers AI (Llama 3.1 8B Instruct)        |
| Scheduling      | Cloudflare Cron Triggers + GitHub Actions cron        |
| Browser scraping| Playwright (headless Chromium)                        |
| Notifications   | Telegram Bot API (photos, inline keyboards, webhooks) |
| Validation      | Zod                                                   |
| Monorepo        | pnpm workspaces                                       |
| Testing         | Vitest (267 tests across 13 files)                    |
| CI              | GitHub Actions (typecheck + tests on every PR)        |

## Data Sources

### YAD2

Israel's largest real estate platform. The connector queries the YAD2 map API per city, extracting structured fields (price, rooms, address, images) directly from API responses.

- **Collection:** GitHub Actions workflow (every 30 min) via D1 REST API
- **Why not Workers?** Radware Bot Manager blocks Cloudflare's IP range
- **City rotation:** Fetches one city per run in priority order from `monitored_cities` table
- **API limit:** Max 200 results per query; the collector logs warnings at this threshold

### Facebook Groups

Scrapes Israeli rental groups using Playwright headless browser. Posts are extracted from rendered DOM, including "See more" expansion for truncated content.

- **Collection:** GitHub Actions workflow (every 30 min) with Playwright + Chromium
- **Authentication:** Multi-account cookie rotation (`FB_COOKIES_1..N` secrets)
- **Disabled account tracking:** Automatically skips accounts flagged by Facebook
- **Admin alerts:** Sends Telegram notification when cookies expire
- **Normalizer:** Separate `FacebookNormalizer` class prevents Playwright from being bundled into Workers

## Extraction Pipeline

All listings go through a two-stage extraction pipeline:

### Stage 1: Regex/Rules (zero cost)

Pattern-based extraction for Hebrew and English text:

| Field         | Examples                                                      |
| ------------- | ------------------------------------------------------------- |
| Price         | `5,000 ₪`, `שכירות 7,600`, `שכ'ד 4,500`, `ב7,600`, `$2,000` |
| Bedrooms      | `3 חדרים`, `3.5 חד'`, `סטודיו`, `2 rooms`                    |
| City          | `תל אביב`, `ת"א`, `ת״א`, `ירושלים` (with variant mapping)   |
| Neighborhood  | `פלורנטין`, `צפון הישן`, `נווה צדק`                          |
| Street        | `רחוב דיזנגוף`, `ברח' הרצל`, `בן יהודה 5`                   |
| Tags          | `מרפסת`, `חניה`, `מעלית`, `מרוהט`, `חיות` + English variants |
| Negation      | `בלי מעלית` does NOT match the `elevator` tag                 |

Tags supported: `parking`, `balcony`, `pets`, `furnished`, `immediate`, `long-term`, `accessible`, `air-conditioning`, `elevator`, `storage`, `renovated`

### Stage 2: AI Fallback (budget-capped)

When regex misses key fields (neighborhood, street, price, or city), the processor invokes Cloudflare Workers AI:

- **Model:** `@cf/meta/llama-3.1-8b-instruct`
- **Gate:** Only triggered for non-YAD2 sources when specific fields are null
- **Budget:** Max 20 AI calls per processor batch
- **Merge strategy:** Regex results take priority; AI fills gaps with 0.6 confidence
- **Confidence scoring:** Weighted formula — price (0.30), city (0.25), bedrooms (0.20), neighborhood (0.10), street (0.05), tags (0.05)

## Telegram Bot

The bot is fully localized in Hebrew with interactive inline keyboards.

### Commands

| Command   | Description                                                        |
| --------- | ------------------------------------------------------------------ |
| `/start`  | Register and receive welcome message                               |
| `/help`   | Show available commands                                            |
| `/filter` | Create a filter with guided prompts (city, price, rooms, keywords) |
| `/list`   | Show all your filters with edit/delete buttons                     |
| `/pause`  | Pause notifications for a filter                                   |
| `/resume` | Resume a paused filter                                             |
| `/delete` | Delete a filter                                                    |

### Notification Features

- **Photo messages** with listing image (falls back to text on failure)
- **Clickable street addresses** linked to Google Maps
- **Hebrew formatting** with price in ₪, room counts, neighborhood
- **Filter matching:** price range, bedrooms, city, neighborhood, keywords (OR), must-have tags (AND), exclude tags (NOT)
- **Deduplication** via `notifications_sent` table — each user gets each listing at most once

## Prerequisites

- Node.js >= 18
- pnpm >= 10
- Wrangler CLI (`npm install -g wrangler`)
- A Cloudflare account (free tier is sufficient)
- Playwright (for Facebook scraping only): `pnpm exec playwright install chromium`

## Getting Started

### 1. Install dependencies

```bash
pnpm install
```

### 2. Create your Telegram bot

1. Message [@BotFather](https://t.me/BotFather) on Telegram, send `/newbot`
2. Save the bot token (e.g., `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`)
3. Message [@userinfobot](https://t.me/userinfobot) to get your chat ID

### 3. Set up environment variables

**For scripts** (webhook setup, collection scripts):

```bash
cp .env.example .env
```

Edit `.env`:

```env
TELEGRAM_BOT_TOKEN=your-bot-token
TELEGRAM_WEBHOOK_SECRET=any-random-string
WEBHOOK_URL=https://your-ngrok-subdomain.ngrok.io/webhook

# For Facebook collection (optional)
FB_ACCOUNT_COUNT=1
FB_COOKIES_1=your-facebook-cookie-string
TELEGRAM_ADMIN_CHAT_ID=your-chat-id
```

**For the notify worker** (runtime):

```bash
cp apps/notify/.dev.vars.example apps/notify/.dev.vars
```

Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET`.

**For the collector worker** (optional — enables YAD2 locally):

```bash
echo "ENABLE_YAD2_CONNECTOR=true" > apps/collector/.dev.vars
```

### 4. Set up the local database

```bash
pnpm db:migrate:local     # Create tables, indexes, seed sources and cities
```

Migrations automatically seed three default monitored cities:
- תל אביב (Tel Aviv) — Code: 5000, Priority: 100
- ירושלים (Jerusalem) — Code: 3000, Priority: 90
- חיפה (Haifa) — Code: 4000, Priority: 80

Users register themselves via the `/start` bot command — no manual seeding needed.

### 5. Run all workers

```bash
pnpm dev
```

Starts collector (`:8787`), processor (`:8788`), and notify (`:8789`) concurrently.

> **VPN Note:** If you get "internal error; reference = ..." errors, try disabling your VPN. Wrangler's local mode (Miniflare) can conflict with VPN network stacks.

### 6. Test the bot locally

```bash
# Terminal 1: Start ngrok tunnel
ngrok http 8789

# Terminal 2: Register webhook (update WEBHOOK_URL in .env first)
pnpm webhook:setup

# Now send /start to your bot on Telegram
```

### 7. Test the pipeline

```bash
# Trigger each worker manually:
pnpm trigger:collector     # Fetch listings → listings_raw
pnpm trigger:processor     # Normalize → canonical listings
pnpm trigger:notify        # Match filters → send Telegram

# Or trigger all three in sequence:
pnpm trigger:all

# Run collection scripts directly (for Facebook/YAD2):
pnpm collect:yad2:local
pnpm collect:facebook:local

# Inspect the local DB:
pnpm db:query:local "SELECT count(*) FROM listings_raw"
pnpm db:query:local "SELECT id, title, price, city FROM listings LIMIT 5"
```

### 8. Run tests

```bash
pnpm test              # Run all 267 tests
pnpm test:watch        # Watch mode
pnpm typecheck         # Type-check all workspaces
```

## Scripts Reference

### Development

| Script                      | Description                                          |
| --------------------------- | ---------------------------------------------------- |
| `pnpm dev`                  | Start all 3 workers concurrently                     |
| `pnpm dev:collector`        | Start collector only (port 8787)                     |
| `pnpm dev:processor`        | Start processor only (port 8788)                     |
| `pnpm dev:notify`           | Start notify only (port 8789)                        |
| `pnpm test`                 | Run all tests                                        |
| `pnpm test:watch`           | Watch mode                                           |
| `pnpm typecheck`            | Type-check all workspaces                            |

### Pipeline Triggers

| Script                      | Description                                          |
| --------------------------- | ---------------------------------------------------- |
| `pnpm trigger:all`          | Fire all 3 workers' scheduled handlers sequentially  |
| `pnpm trigger:collector`    | Fire collector's scheduled handler                   |
| `pnpm trigger:processor`    | Fire processor's scheduled handler                   |
| `pnpm trigger:notify`       | Fire notify's scheduled handler                      |

### Collection Scripts

| Script                      | Description                                          |
| --------------------------- | ---------------------------------------------------- |
| `pnpm collect:all`          | Run YAD2 + Facebook collection (remote D1)           |
| `pnpm collect:all:local`    | Run YAD2 + Facebook collection (local D1)            |
| `pnpm collect:yad2`         | Run YAD2 scraper (remote D1)                         |
| `pnpm collect:yad2:local`   | Run YAD2 scraper (local D1)                          |
| `pnpm collect:facebook`     | Run Facebook scraper (remote D1)                     |
| `pnpm collect:facebook:local`| Run Facebook scraper (local D1)                     |

### Database

| Script                      | Description                                          |
| --------------------------- | ---------------------------------------------------- |
| `pnpm db:migrate:local`     | Apply all D1 migrations locally                      |
| `pnpm db:migrate:remote`    | Apply migrations to production D1                    |
| `pnpm db:query:local "SQL"` | Run a SQL query against the local DB                 |
| `pnpm db:reset:local`       | Delete local DB (re-run migrate to recreate)         |

### Deployment

| Script                      | Description                                          |
| --------------------------- | ---------------------------------------------------- |
| `pnpm deploy:all`           | Deploy all 3 workers to Cloudflare                   |
| `pnpm deploy:collector`     | Deploy collector worker                              |
| `pnpm deploy:processor`     | Deploy processor worker                              |
| `pnpm deploy:notify`        | Deploy notify worker                                 |
| `pnpm webhook:setup`        | Register Telegram webhook                            |

## City Configuration

The YAD2 connector fetches listings from cities in the `monitored_cities` table. YAD2's API returns max 200 results per request, so targeted city queries ensure complete coverage.

```bash
# View current cities
pnpm db:query:local "SELECT * FROM monitored_cities ORDER BY priority DESC"

# Add a city
pnpm db:query:local "INSERT INTO monitored_cities (city_name, city_code, enabled, priority) VALUES ('רמת גן', 8600, 1, 70)"

# Disable/enable a city
pnpm db:query:local "UPDATE monitored_cities SET enabled=0 WHERE city_code=8600"
pnpm db:query:local "UPDATE monitored_cities SET enabled=1 WHERE city_code=8600"
```

**Common YAD2 city codes:**

| City            | Code |
| --------------- | ---- |
| תל אביב         | 5000 |
| ירושלים         | 3000 |
| חיפה            | 4000 |
| הרצליה          | 6400 |
| רמת גן          | 8600 |
| גבעתיים         | 6300 |
| באר שבע         | 7900 |
| נתניה           | 7400 |
| ראשון לציון     | 8300 |
| פתח תקווה       | 7900 |

The collector fetches one city per run in **priority order** (highest first) and logs warnings when a city returns exactly 200 results (API limit), indicating potential truncation.

## Facebook Setup

Facebook scraping requires browser cookies from an authenticated session.

### 1. Export cookies

1. Log into Facebook in your browser
2. Use a browser extension (e.g., "EditThisCookie") to export cookies as a string
3. Set `FB_COOKIES_1` in your `.env` file (or GitHub Actions secrets for production)

### 2. Configure monitored groups

Facebook groups are stored in the `sources` table with `connector_type = 'facebook'`. Each group can have `defaultCities` in its configuration to assign a city when extraction doesn't find one.

### 3. Multi-account rotation

For resilience, configure multiple accounts:

```env
FB_ACCOUNT_COUNT=2
FB_COOKIES_1=cookie-string-for-account-1
FB_COOKIES_2=cookie-string-for-account-2
```

The connector rotates through accounts and automatically skips any that Facebook has disabled.

### 4. Admin alerts

Set `TELEGRAM_ADMIN_CHAT_ID` to receive Telegram notifications when cookies expire.

## Production Deployment

See **[DEPLOYMENT.md](./DEPLOYMENT.md)** for step-by-step instructions covering D1 setup, worker configuration, secrets, and webhook registration.

### Quick overview

```bash
# 1. Deploy workers
pnpm deploy:all

# 2. Set Cloudflare secrets
pnpm --filter @rentifier/notify exec wrangler secret put TELEGRAM_BOT_TOKEN
pnpm --filter @rentifier/notify exec wrangler secret put TELEGRAM_WEBHOOK_SECRET

# 3. Run migrations on production D1
pnpm db:migrate:remote

# 4. Register Telegram webhook
pnpm webhook:setup
```

### GitHub Actions Secrets

| Secret                | Used by          | Description                              |
| --------------------- | ---------------- | ---------------------------------------- |
| `CF_ACCOUNT_ID`       | YAD2, Facebook   | Cloudflare account ID                    |
| `CF_API_TOKEN`        | YAD2, Facebook   | CF API token with **D1:Edit** permission |
| `CF_D1_DATABASE_ID`   | YAD2, Facebook   | D1 database ID                           |
| `FB_ACCOUNT_COUNT`    | Facebook         | Number of Facebook accounts              |
| `FB_COOKIES_1..N`     | Facebook         | Cookie strings per account               |
| `TELEGRAM_BOT_TOKEN`  | Facebook         | Bot token (for admin cookie alerts)      |
| `TELEGRAM_ADMIN_CHAT_ID` | Facebook      | Admin chat ID for alerts                 |

### Cron Schedules

| Runner              | Schedule     | Purpose                                  |
| ------------------- | ------------ | ---------------------------------------- |
| GitHub Actions      | Every 30 min | Scrape YAD2 listings via D1 REST API     |
| GitHub Actions      | Every 30 min | Scrape Facebook groups via Playwright    |
| Processor Worker    | Every 15 min | Normalize, extract, AI fallback          |
| Notify Worker       | Every 5 min  | Match filters, send Telegram             |

## Development Methodology

This project uses **Spec-Driven Development** (SDD). All features go through four phases:

1. **Specify** — requirements and scope (`spec.md`)
2. **Design** — architecture and interfaces (`design.md`)
3. **Tasks** — granular implementation tasks (`tasks.md`)
4. **Implement + Validate** — code with verification

Documents live in `.specs/features/<feature-name>/`. Project roadmap and state are in `.specs/project/`.

## Roadmap

| Milestone | Description                                                    | Status |
| --------- | -------------------------------------------------------------- | ------ |
| **M1**    | Foundation — monorepo, shared packages, D1 schema, 3 workers   | Done   |
| **M2**    | First Live Source — YAD2 connector, deploy, GitHub Actions      | Done   |
| **M3**    | Multi-User & Filters — Telegram bot, Hebrew UI, filter engine  | Done   |
| **M4**    | Facebook Groups — Playwright scraper, extraction improvements   | Done   |
| **M5**    | Data Quality — AI extraction, duplicate detection, classifiers  | Active |
| **M6**    | User Experience — Web UI, WhatsApp, price trends               | Planned|
| **M7**    | Infrastructure — monitoring, alerting, rate limiting            | Planned|

## License

MIT
