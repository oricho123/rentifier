import type { TelegramMessage } from '../webhook/types';
import type { TelegramClient } from '../telegram-client';
import type { BotService } from '../bot-service';
import type { ConversationStateManager } from '../conversation-state';
import type { CommandHandler, StatefulCommandHandler } from './interface';

import { StartCommand } from './start';
import { HelpCommand } from './help';
import { ListCommand } from './list';
import { PauseCommand } from './pause';
import { ResumeCommand } from './resume';
import { DeleteCommand } from './delete';
import { FilterCommand } from './filter';

export class CommandRouter {
  private handlers: Map<string, CommandHandler>;

  constructor(
    private telegram: TelegramClient,
    private botService: BotService,
    private stateManager: ConversationStateManager
  ) {
    this.handlers = new Map<string, CommandHandler>([
      ['/start', new StartCommand(telegram, botService)],
      ['/help', new HelpCommand(telegram)],
      ['/list', new ListCommand(telegram, botService)],
      ['/pause', new PauseCommand(telegram, botService)],
      ['/resume', new ResumeCommand(telegram, botService)],
      ['/delete', new DeleteCommand(telegram, botService)],
      ['/filter', new FilterCommand(telegram, botService, stateManager)],
    ]);
  }

  async route(message: TelegramMessage): Promise<void> {
    const chatId = String(message.chat.id);
    const text = message.text?.trim() || '';

    // Check if user is in a conversation state
    const state = await this.stateManager.getState(chatId);
    if (state) {
      // User is in the middle of a multi-step flow
      const handler = this.handlers.get(state.command);
      if (handler && 'handleStateReply' in handler) {
        await (handler as StatefulCommandHandler).handleStateReply(message, state);
        return;
      }
    }

    // Parse command (e.g., "/filter" or "/delete 3")
    const [command, ...args] = text.split(/\s+/);
    const handler = this.handlers.get(command);

    if (handler) {
      await handler.execute(message, args);
    } else {
      // Unknown command
      await this.telegram.sendMessage(
        chatId,
        `Unknown command: ${command}\n\nSend /help to see available commands.`,
        'HTML'
      );
    }
  }
}
