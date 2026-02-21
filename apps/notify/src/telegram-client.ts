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
}
