import { createDB } from '@rentifier/db';
import { TelegramClient } from './telegram-client';
import { MessageFormatter } from './message-formatter';
import { NotificationService } from './notification-service';

export interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
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
};
