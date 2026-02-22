export interface ConversationState {
  chatId: string;
  command: string;
  step: string;
  data: Record<string, any>;
  createdAt: string;
}

export class ConversationStateManager {
  constructor(private d1: D1Database) {}

  async getState(chatId: string): Promise<ConversationState | null> {
    const result = await this.d1
      .prepare(
        'SELECT * FROM conversation_state WHERE chat_id = ? AND expires_at > datetime("now")'
      )
      .bind(chatId)
      .first<{
        chat_id: string;
        command: string;
        step: string;
        data_json: string;
        created_at: string;
        expires_at: string;
      }>();

    if (!result) {
      return null;
    }

    return {
      chatId: result.chat_id,
      command: result.command,
      step: result.step,
      data: JSON.parse(result.data_json),
      createdAt: result.created_at,
    };
  }

  async setState(
    chatId: string,
    state: Partial<Omit<ConversationState, 'chatId' | 'createdAt'>>
  ): Promise<void> {
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min TTL

    await this.d1
      .prepare(
        `INSERT INTO conversation_state (chat_id, command, step, data_json, expires_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(chat_id) DO UPDATE SET
           command = excluded.command,
           step = excluded.step,
           data_json = excluded.data_json,
           expires_at = excluded.expires_at`
      )
      .bind(
        chatId,
        state.command || '',
        state.step || '',
        JSON.stringify(state.data || {}),
        expiresAt
      )
      .run();
  }

  async clearState(chatId: string): Promise<void> {
    await this.d1
      .prepare('DELETE FROM conversation_state WHERE chat_id = ?')
      .bind(chatId)
      .run();
  }
}
