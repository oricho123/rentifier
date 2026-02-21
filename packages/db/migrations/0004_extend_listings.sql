-- Add additional Yad2 fields to listings table
ALTER TABLE listings ADD COLUMN floor INTEGER;
ALTER TABLE listings ADD COLUMN square_meters REAL;
ALTER TABLE listings ADD COLUMN property_type TEXT;
ALTER TABLE listings ADD COLUMN latitude REAL;
ALTER TABLE listings ADD COLUMN longitude REAL;
ALTER TABLE listings ADD COLUMN image_url TEXT;
