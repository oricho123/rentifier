-- Migration 0016: Create neighborhood_cache table for geocoder write-through cache.
-- Keyed by a deterministic string so the same coord/street is never resolved twice.
CREATE TABLE neighborhood_cache (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  cache_key      TEXT    NOT NULL UNIQUE,
  cache_type     TEXT    NOT NULL CHECK(cache_type IN ('coords', 'street')),
  raw_name       TEXT,
  canonical_name TEXT,
  provider       TEXT    NOT NULL,
  resolved_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_neighborhood_cache_key ON neighborhood_cache(cache_key);
