import type { CommandHandler } from './interface';
import type { TelegramMessage } from '../webhook/types';
import type { TelegramClient } from '../telegram-client';

export class HelpCommand implements CommandHandler {
  constructor(private telegram: TelegramClient) {}

  async execute(message: TelegramMessage): Promise<void> {
    const chatId = String(message.chat.id);

    const helpText = `
<b>Rentifier Bot Commands</b>

<b>/start</b> - Register or view your account
<b>/filter</b> - Create a new search filter
<b>/list</b> - View your active filters
<b>/edit &lt;id&gt;</b> - Edit an existing filter
<b>/delete &lt;id&gt;</b> - Delete a filter
<b>/pause</b> - Pause all notifications
<b>/resume</b> - Resume all notifications
<b>/help</b> - Show this help message

Use /filter to create your first search filter and start receiving rental listings!
    `.trim();

    await this.telegram.sendMessage(chatId, helpText, 'HTML');
  }
}
