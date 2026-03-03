-- Add duplicate tracking for cross-source deduplication
ALTER TABLE listings ADD COLUMN duplicate_of INTEGER REFERENCES listings(id);

-- Partial index for fast candidate lookups (only canonical listings)
CREATE INDEX idx_listings_dedup ON listings(city, bedrooms, price) WHERE duplicate_of IS NULL;
