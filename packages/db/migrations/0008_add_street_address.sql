-- Add street address columns to listings table
ALTER TABLE listings ADD COLUMN street TEXT;
ALTER TABLE listings ADD COLUMN house_number TEXT;
