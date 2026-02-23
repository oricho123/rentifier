-- Migration: Normalize existing city names to Hebrew canonical form
-- Date: 2026-02-23
-- Description: Update all English city names to Hebrew for consistency
-- Author: Claude Sonnet 4.5

-- Tel Aviv variants
UPDATE listings
SET city = 'תל אביב'
WHERE city IN ('Tel Aviv', 'tel aviv', 'TLV', 'tel-aviv', 'תל-אביב', 'ת"א');

-- Jerusalem variants
UPDATE listings
SET city = 'ירושלים'
WHERE city IN ('Jerusalem', 'jerusalem', 'ירושלַיִם');

-- Haifa variants
UPDATE listings
SET city = 'חיפה'
WHERE city IN ('Haifa', 'haifa');

-- Herzliya variants
UPDATE listings
SET city = 'הרצליה'
WHERE city IN ('Herzliya', 'herzliya', 'Herzlia', 'herzlia');

-- Ramat Gan variants
UPDATE listings
SET city = 'רמת גן'
WHERE city IN ('Ramat Gan', 'ramat gan', 'ramat-gan', 'Ramat-Gan', 'רמת-גן', 'רמ"ג');

-- Giv'atayim variants
UPDATE listings
SET city = 'גבעתיים'
WHERE city IN ('Givatayim', 'givatayim', 'Giv''atayim', 'giv''atayim');

-- Be'er Sheva variants
UPDATE listings
SET city = 'באר שבע'
WHERE city IN ('Beer Sheva', 'beer sheva', 'Be''er Sheva', 'be''er sheva', 'Beersheba', 'beersheba', 'באר-שבע', 'ב"ש');

-- Netanya variants
UPDATE listings
SET city = 'נתניה'
WHERE city IN ('Netanya', 'netanya');

-- Rishon LeZion variants
UPDATE listings
SET city = 'ראשון לציון'
WHERE city IN ('Rishon LeZion', 'rishon lezion', 'Rishon le Zion', 'rishon le zion', 'ראשון', 'ראשל"צ');

-- Petah Tikva variants
UPDATE listings
SET city = 'פתח תקווה'
WHERE city IN ('Petah Tikva', 'petah tikva', 'Petach Tikva', 'petach tikva', 'Petah-Tikva', 'petah-tikva', 'פתח-תקווה', 'פת"ח');

-- Verification query (uncomment to run after migration to check results)
-- SELECT city, COUNT(*) as count FROM listings GROUP BY city ORDER BY count DESC;
