import type { CommandHandler } from './interface';
import type { TelegramMessage } from '../webhook/types';
import type { TelegramClient } from '../telegram-client';
import type { BotService } from '../bot-service';
import { t } from '../i18n';
import { KeyboardBuilder } from '../keyboards/builders';

export class StartCommand implements CommandHandler {
  constructor(
    private telegram: TelegramClient,
    private botService: BotService
  ) {}

  async execute(message: TelegramMessage): Promise<void> {
    const chatId = String(message.chat.id);
    const displayName = [message.from.first_name, message.from.last_name]
      .filter(Boolean)
      .join(' ');

    // Check if user exists
    let user = await this.botService.getUserByChatId(chatId);

    if (!user) {
      // Create new user
      user = await this.botService.createUser(chatId, displayName);

      const welcomeText = `${t('commands.start.welcome_new', { name: displayName })}\n\n` +
        `${t('commands.start.welcome_new_description')}\n\n` +
        `${t('commands.start.command_list')}`;

      await this.telegram.sendInlineKeyboard(
        chatId,
        welcomeText,
        KeyboardBuilder.quickActions(),
        'HTML'
      );
    } else {
      // Existing user
      const filterCount = await this.botService.getFilterCount(user.id);
      const plural = filterCount === 1 ? '' : 'ים';

      const welcomeBackText = `${t('commands.start.welcome_back', { name: displayName })}\n\n` +
        `${t('commands.start.filter_count', { count: String(filterCount), plural })}`;

      await this.telegram.sendInlineKeyboard(
        chatId,
        welcomeBackText,
        KeyboardBuilder.quickActions(),
        'HTML'
      );
    }
  }
}
