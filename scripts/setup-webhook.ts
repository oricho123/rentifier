/**
 * Webhook setup script for local development
 *
 * Usage:
 *   1. Start ngrok: ngrok http 8787
 *   2. Copy the HTTPS URL from ngrok
 *   3. Set WEBHOOK_URL in .env: WEBHOOK_URL=https://xxxx.ngrok.io/webhook
 *   4. Run: pnpm webhook:setup
 */

import { config } from 'dotenv';

config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const SECRET_TOKEN = process.env.TELEGRAM_WEBHOOK_SECRET;

if (!BOT_TOKEN) {
  console.error('❌ TELEGRAM_BOT_TOKEN not found in .env');
  process.exit(1);
}

if (!WEBHOOK_URL) {
  console.error('❌ WEBHOOK_URL not found in .env');
  console.log('\nSteps to set up webhook:');
  console.log('1. Start ngrok: ngrok http 8787');
  console.log('2. Copy the HTTPS URL (e.g., https://xxxx.ngrok.io)');
  console.log('3. Add to apps/notify/.env: WEBHOOK_URL=https://xxxx.ngrok.io/webhook');
  console.log('4. Run this script again');
  process.exit(1);
}

async function setupWebhook() {
  console.log('Setting up Telegram webhook...');
  console.log(`Bot Token: ${BOT_TOKEN.slice(0, 10)}...`);
  console.log(`Webhook URL: ${WEBHOOK_URL}`);

  const url = `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`;
  const body: any = {
    url: WEBHOOK_URL,
    allowed_updates: ['message', 'callback_query'],
  };

  if (SECRET_TOKEN) {
    body.secret_token = SECRET_TOKEN;
    console.log(`Secret Token: ${SECRET_TOKEN.slice(0, 10)}...`);
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (data.ok) {
      console.log('✅ Webhook configured successfully!');
      console.log('\nWebhook Info:');
      console.log(`  URL: ${WEBHOOK_URL}`);
      console.log(`  Allowed updates: message, callback_query`);
      if (SECRET_TOKEN) {
        console.log(`  Secret token: enabled`);
      }
      console.log('\n🚀 Your bot is ready to receive updates!');
      console.log('\nNext steps:');
      console.log('1. Make sure `pnpm dev` is running (in another terminal)');
      console.log('2. Send /start to your bot in Telegram');
    } else {
      console.error('❌ Webhook setup failed:');
      console.error(JSON.stringify(data, null, 2));
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error setting up webhook:', error);
    process.exit(1);
  }
}

setupWebhook();
