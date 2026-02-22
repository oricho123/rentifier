import type { CommandHandler } from './interface';
import type { TelegramMessage } from '../webhook/types';
import type { TelegramClient } from '../telegram-client';
import type { BotService } from '../bot-service';

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

      await this.telegram.sendMessage(
        chatId,
        `Welcome to Rentifier, ${displayName}! 🏠\n\n` +
          `I'll help you find rental apartments in Israel.\n\n` +
          `<b>Available commands:</b>\n` +
          `/filter - Create a new search filter\n` +
          `/list - View your active filters\n` +
          `/pause - Pause notifications\n` +
          `/resume - Resume notifications\n` +
          `/help - Show all commands`,
        'HTML'
      );
    } else {
      // Existing user
      const filterCount = await this.botService.getFilterCount(user.id);

      await this.telegram.sendMessage(
        chatId,
        `Welcome back, ${displayName}!\n\n` +
          `You have ${filterCount} active filter${filterCount === 1 ? '' : 's'}.\n\n` +
          `Send /help to see available commands.`,
        'HTML'
      );
    }
  }
}
