-- Migration 0010: Monitored Cities
-- Create monitored_cities table for configurable city selection

-- Create monitored_cities table
CREATE TABLE IF NOT EXISTS monitored_cities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  city_name TEXT NOT NULL,
  city_code INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(city_code)
);

-- Create index for enabled cities query (ORDER BY priority DESC, id ASC)
CREATE INDEX IF NOT EXISTS idx_monitored_cities_enabled
  ON monitored_cities(enabled, priority DESC);

-- Seed initial cities (Tel Aviv, Jerusalem, Haifa)
INSERT INTO monitored_cities (city_name, city_code, enabled, priority) VALUES
  ('תל אביב', 5000, 1, 100),
  ('ירושלים', 3000, 1, 90),
  ('חיפה', 4000, 1, 80)
ON CONFLICT(city_code) DO NOTHING;
