#!/usr/bin/env tsx
/**
 * Setup script to register Telegram webhook
 *
 * Usage:
 *   1. Copy .env.example to .env and fill in your values
 *   2. Run: tsx scripts/setup-webhook.ts
 *
 * Or pass environment variables directly:
 *   TELEGRAM_BOT_TOKEN=<token> \
 *   TELEGRAM_WEBHOOK_URL=https://notify.rentifier.workers.dev/webhook \
 *   TELEGRAM_WEBHOOK_SECRET=<secret> \
 *   tsx scripts/setup-webhook.ts
 */

import { config } from 'dotenv';

// Load .env file from root
config();

const botToken = process.env.TELEGRAM_BOT_TOKEN;
const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;
const secretToken = process.env.TELEGRAM_WEBHOOK_SECRET;

if (!botToken) {
  console.error('❌ TELEGRAM_BOT_TOKEN environment variable is required');
  process.exit(1);
}

if (!webhookUrl) {
  console.error('❌ TELEGRAM_WEBHOOK_URL environment variable is required');
  process.exit(1);
}

async function setupWebhook() {
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: secretToken,
        allowed_updates: ['message'],
      }),
    });

    const result = await response.json();

    if (result.ok) {
      console.log('✅ Webhook registered successfully!');
      console.log('   URL:', webhookUrl);
      console.log('   Secret token:', secretToken ? 'Set' : 'Not set (optional)');
    } else {
      console.error('❌ Failed to register webhook:', result.description);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

setupWebhook();
