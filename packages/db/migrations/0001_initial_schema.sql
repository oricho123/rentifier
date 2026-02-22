-- sources: configuration for each data source connector
CREATE TABLE sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- source_state: cursor tracking and status for each source
CREATE TABLE source_state (
  source_id INTEGER PRIMARY KEY,
  cursor TEXT,
  last_run_at TEXT,
  last_status TEXT CHECK(last_status IN ('ok', 'error')),
  last_error TEXT,
  FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
);

-- listings_raw: original unprocessed payloads from sources
CREATE TABLE listings_raw (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL,
  source_item_id TEXT NOT NULL,
  url TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(source_id, source_item_id) ON CONFLICT IGNORE,
  FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
);

-- listings: canonical normalized listing data
CREATE TABLE listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL,
  source_item_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  price REAL,
  currency TEXT,
  price_period TEXT,
  bedrooms INTEGER,
  city TEXT,
  neighborhood TEXT,
  area_text TEXT,
  url TEXT NOT NULL,
  posted_at TEXT,
  ingested_at TEXT NOT NULL DEFAULT (datetime('now')),
  tags_json TEXT,
  relevance_score REAL,
  UNIQUE(source_id, source_item_id),
  FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
);

-- users: Telegram user accounts
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_chat_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- filters: user-defined listing match criteria
CREATE TABLE filters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  min_price REAL,
  max_price REAL,
  min_bedrooms INTEGER,
  max_bedrooms INTEGER,
  cities_json TEXT,
  neighborhoods_json TEXT,
  keywords_json TEXT,
  must_have_tags_json TEXT,
  exclude_tags_json TEXT,
  enabled BOOLEAN NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- notifications_sent: deduplication tracking for sent notifications
CREATE TABLE notifications_sent (
  user_id INTEGER NOT NULL,
  listing_id INTEGER NOT NULL,
  filter_id INTEGER,
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  channel TEXT NOT NULL DEFAULT 'telegram',
  PRIMARY KEY (user_id, listing_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE,
  FOREIGN KEY (filter_id) REFERENCES filters(id) ON DELETE SET NULL
);
