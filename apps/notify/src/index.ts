import { createDB } from '@rentifier/db';
import { TelegramClient } from './telegram-client';
import { MessageFormatter } from './message-formatter';
import { NotificationService } from './notification-service';
import { handleWebhook } from './webhook/handler';

export interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
}

export default {
  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<void> {
    console.log('Notify worker triggered at', new Date().toISOString());

    try {
      const db = createDB(env.DB);
      const telegram = new TelegramClient(env.TELEGRAM_BOT_TOKEN);
      const formatter = new MessageFormatter();
      const service = new NotificationService(db, telegram, formatter);

      const result = await service.processNotifications();
      console.log('Notify completed:', JSON.stringify(result));
    } catch (error) {
      console.error('Notify failed:', error);
    }
  },

  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/webhook' && request.method === 'POST') {
      return handleWebhook(request, env);
    }

    return new Response('Not Found', { status: 404 });
  },
};
