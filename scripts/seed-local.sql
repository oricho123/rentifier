-- Local development seed data
-- Run with: pnpm db:seed:local

-- Seed a dev user (update telegram_chat_id with your real one)
INSERT OR IGNORE INTO users (telegram_chat_id, display_name)
VALUES ('REPLACE_WITH_YOUR_CHAT_ID', 'Dev User');

-- Seed a catch-all filter for the dev user
INSERT OR IGNORE INTO filters (user_id, name, enabled)
VALUES (1, 'All listings', 1);
