import type { TelegramUpdate } from './types';
import { createDB } from '@rentifier/db';
import { TelegramClient } from '../telegram-client';
import { BotService } from '../bot-service';
import { ConversationStateManager } from '../conversation-state';
import { CommandRouter } from '../commands/router';
import { CallbackQueryRouter } from '../callbacks/router';

export interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
}

export async function handleWebhook(request: Request, env: Env): Promise<Response> {
  try {
    // 1. Validate webhook authenticity (optional secret token check)
    if (env.TELEGRAM_WEBHOOK_SECRET) {
      const secretToken = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
      if (secretToken !== env.TELEGRAM_WEBHOOK_SECRET) {
        console.log('Webhook validation failed: invalid secret token');
        return new Response('Unauthorized', { status: 403 });
      }
    }

    // 2. Parse Telegram update
    const update = (await request.json()) as TelegramUpdate;
    console.log(JSON.stringify({ event: 'webhook_received', updateId: update.update_id }));

    // 3. Initialize services
    const telegram = new TelegramClient(env.TELEGRAM_BOT_TOKEN);
    const botService = new BotService(env.DB);
    const stateManager = new ConversationStateManager(env.DB);
    const commandRouter = new CommandRouter(telegram, botService, stateManager);
    const callbackRouter = new CallbackQueryRouter(telegram, botService, stateManager);

    // 4. Route based on update type
    if (update.callback_query) {
      // Handle button clicks first (higher priority)
      await callbackRouter.route(update);
    } else if (update.message?.text) {
      // Handle text messages
      await commandRouter.route(update.message);
    } else {
      // Ignore non-text messages and unhandled update types
      return new Response('OK', { status: 200 });
    }

    console.log(JSON.stringify({
      event: 'webhook_processed',
      updateType: update.message ? 'message' : 'callback_query',
    }));

    return new Response('OK', { status: 200 });
  } catch (error) {
    console.error('Webhook error:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}
