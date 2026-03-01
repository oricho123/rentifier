import { describe, it, expect } from 'vitest';
import { matchesFilter } from '../notification-service';
import type { ListingRow, FilterRow } from '@rentifier/db';

const createListing = (overrides: Partial<ListingRow> = {}): ListingRow => ({
  id: 1,
  source_id: 1,
  source_item_id: 'test-123',
  title: 'דירה יפה בתל אביב',
  description: 'דירה מרווחת עם מרפסת',
  price: 5000,
  currency: 'ILS',
  price_period: 'month',
  bedrooms: 3,
  city: 'תל אביב',
  neighborhood: 'פלורנטין',
  area_text: null,
  street: 'אלנבי',
  house_number: '10',
  url: 'https://yad2.co.il/item/abc',
  posted_at: null,
  ingested_at: '2026-03-01T10:00:00Z',
  tags_json: null,
  relevance_score: null,
  floor: 2,
  square_meters: 80,
  property_type: 'apartment',
  latitude: null,
  longitude: null,
  image_url: null,
  ...overrides,
});

const createFilter = (overrides: Partial<FilterRow> = {}): FilterRow => ({
  id: 1,
  user_id: 1,
  name: 'Test Filter',
  min_price: null,
  max_price: null,
  min_bedrooms: null,
  max_bedrooms: null,
  cities_json: null,
  neighborhoods_json: null,
  keywords_json: null,
  must_have_tags_json: null,
  exclude_tags_json: null,
  enabled: true,
  created_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('matchesFilter', () => {
  it('should match any listing when filter has no criteria', () => {
    expect(matchesFilter(createListing(), createFilter())).toBe(true);
  });

  // --- Price range ---

  describe('price range', () => {
    it('should pass when listing price is within range', () => {
      const filter = createFilter({ min_price: 3000, max_price: 7000 });
      expect(matchesFilter(createListing({ price: 5000 }), filter)).toBe(true);
    });

    it('should pass when price equals min_price exactly', () => {
      const filter = createFilter({ min_price: 5000 });
      expect(matchesFilter(createListing({ price: 5000 }), filter)).toBe(true);
    });

    it('should pass when price equals max_price exactly', () => {
      const filter = createFilter({ max_price: 5000 });
      expect(matchesFilter(createListing({ price: 5000 }), filter)).toBe(true);
    });

    it('should fail when listing price is below min_price', () => {
      const filter = createFilter({ min_price: 6000 });
      expect(matchesFilter(createListing({ price: 5000 }), filter)).toBe(false);
    });

    it('should fail when listing price is above max_price', () => {
      const filter = createFilter({ max_price: 4000 });
      expect(matchesFilter(createListing({ price: 5000 }), filter)).toBe(false);
    });

    it('should fail when listing has null price and filter has min_price', () => {
      const filter = createFilter({ min_price: 3000 });
      expect(matchesFilter(createListing({ price: null }), filter)).toBe(false);
    });

    it('should fail when listing has null price and filter has max_price', () => {
      const filter = createFilter({ max_price: 7000 });
      expect(matchesFilter(createListing({ price: null }), filter)).toBe(false);
    });

    it('should pass with only min_price set (no max)', () => {
      const filter = createFilter({ min_price: 3000 });
      expect(matchesFilter(createListing({ price: 5000 }), filter)).toBe(true);
    });

    it('should pass with only max_price set (no min)', () => {
      const filter = createFilter({ max_price: 7000 });
      expect(matchesFilter(createListing({ price: 5000 }), filter)).toBe(true);
    });
  });

  // --- Bedrooms ---

  describe('bedrooms', () => {
    it('should pass when bedrooms within range', () => {
      const filter = createFilter({ min_bedrooms: 2, max_bedrooms: 4 });
      expect(matchesFilter(createListing({ bedrooms: 3 }), filter)).toBe(true);
    });

    it('should fail when bedrooms below min', () => {
      const filter = createFilter({ min_bedrooms: 4 });
      expect(matchesFilter(createListing({ bedrooms: 3 }), filter)).toBe(false);
    });

    it('should fail when bedrooms above max', () => {
      const filter = createFilter({ max_bedrooms: 2 });
      expect(matchesFilter(createListing({ bedrooms: 3 }), filter)).toBe(false);
    });

    it('should fail when listing has null bedrooms and filter has bounds', () => {
      const filter = createFilter({ min_bedrooms: 2 });
      expect(matchesFilter(createListing({ bedrooms: null }), filter)).toBe(false);
    });
  });

  // --- Cities ---

  describe('cities', () => {
    it('should pass when listing city is in filter list', () => {
      const filter = createFilter({ cities_json: JSON.stringify(['תל אביב', 'חיפה']) });
      expect(matchesFilter(createListing({ city: 'תל אביב' }), filter)).toBe(true);
    });

    it('should fail when listing city is not in filter list', () => {
      const filter = createFilter({ cities_json: JSON.stringify(['חיפה', 'ירושלים']) });
      expect(matchesFilter(createListing({ city: 'תל אביב' }), filter)).toBe(false);
    });

    it('should fail when listing has null city and filter has cities', () => {
      const filter = createFilter({ cities_json: JSON.stringify(['תל אביב']) });
      expect(matchesFilter(createListing({ city: null }), filter)).toBe(false);
    });

    it('should pass any city when cities_json is null', () => {
      const filter = createFilter({ cities_json: null });
      expect(matchesFilter(createListing({ city: 'תל אביב' }), filter)).toBe(true);
    });

    it('should pass any city when cities_json is empty array', () => {
      const filter = createFilter({ cities_json: JSON.stringify([]) });
      expect(matchesFilter(createListing({ city: 'תל אביב' }), filter)).toBe(true);
    });
  });

  // --- Neighborhoods ---

  describe('neighborhoods', () => {
    it('should pass when listing neighborhood is in filter list', () => {
      const filter = createFilter({ neighborhoods_json: JSON.stringify(['פלורנטין', 'נווה צדק']) });
      expect(matchesFilter(createListing({ neighborhood: 'פלורנטין' }), filter)).toBe(true);
    });

    it('should fail when listing neighborhood is not in filter list', () => {
      const filter = createFilter({ neighborhoods_json: JSON.stringify(['נווה צדק']) });
      expect(matchesFilter(createListing({ neighborhood: 'פלורנטין' }), filter)).toBe(false);
    });

    it('should fail when listing has null neighborhood and filter has neighborhoods', () => {
      const filter = createFilter({ neighborhoods_json: JSON.stringify(['פלורנטין']) });
      expect(matchesFilter(createListing({ neighborhood: null }), filter)).toBe(false);
    });

    it('should pass any neighborhood when neighborhoods_json is null', () => {
      const filter = createFilter({ neighborhoods_json: null });
      expect(matchesFilter(createListing({ neighborhood: 'פלורנטין' }), filter)).toBe(true);
    });
  });

  // --- Keywords (OR logic) ---

  describe('keywords', () => {
    it('should pass when keyword found in title', () => {
      const filter = createFilter({ keywords_json: JSON.stringify(['יפה']) });
      expect(matchesFilter(createListing({ title: 'דירה יפה בתל אביב' }), filter)).toBe(true);
    });

    it('should pass when keyword found in description', () => {
      const filter = createFilter({ keywords_json: JSON.stringify(['מרפסת']) });
      expect(matchesFilter(createListing({ description: 'דירה עם מרפסת' }), filter)).toBe(true);
    });

    it('should be case-insensitive', () => {
      const filter = createFilter({ keywords_json: JSON.stringify(['BALCONY']) });
      expect(matchesFilter(createListing({ title: 'apartment with balcony' }), filter)).toBe(true);
    });

    it('should pass when any keyword matches (OR logic)', () => {
      const filter = createFilter({ keywords_json: JSON.stringify(['גינה', 'מרפסת']) });
      expect(matchesFilter(createListing({ description: 'דירה עם מרפסת' }), filter)).toBe(true);
    });

    it('should fail when no keyword matches', () => {
      const filter = createFilter({ keywords_json: JSON.stringify(['גינה', 'חניה']) });
      expect(matchesFilter(createListing({ title: 'דירה', description: 'בלי כלום' }), filter)).toBe(false);
    });

    it('should handle null description gracefully', () => {
      const filter = createFilter({ keywords_json: JSON.stringify(['דירה']) });
      expect(matchesFilter(createListing({ title: 'דירה יפה', description: null }), filter)).toBe(true);
    });
  });

  // --- Must-have tags (AND logic) ---

  describe('must-have tags', () => {
    it('should pass when all required tags are present', () => {
      const filter = createFilter({ must_have_tags_json: JSON.stringify(['parking', 'elevator']) });
      const listing = createListing({ tags_json: JSON.stringify(['parking', 'elevator', 'balcony']) });
      expect(matchesFilter(listing, filter)).toBe(true);
    });

    it('should fail when any required tag is missing', () => {
      const filter = createFilter({ must_have_tags_json: JSON.stringify(['parking', 'elevator']) });
      const listing = createListing({ tags_json: JSON.stringify(['parking', 'balcony']) });
      expect(matchesFilter(listing, filter)).toBe(false);
    });

    it('should fail when listing has no tags and filter requires tags', () => {
      const filter = createFilter({ must_have_tags_json: JSON.stringify(['parking']) });
      const listing = createListing({ tags_json: null });
      expect(matchesFilter(listing, filter)).toBe(false);
    });
  });

  // --- Exclude tags (NOT logic) ---

  describe('exclude tags', () => {
    it('should pass when no excluded tags are present', () => {
      const filter = createFilter({ exclude_tags_json: JSON.stringify(['ground_floor']) });
      const listing = createListing({ tags_json: JSON.stringify(['parking', 'elevator']) });
      expect(matchesFilter(listing, filter)).toBe(true);
    });

    it('should fail when any excluded tag is present', () => {
      const filter = createFilter({ exclude_tags_json: JSON.stringify(['ground_floor']) });
      const listing = createListing({ tags_json: JSON.stringify(['parking', 'ground_floor']) });
      expect(matchesFilter(listing, filter)).toBe(false);
    });

    it('should pass when listing has no tags (nothing to exclude)', () => {
      const filter = createFilter({ exclude_tags_json: JSON.stringify(['ground_floor']) });
      const listing = createListing({ tags_json: null });
      expect(matchesFilter(listing, filter)).toBe(true);
    });
  });

  // --- Combined filters ---

  describe('combined filters', () => {
    it('should pass when all criteria match', () => {
      const filter = createFilter({
        min_price: 4000,
        max_price: 6000,
        min_bedrooms: 2,
        max_bedrooms: 4,
        cities_json: JSON.stringify(['תל אביב']),
        keywords_json: JSON.stringify(['מרפסת']),
      });
      const listing = createListing({
        price: 5000,
        bedrooms: 3,
        city: 'תל אביב',
        description: 'דירה עם מרפסת',
      });
      expect(matchesFilter(listing, filter)).toBe(true);
    });

    it('should fail when one criterion fails among many', () => {
      const filter = createFilter({
        min_price: 4000,
        max_price: 6000,
        cities_json: JSON.stringify(['חיפה']), // wrong city
      });
      const listing = createListing({
        price: 5000,
        city: 'תל אביב',
      });
      expect(matchesFilter(listing, filter)).toBe(false);
    });
  });
});
