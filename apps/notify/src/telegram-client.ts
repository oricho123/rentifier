import type { InlineKeyboardMarkup } from './webhook/types';

export interface TelegramSendResult {
  success: boolean;
  messageId?: number;
  error?: string;
  retryable?: boolean;
}

export class TelegramClient {
  private baseUrl: string;

  constructor(botToken: string) {
    this.baseUrl = `https://api.telegram.org/bot${botToken}`;
  }

  async sendMessage(
    chatId: string,
    text: string,
    parseMode: 'HTML' | 'MarkdownV2' = 'HTML'
  ): Promise<TelegramSendResult> {
    try {
      const response = await fetch(`${this.baseUrl}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: parseMode,
          disable_web_page_preview: false,
        }),
      });

      if (!response.ok) {
        const error = (await response.json()) as { description?: string };

        if (response.status === 429) {
          return { success: false, error: 'Rate limit exceeded', retryable: true };
        }

        if (response.status === 400 && error.description?.includes('chat not found')) {
          return { success: false, error: 'Invalid chat_id', retryable: false };
        }

        return {
          success: false,
          error: error.description || 'Unknown Telegram error',
          retryable: true,
        };
      }

      const data = (await response.json()) as { result?: { message_id?: number } };
      return {
        success: true,
        messageId: data.result?.message_id,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network error',
        retryable: true,
      };
    }
  }

  async sendInlineKeyboard(
    chatId: string,
    text: string,
    keyboard: InlineKeyboardMarkup,
    parseMode: 'HTML' | 'MarkdownV2' = 'HTML'
  ): Promise<TelegramSendResult> {
    try {
      const response = await fetch(`${this.baseUrl}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: parseMode,
          reply_markup: keyboard,
          disable_web_page_preview: false,
        }),
      });

      if (!response.ok) {
        const error = (await response.json()) as { description?: string };

        if (response.status === 429) {
          return { success: false, error: 'Rate limit exceeded', retryable: true };
        }

        if (response.status === 400 && error.description?.includes('chat not found')) {
          return { success: false, error: 'Invalid chat_id', retryable: false };
        }

        return {
          success: false,
          error: error.description || 'Unknown Telegram error',
          retryable: true,
        };
      }

      const data = (await response.json()) as { result?: { message_id?: number } };
      return {
        success: true,
        messageId: data.result?.message_id,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network error',
        retryable: true,
      };
    }
  }

  async answerCallbackQuery(
    queryId: string,
    text?: string,
    showAlert?: boolean
  ): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callback_query_id: queryId,
          text,
          show_alert: showAlert,
        }),
      });

      if (!response.ok) {
        const error = (await response.json()) as { description?: string };
        console.error('Failed to answer callback query:', error.description);
      }
    } catch (error) {
      console.error(
        'Error answering callback query:',
        error instanceof Error ? error.message : 'Network error'
      );
    }
  }

  async editMessageText(
    chatId: string,
    messageId: number,
    text: string,
    parseMode: 'HTML' | 'MarkdownV2' = 'HTML',
    replyMarkup?: InlineKeyboardMarkup
  ): Promise<TelegramSendResult> {
    try {
      const response = await fetch(`${this.baseUrl}/editMessageText`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          text,
          parse_mode: parseMode,
          reply_markup: replyMarkup,
        }),
      });

      if (!response.ok) {
        const error = (await response.json()) as { description?: string };

        if (response.status === 429) {
          return { success: false, error: 'Rate limit exceeded', retryable: true };
        }

        if (response.status === 400 && error.description?.includes('chat not found')) {
          return { success: false, error: 'Invalid chat_id', retryable: false };
        }

        return {
          success: false,
          error: error.description || 'Unknown Telegram error',
          retryable: true,
        };
      }

      const data = (await response.json()) as { result?: { message_id?: number } };
      return {
        success: true,
        messageId: data.result?.message_id,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network error',
        retryable: true,
      };
    }
  }

  async editMessageReplyMarkup(
    chatId: string,
    messageId: number,
    replyMarkup: InlineKeyboardMarkup
  ): Promise<TelegramSendResult> {
    try {
      const response = await fetch(`${this.baseUrl}/editMessageReplyMarkup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          reply_markup: replyMarkup,
        }),
      });

      if (!response.ok) {
        const error = (await response.json()) as { description?: string };

        if (response.status === 429) {
          return { success: false, error: 'Rate limit exceeded', retryable: true };
        }

        if (response.status === 400 && error.description?.includes('chat not found')) {
          return { success: false, error: 'Invalid chat_id', retryable: false };
        }

        return {
          success: false,
          error: error.description || 'Unknown Telegram error',
          retryable: true,
        };
      }

      const data = (await response.json()) as { result?: { message_id?: number } };
      return {
        success: true,
        messageId: data.result?.message_id,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network error',
        retryable: true,
      };
    }
  }
}
