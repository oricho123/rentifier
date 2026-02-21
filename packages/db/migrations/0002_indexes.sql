CREATE INDEX idx_listings_raw_source_item ON listings_raw(source_id, source_item_id);
CREATE INDEX idx_listings_ingested_at ON listings(ingested_at DESC);
CREATE INDEX idx_filters_user_enabled ON filters(user_id, enabled);
CREATE INDEX idx_notifications_user_listing ON notifications_sent(user_id, listing_id);
CREATE INDEX idx_listings_city ON listings(city) WHERE city IS NOT NULL;
CREATE INDEX idx_listings_price ON listings(price) WHERE price IS NOT NULL;
