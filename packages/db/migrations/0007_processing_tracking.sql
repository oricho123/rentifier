-- Add processing tracking to listings_raw
ALTER TABLE listings_raw ADD COLUMN processed_at TEXT;

-- Backfill: Mark existing raw listings as processed if they exist in listings
UPDATE listings_raw
SET processed_at = datetime('now')
WHERE EXISTS (
  SELECT 1 FROM listings l
  WHERE l.source_id = listings_raw.source_id
    AND l.source_item_id = listings_raw.source_item_id
);

-- Create partial index for efficient unprocessed lookup
CREATE INDEX idx_listings_raw_processed ON listings_raw(processed_at)
WHERE processed_at IS NULL;

-- Worker state tracking for cursor-based processing
CREATE TABLE worker_state (
  worker_name TEXT PRIMARY KEY,
  last_run_at TEXT NOT NULL,
  last_status TEXT CHECK(last_status IN ('ok', 'error')),
  last_error TEXT
);
