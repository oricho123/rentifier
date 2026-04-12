-- Migration 0014: Add region_code to monitored_cities
-- Yad2 API now requires region parameter; city-only queries return 400.
-- Region codes discovered via: pnpm exec tsx scripts/collect-yad2.ts --discover-regions
ALTER TABLE monitored_cities ADD COLUMN region_code INTEGER;

-- Seed region codes for existing monitored cities
UPDATE monitored_cities SET region_code = 3 WHERE city_code = 5000; -- תל אביב → region 3 (תל אביב והסביבה)
UPDATE monitored_cities SET region_code = 6 WHERE city_code = 3000; -- ירושלים → region 6 (ירושלים והסביבה)
UPDATE monitored_cities SET region_code = 5 WHERE city_code = 4000; -- חיפה → region 5 (מישור החוף הצפוני)
