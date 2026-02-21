import { describe, it, expect } from 'vitest';
import { extractPrice, extractBedrooms, extractTags, extractLocation, extractAll } from '../extractors';

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

  it('should return null for no price match', () => {
    const result = extractPrice('דירה יפה');
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
      city: 'Tel Aviv',
      neighborhood: null,
      confidence: 0.8,
    });
  });

  it('should match Tel Aviv in English', () => {
    const result = extractLocation('apartment in tel aviv');
    expect(result).toEqual({
      city: 'Tel Aviv',
      neighborhood: null,
      confidence: 0.8,
    });
  });

  it('should match city and neighborhood', () => {
    const result = extractLocation('דירה בתל אביב בפלורנטין');
    expect(result).toEqual({
      city: 'Tel Aviv',
      neighborhood: 'Florentin',
      confidence: 0.9,
    });
  });

  it('should match Jerusalem', () => {
    const result = extractLocation('ירושלים');
    expect(result).toEqual({
      city: 'Jerusalem',
      neighborhood: null,
      confidence: 0.8,
    });
  });

  it('should match Haifa', () => {
    const result = extractLocation('חיפה');
    expect(result).toEqual({
      city: 'Haifa',
      neighborhood: null,
      confidence: 0.8,
    });
  });

  it('should return null for no match', () => {
    const result = extractLocation('דירה יפה');
    expect(result).toBeNull();
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
      city: 'Tel Aviv',
      neighborhood: 'Florentin',
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
});
