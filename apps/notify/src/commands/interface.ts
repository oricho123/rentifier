import type { TelegramMessage } from '../webhook/types';
import type { ConversationState } from '../conversation-state';

/**
 * Base interface for command handlers
 */
export interface CommandHandler {
  execute(message: TelegramMessage, args: string[]): Promise<void>;
}

/**
 * Interface for multi-step command handlers that maintain conversation state
 */
export interface StatefulCommandHandler extends CommandHandler {
  handleStateReply(message: TelegramMessage, state: ConversationState): Promise<void>;
}
