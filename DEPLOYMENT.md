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

Update the `database_id` in:
- `wrangler.json` (root - used for migrations)
- `apps/collector/wrangler.toml`
- `apps/processor/wrangler.toml`
- `apps/notify/wrangler.toml`

Replace `00000000-0000-0000-0000-000000000000` with your actual database ID.

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

### Option B: Automated Deployment (GitHub Actions)

1. Add your Cloudflare API Token to GitHub Secrets:
   - Go to your repository Settings → Secrets and variables → Actions
   - Click "New repository secret"
   - Name: `CLOUDFLARE_API_TOKEN`
   - Value: Your Cloudflare API token

2. Push to main branch:
   ```bash
   git push origin main
   ```

The GitHub Action will automatically deploy all three workers.

## Step 5: Verify Deployment

Check the Cloudflare dashboard to see your deployed workers:
- https://dash.cloudflare.com → Workers & Pages

Each worker should appear:
- `rentifier-collector` (runs every 30 minutes)
- `rentifier-processor` (runs every 15 minutes)
- `rentifier-notify` (runs every 5 minutes)

## Troubleshooting

### "Missing entry-point to Worker script"
This error occurs when deploying from the wrong directory. Always use the deployment scripts or GitHub Actions, which deploy from each worker's directory.

### Database ID is still placeholder
Make sure you've updated all three `wrangler.toml` files with your actual D1 database ID.

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

# Or add to wrangler.toml:
[vars]
ENVIRONMENT = "production"
```

## Monitoring

View logs for your workers:

```bash
pnpm --filter @rentifier/collector exec wrangler tail
pnpm --filter @rentifier/processor exec wrangler tail
pnpm --filter @rentifier/notify exec wrangler tail
```
