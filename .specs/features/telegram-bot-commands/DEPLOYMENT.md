# Telegram Bot Commands - Deployment Guide

## Implementation Status

✅ **COMPLETE** - All core functionality implemented and tested.

### Completed Tasks

**Phase 1: Database & Types**
- ✅ T1: conversation_state migration created
- ✅ T2: Telegram API types defined
- ✅ T3: TelegramClient extended with inline keyboard support
- ✅ T4: ConversationStateManager implemented
- ✅ T5: BotService implemented

**Phase 2: Command Handlers**
- ✅ T6: Command handler interfaces
- ✅ T7: StartCommand - user registration
- ✅ T8: HelpCommand - command list
- ✅ T9: ListCommand - view filters
- ✅ T10: PauseCommand - disable notifications
- ✅ T11: ResumeCommand - enable notifications
- ✅ T12: DeleteCommand - remove filters
- ✅ T13: FilterCommand - multi-step filter creation

**Phase 3: Routing & Integration**
- ✅ T14: CommandRouter - message routing
- ✅ T15: Webhook handler - Telegram update processing
- ✅ T16: Worker entry point - fetch() handler added

**Phase 4: Configuration & Tooling**
- ✅ Webhook registration script created

## Deployment Steps

### 1. Apply Database Migration

```bash
# Apply to local D1 (for development)
wrangler d1 execute rentifier --local --file=packages/db/migrations/0006_conversation_state.sql

# Apply to remote D1 (for production)
wrangler d1 execute rentifier --remote --file=packages/db/migrations/0006_conversation_state.sql
```

### 2. Set Webhook Secret (Optional but Recommended)

```bash
# Generate a random secret
SECRET=$(openssl rand -hex 32)

# Set as Cloudflare secret
echo $SECRET | wrangler secret put TELEGRAM_WEBHOOK_SECRET --env production
```

### 3. Deploy Notify Worker

```bash
# Deploy to production
pnpm --filter @rentifier/notify deploy

# Or deploy to preview
pnpm --filter @rentifier/notify deploy --env preview
```

### 4. Register Webhook with Telegram

```bash
# Set environment variables
export TELEGRAM_BOT_TOKEN="your-bot-token-here"
export WEBHOOK_URL="https://rentifier-notify.your-account.workers.dev/webhook"
export TELEGRAM_WEBHOOK_SECRET="your-secret-from-step-2"

# Run setup script
tsx scripts/setup-webhook.ts
```

Expected output:
```
✅ Webhook registered successfully!
   URL: https://rentifier-notify.your-account.workers.dev/webhook
   Secret token: Set
```

### 5. Verify Deployment

Test the bot by sending commands:

1. **Start the bot**: `/start`
   - Should receive welcome message
   - User record created in database

2. **Create a filter**: `/filter`
   - Follow the multi-step flow
   - Filter saved in database

3. **List filters**: `/list`
   - Should see the created filter

4. **Test notifications**: Wait for cron trigger or manually trigger
   - Matching listings should be sent via Telegram

## Local Development

### Run Local Dev Server

```bash
cd apps/notify
pnpm dev
```

The worker will be available at `http://localhost:8787`.

### Test Webhook Locally (with ngrok)

Since Telegram requires HTTPS, use ngrok to expose local dev server:

```bash
# Start ngrok
ngrok http 8787

# Copy the HTTPS URL (e.g., https://abc123.ngrok.io)
# Register webhook
TELEGRAM_BOT_TOKEN=your-token \
WEBHOOK_URL=https://abc123.ngrok.io/webhook \
tsx scripts/setup-webhook.ts
```

Now send messages to your bot and they'll be forwarded to your local dev server.

### Test with Mock Updates (No ngrok needed)

Send a test update directly to the local webhook:

```bash
curl -X POST http://localhost:8787/webhook \
  -H "Content-Type: application/json" \
  -H "X-Telegram-Bot-Api-Secret-Token: test-secret" \
  -d '{
    "update_id": 123,
    "message": {
      "message_id": 1,
      "from": {
        "id": 12345,
        "is_bot": false,
        "first_name": "Test",
        "last_name": "User"
      },
      "chat": {
        "id": 12345,
        "type": "private"
      },
      "date": 1234567890,
      "text": "/start"
    }
  }'
```

## Environment Variables

### Required

- `TELEGRAM_BOT_TOKEN` - Telegram Bot API token (set via `wrangler secret put`)
- `DB` - D1 database binding (configured in wrangler.json)

### Optional

- `TELEGRAM_WEBHOOK_SECRET` - Webhook validation secret (recommended for production)

## Monitoring

### Check Logs

```bash
# Tail production logs
wrangler tail

# Tail with filtering
wrangler tail --format pretty | grep webhook
```

### Verify Webhook Status

```bash
curl https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getWebhookInfo
```

Expected response:
```json
{
  "ok": true,
  "result": {
    "url": "https://rentifier-notify.your-account.workers.dev/webhook",
    "has_custom_certificate": false,
    "pending_update_count": 0
  }
}
```

## Troubleshooting

### Webhook not receiving updates

1. Check webhook registration:
   ```bash
   curl https://api.telegram.org/bot<TOKEN>/getWebhookInfo
   ```

2. Verify worker is deployed and responding:
   ```bash
   curl https://rentifier-notify.your-account.workers.dev/webhook
   # Should return 404 for GET requests
   ```

3. Check Cloudflare logs for errors:
   ```bash
   wrangler tail
   ```

### Database errors

1. Verify migration was applied:
   ```bash
   wrangler d1 execute rentifier --remote --command="SELECT name FROM sqlite_master WHERE type='table'"
   ```

   Should include `conversation_state` table.

2. Check D1 bindings in wrangler.json

### TypeScript errors

Run typecheck:
```bash
pnpm typecheck
```

## Next Steps

After successful deployment:

1. **Test filter matching**: Create filters and verify listings are matched
2. **Monitor performance**: Check worker CPU usage and response times
3. **Add more features**: Consider implementing `/edit` command for editing filters
4. **Add inline keyboards**: Enhance UX with button-based interactions
5. **Implement pagination**: For `/list` command when users have many filters

## Rollback

If issues arise, roll back the deployment:

```bash
# Delete webhook
curl -X POST https://api.telegram.org/bot<TOKEN>/deleteWebhook

# Revert to previous worker version (if needed)
wrangler rollback
```
