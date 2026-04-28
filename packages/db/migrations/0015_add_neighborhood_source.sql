-- Migration 0015: Add neighborhood_source provenance column to listings.
-- Tracks whether the neighborhood was set by regex, AI, or geocoder.
ALTER TABLE listings ADD COLUMN neighborhood_source TEXT;

CREATE INDEX idx_listings_no_neighborhood
  ON listings(ingested_at)
  WHERE neighborhood IS NULL;
