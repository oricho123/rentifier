import { describe, it, expect } from 'vitest';
import { extractPrice, extractBedrooms, extractTags, extractLocation, extractStreet, isSearchPost, extractAll } from '../extractors';

describe('extractPrice', () => {
  it('should extract ILS amounts with ש״ח', () => {
    const result = extractPrice('4500 ש״ח');
    expect(result).toEqual({
      amount: 4500,
      currency: 'ILS',
      period: 'month',
      confidence: 0.7,
    });
  });

  it('should extract ILS amounts with ₪ symbol', () => {
    const result = extractPrice('₪ 3200');
    expect(result).toEqual({
      amount: 3200,
      currency: 'ILS',
      period: 'month',
      confidence: 0.7,
    });
  });

  it('should extract USD amounts', () => {
    const result = extractPrice('$1200');
    expect(result).toEqual({
      amount: 1200,
      currency: 'USD',
      period: 'month',
      confidence: 0.7,
    });
  });

  it('should extract price with explicit period', () => {
    const result = extractPrice('5000 ₪ לחודש');
    expect(result).toEqual({
      amount: 5000,
      currency: 'ILS',
      period: 'month',
      confidence: 0.9,
    });
  });

  it('should extract price with weekly period', () => {
    const result = extractPrice('1500 ₪ לשבוע');
    expect(result).toEqual({
      amount: 1500,
      currency: 'ILS',
      period: 'week',
      confidence: 0.9,
    });
  });

  it('should extract price with מחיר prefix (no currency symbol)', () => {
    const result = extractPrice('מחיר - 8,650');
    expect(result).toEqual({
      amount: 8650,
      currency: 'ILS',
      period: 'month',
      confidence: 0.7,
    });
  });

  it('should extract price with מחיר and colon', () => {
    const result = extractPrice('מחיר: 5000');
    expect(result).toEqual({
      amount: 5000,
      currency: 'ILS',
      period: 'month',
      confidence: 0.7,
    });
  });

  it('should return null for no price match', () => {
    const result = extractPrice('דירה יפה');
    expect(result).toBeNull();
  });

  // Facebook Hebrew patterns
  it('should extract price with ב prefix (ב7,600)', () => {
    const result = extractPrice('ב7,600!!דירה ענקית');
    expect(result?.amount).toBe(7600);
    expect(result?.currency).toBe('ILS');
  });

  it('should extract price with ב- prefix (ב-4,500)', () => {
    const result = extractPrice('להשכרה ב-4,500 לחודש');
    expect(result?.amount).toBe(4500);
    expect(result?.currency).toBe('ILS');
  });

  it("should extract price with שכ'ד prefix", () => {
    const result = extractPrice("שכ'ד: 6300 ש'ח");
    expect(result?.amount).toBe(6300);
    expect(result?.currency).toBe('ILS');
  });

  it("should extract price with ש'ח currency", () => {
    const result = extractPrice("6300 ש'ח");
    expect(result?.amount).toBe(6300);
    expect(result?.currency).toBe('ILS');
  });

  it('should extract price with שכ״ד prefix', () => {
    const result = extractPrice('שכ״ד 8,500');
    expect(result?.amount).toBe(8500);
    expect(result?.currency).toBe('ILS');
  });

  it('should not match ב prefix with non-rental numbers', () => {
    // Single numbers like "ב3" (at 3) shouldn't match — need comma-separated thousands
    const result = extractPrice('קומה ב3 בניין');
    expect(result).toBeNull();
  });
});

describe('extractBedrooms', () => {
  it('should extract number of rooms in Hebrew', () => {
    expect(extractBedrooms('3 חדרים')).toBe(3);
    expect(extractBedrooms('2.5 חדר')).toBe(2.5);
  });

  it('should extract number of rooms in English', () => {
    expect(extractBedrooms('4 rooms')).toBe(4);
    expect(extractBedrooms('2 bedrooms')).toBe(2);
  });

  it('should return 0 for studio', () => {
    expect(extractBedrooms('סטודיו')).toBe(0);
    expect(extractBedrooms('studio')).toBe(0);
  });

  it('should extract rooms with ח׳ abbreviation', () => {
    expect(extractBedrooms('3 ח׳')).toBe(3);
    expect(extractBedrooms("4 ח'")).toBe(4);
  });

  // Facebook Hebrew abbreviations
  it('should extract rooms with חד abbreviation (no space)', () => {
    expect(extractBedrooms('2חד')).toBe(2);
  });

  it("should extract rooms with חד׳ abbreviation", () => {
    expect(extractBedrooms('4 חד׳ עם מרפסת')).toBe(4);
  });

  it('should extract rooms from דירת prefix', () => {
    expect(extractBedrooms('דירת 3 חדרים ענקית')).toBe(3);
  });

  it('should extract rooms with half rooms and חד', () => {
    expect(extractBedrooms('3.5 חד')).toBe(3.5);
  });

  it('should extract rooms from concatenated text (2חדקודן)', () => {
    // "2חד" followed by other text without space
    expect(extractBedrooms('2חדקודן בכניסה')).toBe(2);
  });

  it('should return null for no match', () => {
    expect(extractBedrooms('דירה יפה')).toBeNull();
  });
});

describe('extractTags', () => {
  it('should extract parking tag', () => {
    const tags = extractTags('דירה עם חניה');
    expect(tags).toContain('parking');
  });

  it('should extract balcony tag', () => {
    const tags = extractTags('יש מרפסת');
    expect(tags).toContain('balcony');
  });

  it('should extract multiple tags', () => {
    const tags = extractTags('חניה ומרפסת');
    expect(tags).toContain('parking');
    expect(tags).toContain('balcony');
  });

  it('should extract pets tag', () => {
    const tags = extractTags('חיות מותר');
    expect(tags).toContain('pets');
  });

  it('should extract furnished tag', () => {
    const tags = extractTags('מרוהטת');
    expect(tags).toContain('furnished');
  });

  it('should extract immediate tag', () => {
    const tags = extractTags('כניסה מיידית');
    expect(tags).toContain('immediate');
  });

  it('should extract air-conditioning tag', () => {
    const tags = extractTags('עם מזגן');
    expect(tags).toContain('air-conditioning');
  });

  it('should return empty array for no tags', () => {
    const tags = extractTags('דירה');
    expect(tags).toEqual([]);
  });
});

describe('extractLocation', () => {
  it('should match Tel Aviv in Hebrew', () => {
    const result = extractLocation('דירה בתל אביב');
    expect(result).toEqual({
      city: 'תל אביב',
      neighborhood: null,
      confidence: 0.8,
    });
  });

  it('should match Tel Aviv in English and normalize to Hebrew', () => {
    const result = extractLocation('apartment in tel aviv');
    expect(result).toEqual({
      city: 'תל אביב',
      neighborhood: null,
      confidence: 0.8,
    });
  });

  it('should match city and neighborhood', () => {
    const result = extractLocation('דירה בתל אביב בפלורנטין');
    expect(result).toEqual({
      city: 'תל אביב',
      neighborhood: 'פלורנטין',
      confidence: 0.9,
    });
  });

  it('should match Jerusalem', () => {
    const result = extractLocation('ירושלים');
    expect(result).toEqual({
      city: 'ירושלים',
      neighborhood: null,
      confidence: 0.8,
    });
  });

  it('should match Haifa', () => {
    const result = extractLocation('חיפה');
    expect(result).toEqual({
      city: 'חיפה',
      neighborhood: null,
      confidence: 0.8,
    });
  });

  it('should infer city from neighborhood (reverse lookup)', () => {
    const result = extractLocation('דירה ליד כרם התימנים');
    expect(result).toEqual({
      city: 'תל אביב',
      neighborhood: 'כרם התימנים',
      confidence: 0.85,
    });
  });

  it('should infer city from Dizengoff neighborhood', () => {
    const result = extractLocation('ליד כיכר דיזנגוף');
    expect(result).toEqual({
      city: 'תל אביב',
      neighborhood: 'דיזנגוף',
      confidence: 0.85,
    });
  });

  it('should handle דיזינגוף spelling variant', () => {
    const result = extractLocation('5 דקות מכיכר דיזינגוף');
    expect(result).toEqual({
      city: 'תל אביב',
      neighborhood: 'דיזנגוף',
      confidence: 0.85,
    });
  });

  it('should infer city from קריית שלום', () => {
    const result = extractLocation('באזור קריית שלום');
    expect(result).toEqual({
      city: 'תל אביב',
      neighborhood: 'קריית שלום',
      confidence: 0.85,
    });
  });

  it('should return null for no match', () => {
    const result = extractLocation('דירה יפה');
    expect(result).toBeNull();
  });
});

describe('extractStreet', () => {
  it('should extract street from ברחוב prefix', () => {
    expect(extractStreet('ברחוב יעל')).toBe('יעל');
    expect(extractStreet('ברחוב הכובשים')).toBe('הכובשים');
  });

  it('should extract street from רחוב prefix', () => {
    expect(extractStreet('רחוב דיזנגוף')).toBe('דיזנגוף');
  });

  it('should return null for no street', () => {
    expect(extractStreet('דירה יפה')).toBeNull();
  });
});

describe('isSearchPost', () => {
  it('should detect Hebrew search posts', () => {
    expect(isSearchPost('מחפש דירת 2-3 חדרים להשכרה')).toBe(true);
    expect(isSearchPost('מחפשת דירה בתל אביב')).toBe(true);
    expect(isSearchPost('מחפש סטודיו')).toBe(true);
    expect(isSearchPost('מחפש סאבלט')).toBe(true);
    expect(isSearchPost('מחפשת שותפה')).toBe(true);
  });

  it('should not flag rental listings', () => {
    expect(isSearchPost('להשכרה דירת 3 חדרים')).toBe(false);
    expect(isSearchPost('דירה להשכרה בפלורנטין')).toBe(false);
    expect(isSearchPost('סאבלט 5 דק מהים')).toBe(false);
  });

  it('should not flag listings with search CTA at the end', () => {
    const listingWithCta = 'להשכרה דירת 4 חדרים מרווחת ברחוב בורוכוב | על גן מאיר\nבקומה 2 ללא מעלית, דירה גדולה עם תקרות גבוהות\n11,000 ₪\nמחפשים דירה אחרת בתל אביב?';
    expect(isSearchPost(listingWithCta)).toBe(false);
  });

  it('should detect search posts with greeting on first line', () => {
    const searchPost = 'הי,\nמחפש דירת 2-3 חדרים להשכרה בתל אביב';
    expect(isSearchPost(searchPost)).toBe(true);
  });
});

describe('extractAll', () => {
  it('should extract all fields from combined text', () => {
    const title = '3 חדרים בתל אביב בפלורנטין';
    const description = '5000 ₪ לחודש, חניה ומרפסת';

    const result = extractAll(title, description);

    expect(result.price).toEqual({
      amount: 5000,
      currency: 'ILS',
      period: 'month',
      confidence: 0.9,
    });
    expect(result.bedrooms).toBe(3);
    expect(result.tags).toContain('parking');
    expect(result.tags).toContain('balcony');
    expect(result.location).toEqual({
      city: 'תל אביב',
      neighborhood: 'פלורנטין',
      confidence: 0.9,
    });
    expect(result.overallConfidence).toBe(0.9);
  });

  it('should handle partial extraction', () => {
    const title = 'דירה יפה';
    const description = '3 חדרים';

    const result = extractAll(title, description);

    expect(result.price).toBeNull();
    expect(result.bedrooms).toBe(3);
    expect(result.tags).toEqual([]);
    expect(result.location).toBeNull();
    expect(result.overallConfidence).toBe(0);
  });

  it('should calculate minimum confidence', () => {
    const title = '2 חדרים בירושלים';
    const description = '4000 ש״ח'; // No explicit period, confidence 0.7

    const result = extractAll(title, description);

    expect(result.overallConfidence).toBe(0.7);
  });

  // Real-world Facebook posts
  it('should extract from Facebook post with ב prefix price', () => {
    const title = 'ל-2 שותפים או משפחה !!  דירת 3 חדרים ענקית שמורה ומוארת !!';
    const description = 'ל-2 שותפים או משפחה !!  דירת 3 חדרים ענקית שמורה ומוארת !!  + 2 מרפסות סגורות מרווחות !! בקרבת כיכר רבין פרישמן וצייטלין !!  ב7,600!!';
    const result = extractAll(title, description);

    expect(result.price?.amount).toBe(7600);
    expect(result.bedrooms).toBe(3);
    expect(result.tags).toContain('balcony');
  });

  it("should extract from Facebook post with שכ'ד price", () => {
    const title = '*** להשכרה, 2חד - מרכז העיר ***';
    const description = "*** להשכרה, 2חד - מרכז העיר ***אזור - מרכז / לב העיררחוב קרית ספר2חדקודן בכניסהקרקע65 מ'רשכ'ד: 6300 ש'ח";
    const result = extractAll(title, description);

    expect(result.price?.amount).toBe(6300);
    expect(result.bedrooms).toBe(2);
  });

  it('should extract from Facebook post with מחיר and ₪', () => {
    const title = 'להשכרה בפריים לוקיישון בלב ת"א ברחוב דיזינגוף';
    const description = 'להשכרה בפריים לוקיישון בלב ת"א ברחוב דיזינגוף ליד הסנטר דירת סטודיו כ-25 מטר עם גלרית שינה משופצת מחיר 3000 ₪';
    const result = extractAll(title, description);

    expect(result.price?.amount).toBe(3000);
    expect(result.bedrooms).toBe(0); // סטודיו
    expect(result.tags).toContain('renovated');
  });
});
