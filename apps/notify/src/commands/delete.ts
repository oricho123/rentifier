import type { CommandHandler } from './interface';
import type { TelegramMessage } from '../webhook/types';
import type { TelegramClient } from '../telegram-client';
import type { BotService } from '../bot-service';

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
        'Please /start first to register.',
        'HTML'
      );
      return;
    }

    if (args.length === 0) {
      await this.telegram.sendMessage(
        chatId,
        '<b>Usage:</b> /delete &lt;filter_id&gt;\n\nUse /list to see your filter IDs.',
        'HTML'
      );
      return;
    }

    const filterId = parseInt(args[0], 10);
    if (isNaN(filterId)) {
      await this.telegram.sendMessage(
        chatId,
        'Invalid filter ID. Please provide a numeric ID.',
        'HTML'
      );
      return;
    }

    const deleted = await this.botService.deleteFilter(user.id, filterId);

    if (deleted) {
      await this.telegram.sendMessage(
        chatId,
        `✅ Filter ${filterId} deleted successfully.`,
        'HTML'
      );
    } else {
      await this.telegram.sendMessage(
        chatId,
        `❌ Filter ${filterId} not found or you don't have permission to delete it.`,
        'HTML'
      );
    }
  }
}
