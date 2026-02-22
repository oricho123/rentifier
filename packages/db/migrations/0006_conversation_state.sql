-- conversation_state: stores multi-step conversation flow state for Telegram bot
CREATE TABLE conversation_state (
  chat_id TEXT PRIMARY KEY,
  command TEXT NOT NULL,
  step TEXT NOT NULL,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

-- Index for efficient cleanup of expired states
CREATE INDEX idx_conversation_state_expires ON conversation_state(expires_at);
