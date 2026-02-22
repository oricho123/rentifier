import type { CommandHandler } from './interface';
import type { TelegramMessage } from '../webhook/types';
import type { TelegramClient } from '../telegram-client';
import type { BotService } from '../bot-service';
import { t } from '../i18n';

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
        t('errors.user_not_found'),
        'HTML'
      );
      return;
    }

    await this.botService.resumeAllFilters(user.id);

    await this.telegram.sendMessage(
      chatId,
      t('commands.resume.success'),
      'HTML'
    );
  }
}
