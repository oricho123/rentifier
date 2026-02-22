import type { CommandHandler } from './interface';
import type { TelegramMessage } from '../webhook/types';
import type { TelegramClient } from '../telegram-client';
import type { BotService } from '../bot-service';
import { t } from '../i18n';
import { KeyboardBuilder } from '../keyboards/builders';

export class DeleteCommand implements CommandHandler {
  constructor(
    private telegram: TelegramClient,
    private botService: BotService
  ) {}

  async execute(message: TelegramMessage, args: string[]): Promise<void> {
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

    if (args.length === 0) {
      await this.telegram.sendMessage(
        chatId,
        t('commands.delete.usage'),
        'HTML'
      );
      return;
    }

    const filterId = parseInt(args[0], 10);
    if (isNaN(filterId)) {
      await this.telegram.sendMessage(
        chatId,
        t('errors.invalid_input'),
        'HTML'
      );
      return;
    }

    // Get filter to show its name in confirmation
    const filters = await this.botService.getFilters(user.id);
    const filter = filters.find(f => f.id === filterId);

    if (!filter) {
      await this.telegram.sendMessage(
        chatId,
        t('commands.delete.not_found'),
        'HTML'
      );
      return;
    }

    // Ask for confirmation with inline keyboard
    await this.telegram.sendInlineKeyboard(
      chatId,
      t('commands.filter.delete_confirm', { name: filter.name }),
      KeyboardBuilder.confirm('delete', filterId),
      'HTML'
    );
  }
}
