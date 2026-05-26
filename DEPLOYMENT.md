# Deployment Guide

## Prerequisites

1. **Cloudflare Account** - Sign up at https://dash.cloudflare.com
2. **Cloudflare API Token** - Create one with Workers permissions
3. **D1 Database** - Create your production database

## Step 1: Create D1 Database

```bash
# Create the D1 database
pnpm --filter @rentifier/collector exec wrangler d1 create rentifier

# This will output something like:
# ✅ Successfully created DB 'rentifier'!
# database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

Copy the `database_id` from the output.

## Step 2: Update Database IDs

Update the `database_id` in all configuration files:

**Root level:**
- `wrangler.migrations.json` (used for migrations only)

**Worker configurations:**
- `apps/collector/wrangler.json`
- `apps/processor/wrangler.json`
- `apps/notify/wrangler.json`

Replace `00000000-0000-0000-0000-000000000000` with your actual database ID in all files.

## Step 3: Run Migrations

```bash
# Apply migrations to production
pnpm db:migrate:remote
```

## Step 4: Deploy Workers

### Option A: Manual Deployment (Local)

```bash
# Deploy all workers
pnpm deploy:all

# Or deploy individually
pnpm deploy:collector
pnpm deploy:processor
pnpm deploy:notify
```

### Option B: Automated Deployment (Cloudflare GitHub App)

The Cloudflare GitHub app auto-deploys on merge to main.

**Configuration for each worker in Cloudflare Dashboard:**

1. Go to Cloudflare Dashboard → Workers & Pages
2. For each worker, configure:

**Collector Worker:**
- **Root directory**: `apps/collector`
- **Build command**: `cd ../.. && pnpm install --frozen-lockfile`
- **Deploy command**: `npx wrangler deploy`

**Processor Worker:**
- **Root directory**: `apps/processor`
- **Build command**: `cd ../.. && pnpm install --frozen-lockfile`
- **Deploy command**: `npx wrangler deploy`

**Notify Worker:**
- **Root directory**: `apps/notify`
- **Build command**: `cd ../.. && pnpm install --frozen-lockfile`
- **Deploy command**: `npx wrangler deploy`

**Why the `cd ../..`?** Since root directory is set to the worker folder, we need to change to the monorepo root to install all dependencies (including shared packages). Then wrangler deploy runs from the worker directory where it finds `wrangler.json`.

## Step 5: Verify Deployment

Check the Cloudflare dashboard to see your deployed workers:
- https://dash.cloudflare.com → Workers & Pages

Each worker should appear:
- `rentifier-collector` (runs every 30 minutes)
- `rentifier-processor` (runs every 15 minutes)
- `rentifier-notify` (runs every 5 minutes)

## Troubleshooting

### "Missing entry-point to Worker script"
This error occurs when `wrangler.json` is missing or the deploy command is running from the wrong directory. Ensure each worker directory has a `wrangler.json` file and the Cloudflare app root directory is set correctly.

### Database ID is still placeholder
Make sure you've updated all `wrangler.json` files (root + all three workers) with your actual D1 database ID.

### Workers not triggering on schedule
Scheduled triggers (crons) only work in production. In development, use the manual trigger commands:
```bash
pnpm trigger:collector
pnpm trigger:processor
pnpm trigger:notify
```

## Environment Variables

If you need to add secrets or environment variables:

```bash
# Set a secret for a worker
pnpm --filter @rentifier/collector exec wrangler secret put SECRET_NAME

# Or add to wrangler.json:
{
  "vars": {
    "ENVIRONMENT": "production"
  }
}
```

## GitHub Actions Secrets — Facebook Collector

The `Collect Facebook Listings` workflow runs the Playwright scraper and reads the following GitHub Secrets:

| Secret | Required | Purpose |
|---|---|---|
| `FB_ACCOUNT_COUNT` | yes | Number of Facebook accounts (e.g. `1` or `2`). |
| `FB_COOKIES_1`, `FB_COOKIES_2` | yes | Persisted cookie string per account (used to seed the browser profile). |
| `FB_AUTO_LOGIN_ENABLED` | optional | Kill switch for the reactive auto-login flow. Set to `true` to enable; unset / `false` reverts to manual cookie recovery. |
| `FB_EMAIL_1`, `FB_PASSWORD_1` | optional | Credentials for account #1, used only when `FB_AUTO_LOGIN_ENABLED=true` and the persisted session has expired. |
| `FB_EMAIL_2`, `FB_PASSWORD_2` | optional | Same for account #2. |
| `FB_EMAIL`, `FB_PASSWORD` | optional | Single-account fallback (used only when `FB_ACCOUNT_COUNT=1` and the scoped vars are unset). |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_CHAT_ID` | optional | Admin alerts for cookie expiry / auto-login failures. |

**Recommended rollout order**: set credentials first, flip `FB_AUTO_LOGIN_ENABLED=true` last — auto-login activates immediately on the next cron tick.

**Budget**: the connector will attempt at most 3 logins per account per 24h window before backing off (see `MAX_LOGIN_ATTEMPTS_PER_EPISODE` in `packages/connectors/src/facebook/login.ts`). The window resets automatically on first new attempt after 24h elapsed; the counter clears immediately on a successful login.

## Monitoring

View logs for your workers:

```bash
pnpm --filter @rentifier/collector exec wrangler tail
pnpm --filter @rentifier/processor exec wrangler tail
pnpm --filter @rentifier/notify exec wrangler tail
```
