import type { CommandHandler } from './interface';
import type { TelegramMessage } from '../webhook/types';
import type { TelegramClient } from '../telegram-client';
import type { BotService } from '../bot-service';

export class ResumeCommand implements CommandHandler {
  constructor(
    private telegram: TelegramClient,
    private botService: BotService
  ) {}

  async execute(message: TelegramMessage): Promise<void> {
    const chatId = String(message.chat.id);

    const user = await this.botService.getUserByChatId(chatId);
    if (!user) {
      await this.telegram.sendMessage(
        chatId,
        'Please /start first to register.',
        'HTML'
      );
      return;
    }

    await this.botService.resumeAllFilters(user.id);

    await this.telegram.sendMessage(
      chatId,
      '✅ <b>Notifications resumed</b>\n\nAll your filters are now active. You\'ll receive new listing alerts.',
      'HTML'
    );
  }
}
