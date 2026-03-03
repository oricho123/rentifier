-- Add AI extraction columns to listings table
ALTER TABLE listings ADD COLUMN entry_date TEXT;
ALTER TABLE listings ADD COLUMN ai_extracted INTEGER DEFAULT 0;
