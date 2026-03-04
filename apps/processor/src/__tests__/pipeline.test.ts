import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processBatch } from '../pipeline';
import type { DB, ListingRaw, Source } from '@rentifier/db';
import type { AiProvider } from '@rentifier/extraction';

// Long description that triggers AI gate (100+ chars, no extractable price/street/neighborhood)
const FB_LONG_DESC = 'דירה להשכרה, מרפסת גדולה עם נוף, ממוזגת, חניה בבניין, מעלית, מחסן, משופצת לאחרונה, כניסה מיידית לדיירים רציניים בלבד';

describe('processBatch with AI integration', () => {
  let mockDb: Partial<DB>;
  let mockAi: AiProvider;
  let upsertedListings: any[];

  beforeEach(() => {
    upsertedListings = [];

    mockDb = {
      getUnprocessedRawListings: vi.fn(),
      markRawListingProcessed: vi.fn(),
      getSourceById: vi.fn(),
      upsertListing: vi.fn().mockImplementation((listing) => {
        upsertedListings.push(listing);
        return Promise.resolve(1);
      }),
      findDuplicate: vi.fn().mockResolvedValue(null),
      swapCanonical: vi.fn().mockResolvedValue(undefined),
    };

    mockAi = {
      run: vi.fn(),
    };
  });

  it('should NOT call AI for yad2 source listings', async () => {
    const yad2Source: Source = { id: 1, name: 'yad2', enabled: true, created_at: '2026-01-01' };
    const rawListing: ListingRaw = {
      id: 1,
      source_id: 1,
      source_item_id: '123',
      url: 'https://yad2.co.il/item/123',
      raw_json: JSON.stringify({
        source: 'yad2',
        sourceItemId: '123',
        rawTitle: 'דירה בתל אביב',
        rawDescription: 'דירה יפה',
        rawUrl: 'https://yad2.co.il/item/123',
        rawPostedAt: null,
        sourceData: {
          orderId: '123',
          token: 'test-token',
          price: 5000,
          address: {
            city: { text: 'תל אביב' },
            neighborhood: { text: 'פלורנטין' },
            street: { text: 'אלנבי' },
            house: { number: '10' },
          },
          additionalDetails: {
            roomsCount: 3,
          },
        },
      }),
      fetched_at: '2026-03-01',
      processed_at: null,
    };

    (mockDb.getUnprocessedRawListings as any).mockResolvedValue([rawListing]);
    (mockDb.getSourceById as any).mockResolvedValue(yad2Source);

    await processBatch(mockDb as DB, 10, mockAi);

    expect(mockAi.run).not.toHaveBeenCalled();
    expect(upsertedListings[0].ai_extracted).toBe(0);
  });

  it('should call AI when price is missing for Facebook listing', async () => {
    const fbSource: Source = { id: 2, name: 'facebook', enabled: true, created_at: '2026-01-01' };
    const rawListing: ListingRaw = {
      id: 2,
      source_id: 2,
      source_item_id: 'fb_123',
      url: 'https://facebook.com/groups/123/posts/456',
      raw_json: JSON.stringify({
        source: 'facebook',
        sourceItemId: 'fb_123',
        rawTitle: 'דירה להשכרה בתל אביב',
        rawDescription: FB_LONG_DESC,
        rawUrl: 'https://facebook.com/groups/123/posts/456',
        rawPostedAt: '2026-03-01T10:00:00Z',
        sourceData: { groupId: '123' },
      }),
      fetched_at: '2026-03-01',
      processed_at: null,
    };

    (mockDb.getUnprocessedRawListings as any).mockResolvedValue([rawListing]);
    (mockDb.getSourceById as any).mockResolvedValue(fbSource);
    (mockAi.run as any).mockResolvedValue({
      response: JSON.stringify({
        is_rental: true,
        price: 5000,
        currency: 'ILS',
        price_period: 'month',
        bedrooms: 3,
        city: 'תל אביב',
        neighborhood: 'פלורנטין',
        street: null,
        floor: 2,
        square_meters: 80,
        entry_date: '2026-04-01',
        tags: ['balcony'],
      }),
    });

    await processBatch(mockDb as DB, 10, mockAi);

    expect(mockAi.run).toHaveBeenCalledTimes(1);
    expect(upsertedListings[0].ai_extracted).toBe(1);
    expect(upsertedListings[0].neighborhood).toBe('פלורנטין');
    expect(upsertedListings[0].floor).toBe(2);
    expect(upsertedListings[0].square_meters).toBe(80);
    expect(upsertedListings[0].entry_date).toBe('2026-04-01');
  });

  it('should call AI when both neighborhood and street are null for Facebook listing', async () => {
    const fbSource: Source = { id: 2, name: 'facebook', enabled: true, created_at: '2026-01-01' };
    const rawListing: ListingRaw = {
      id: 3,
      source_id: 2,
      source_item_id: 'fb_456',
      url: 'https://facebook.com/groups/123/posts/789',
      raw_json: JSON.stringify({
        source: 'facebook',
        sourceItemId: 'fb_456',
        rawTitle: 'דירה 3 חדרים 5000 שקלים',
        rawDescription: FB_LONG_DESC,
        rawUrl: 'https://facebook.com/groups/123/posts/789',
        rawPostedAt: '2026-03-01T10:00:00Z',
        sourceData: { groupId: '123' },
      }),
      fetched_at: '2026-03-01',
      processed_at: null,
    };

    (mockDb.getUnprocessedRawListings as any).mockResolvedValue([rawListing]);
    (mockDb.getSourceById as any).mockResolvedValue(fbSource);
    (mockAi.run as any).mockResolvedValue({
      response: JSON.stringify({
        is_rental: true,
        price: 5000,
        currency: 'ILS',
        price_period: 'month',
        bedrooms: 3,
        city: 'תל אביב',
        neighborhood: 'פלורנטין',
        street: 'דיזנגוף',
        floor: null,
        square_meters: null,
        entry_date: null,
        tags: [],
      }),
    });

    await processBatch(mockDb as DB, 10, mockAi);

    expect(mockAi.run).toHaveBeenCalledTimes(1);
    expect(upsertedListings[0].ai_extracted).toBe(1);
    expect(upsertedListings[0].neighborhood).toBe('פלורנטין');
    expect(upsertedListings[0].street).toBe('דיזנגוף');
  });

  it('should NOT call AI when all fields are present', async () => {
    const fbSource: Source = { id: 2, name: 'facebook', enabled: true, created_at: '2026-01-01' };
    const rawListing: ListingRaw = {
      id: 4,
      source_id: 2,
      source_item_id: 'fb_complete',
      url: 'https://facebook.com/groups/123/posts/999',
      raw_json: JSON.stringify({
        source: 'facebook',
        sourceItemId: 'fb_complete',
        rawTitle: 'דירה 3 חדרים',
        rawDescription: 'דירה בתל אביב פלורנטין רחוב דיזנגוף 10, 5000 שקלים לחודש',
        rawUrl: 'https://facebook.com/groups/123/posts/999',
        rawPostedAt: '2026-03-01T10:00:00Z',
        sourceData: { groupId: '123' },
      }),
      fetched_at: '2026-03-01',
      processed_at: null,
    };

    (mockDb.getUnprocessedRawListings as any).mockResolvedValue([rawListing]);
    (mockDb.getSourceById as any).mockResolvedValue(fbSource);

    await processBatch(mockDb as DB, 10, mockAi);

    expect(mockAi.run).not.toHaveBeenCalled();
    expect(upsertedListings[0].ai_extracted).toBe(0);
  });

  it('should respect AI budget exhaustion and fall back to regex-only', async () => {
    const fbSource: Source = { id: 2, name: 'facebook', enabled: true, created_at: '2026-01-01' };

    // Create 15 listings (more than maxCallsPerBatch of 10)
    const rawListings: ListingRaw[] = Array.from({ length: 15 }, (_, i) => ({
      id: i + 1,
      source_id: 2,
      source_item_id: `fb_${i}`,
      url: `https://facebook.com/groups/123/posts/${i}`,
      raw_json: JSON.stringify({
        source: 'facebook',
        sourceItemId: `fb_${i}`,
        rawTitle: 'דירה',
        rawDescription: FB_LONG_DESC,
        rawUrl: `https://facebook.com/groups/123/posts/${i}`,
        rawPostedAt: '2026-03-01T10:00:00Z',
        sourceData: { groupId: '123' },
      }),
      fetched_at: '2026-03-01',
      processed_at: null,
    }));

    (mockDb.getUnprocessedRawListings as any).mockResolvedValue(rawListings);
    (mockDb.getSourceById as any).mockResolvedValue(fbSource);
    (mockAi.run as any).mockResolvedValue({
      response: JSON.stringify({
        is_rental: true,
        price: null,
        currency: null,
        price_period: null,
        bedrooms: null,
        city: 'תל אביב',
        neighborhood: 'פלורנטין',
        street: null,
        floor: null,
        square_meters: null,
        entry_date: null,
        tags: [],
      }),
    });

    const result = await processBatch(mockDb as DB, 50, mockAi);

    // Should call AI exactly 10 times (budget limit)
    expect(mockAi.run).toHaveBeenCalledTimes(10);
    expect(result.processed).toBe(15);
    expect(result.aiMetrics).toBeDefined();
    expect(result.aiMetrics!.called).toBe(10);
    expect(result.aiMetrics!.skippedBudget).toBe(5);
  });

  it('should handle AI failure gracefully and continue with regex-only', async () => {
    const fbSource: Source = { id: 2, name: 'facebook', enabled: true, created_at: '2026-01-01' };
    const rawListing: ListingRaw = {
      id: 5,
      source_id: 2,
      source_item_id: 'fb_fail',
      url: 'https://facebook.com/groups/123/posts/fail',
      raw_json: JSON.stringify({
        source: 'facebook',
        sourceItemId: 'fb_fail',
        rawTitle: 'דירה',
        rawDescription: FB_LONG_DESC,
        rawUrl: 'https://facebook.com/groups/123/posts/fail',
        rawPostedAt: '2026-03-01T10:00:00Z',
        sourceData: { groupId: '123' },
      }),
      fetched_at: '2026-03-01',
      processed_at: null,
    };

    (mockDb.getUnprocessedRawListings as any).mockResolvedValue([rawListing]);
    (mockDb.getSourceById as any).mockResolvedValue(fbSource);
    (mockAi.run as any).mockRejectedValue(new Error('AI service unavailable'));

    const result = await processBatch(mockDb as DB, 10, mockAi);

    expect(result.processed).toBe(1);
    expect(result.failed).toBe(0);
    expect(upsertedListings[0].ai_extracted).toBe(0);
    expect(result.aiMetrics!.failed).toBe(1);
  });

  it('should merge AI results correctly with regex results', async () => {
    const fbSource: Source = { id: 2, name: 'facebook', enabled: true, created_at: '2026-01-01' };
    const rawListing: ListingRaw = {
      id: 6,
      source_id: 2,
      source_item_id: 'fb_merge',
      url: 'https://facebook.com/groups/123/posts/merge',
      raw_json: JSON.stringify({
        source: 'facebook',
        sourceItemId: 'fb_merge',
        rawTitle: 'דירה 3 חדרים',
        rawDescription: FB_LONG_DESC,
        rawUrl: 'https://facebook.com/groups/123/posts/merge',
        rawPostedAt: '2026-03-01T10:00:00Z',
        sourceData: { groupId: '123' },
      }),
      fetched_at: '2026-03-01',
      processed_at: null,
    };

    (mockDb.getUnprocessedRawListings as any).mockResolvedValue([rawListing]);
    (mockDb.getSourceById as any).mockResolvedValue(fbSource);
    (mockAi.run as any).mockResolvedValue({
      response: JSON.stringify({
        is_rental: true,
        price: 5000,
        currency: 'ILS',
        price_period: 'month',
        bedrooms: 3,
        city: 'תל אביב',
        neighborhood: 'פלורנטין',
        street: 'דיזנגוף',
        floor: 3,
        square_meters: 90,
        entry_date: '2026-04-15',
        tags: ['balcony', 'parking'],
      }),
    });

    await processBatch(mockDb as DB, 10, mockAi);

    const listing = upsertedListings[0];
    // Regex extracts bedrooms from title, AI fills price and other gaps
    expect(listing.price).toBe(5000); // From AI (no price in text)
    expect(listing.bedrooms).toBe(3); // From regex (title)
    expect(listing.neighborhood).toBe('פלורנטין'); // From AI
    expect(listing.floor).toBe(3); // From AI
    expect(listing.square_meters).toBe(90); // From AI
    expect(listing.entry_date).toBe('2026-04-15'); // From AI
    expect(listing.ai_extracted).toBe(1);
  });

  it('should set ai_extracted flag correctly', async () => {
    const fbSource: Source = { id: 2, name: 'facebook', enabled: true, created_at: '2026-01-01' };
    const yad2Source: Source = { id: 1, name: 'yad2', enabled: true, created_at: '2026-01-01' };

    const fbListing: ListingRaw = {
      id: 7,
      source_id: 2,
      source_item_id: 'fb_flag',
      url: 'https://facebook.com/groups/123/posts/flag',
      raw_json: JSON.stringify({
        source: 'facebook',
        sourceItemId: 'fb_flag',
        rawTitle: 'דירה',
        rawDescription: FB_LONG_DESC,
        rawUrl: 'https://facebook.com/groups/123/posts/flag',
        rawPostedAt: '2026-03-01T10:00:00Z',
        sourceData: { groupId: '123' },
      }),
      fetched_at: '2026-03-01',
      processed_at: null,
    };

    const yad2Listing: ListingRaw = {
      id: 8,
      source_id: 1,
      source_item_id: 'yad2_flag',
      url: 'https://yad2.co.il/item/456',
      raw_json: JSON.stringify({
        source: 'yad2',
        sourceItemId: 'yad2_flag',
        rawTitle: 'דירה בתל אביב',
        rawDescription: 'דירה יפה',
        rawUrl: 'https://yad2.co.il/item/456',
        rawPostedAt: null,
        sourceData: {
          orderId: 'yad2_flag',
          token: 'test-token',
          price: 5000,
          address: {
            city: { text: 'תל אביב' },
            neighborhood: { text: 'פלורנטין' },
            street: { text: 'אלנבי' },
            house: { number: '10' },
          },
          additionalDetails: {
            roomsCount: 3,
          },
        },
      }),
      fetched_at: '2026-03-01',
      processed_at: null,
    };

    (mockDb.getUnprocessedRawListings as any).mockResolvedValue([fbListing, yad2Listing]);
    (mockDb.getSourceById as any).mockImplementation((id: number) => {
      return id === 1 ? yad2Source : fbSource;
    });
    (mockAi.run as any).mockResolvedValue({
      response: JSON.stringify({
        is_rental: true,
        price: null,
        currency: null,
        price_period: null,
        bedrooms: null,
        city: 'תל אביב',
        neighborhood: 'פלורנטין',
        street: null,
        floor: null,
        square_meters: null,
        entry_date: null,
        tags: [],
      }),
    });

    await processBatch(mockDb as DB, 10, mockAi);

    expect(upsertedListings[0].ai_extracted).toBe(1); // Facebook listing used AI
    expect(upsertedListings[1].ai_extracted).toBe(0); // Yad2 listing didn't use AI
  });

  it('should populate new fields from AI result', async () => {
    const fbSource: Source = { id: 2, name: 'facebook', enabled: true, created_at: '2026-01-01' };
    const rawListing: ListingRaw = {
      id: 9,
      source_id: 2,
      source_item_id: 'fb_newfields',
      url: 'https://facebook.com/groups/123/posts/newfields',
      raw_json: JSON.stringify({
        source: 'facebook',
        sourceItemId: 'fb_newfields',
        rawTitle: 'דירה',
        rawDescription: FB_LONG_DESC,
        rawUrl: 'https://facebook.com/groups/123/posts/newfields',
        rawPostedAt: '2026-03-01T10:00:00Z',
        sourceData: { groupId: '123' },
      }),
      fetched_at: '2026-03-01',
      processed_at: null,
    };

    (mockDb.getUnprocessedRawListings as any).mockResolvedValue([rawListing]);
    (mockDb.getSourceById as any).mockResolvedValue(fbSource);
    (mockAi.run as any).mockResolvedValue({
      response: JSON.stringify({
        is_rental: true,
        price: null,
        currency: null,
        price_period: null,
        bedrooms: null,
        city: 'תל אביב',
        neighborhood: 'פלורנטין',
        street: null,
        floor: 5,
        square_meters: 120,
        entry_date: '2026-05-01',
        tags: [],
      }),
    });

    await processBatch(mockDb as DB, 10, mockAi);

    const listing = upsertedListings[0];
    expect(listing.floor).toBe(5);
    expect(listing.square_meters).toBe(120);
    expect(listing.entry_date).toBe('2026-05-01');
  });
});

describe('duplicate detection', () => {
  let mockDb: Partial<DB>;
  let upsertedListings: any[];

  beforeEach(() => {
    upsertedListings = [];

    mockDb = {
      getUnprocessedRawListings: vi.fn(),
      markRawListingProcessed: vi.fn(),
      getSourceById: vi.fn(),
      upsertListing: vi.fn().mockImplementation((listing) => {
        upsertedListings.push(listing);
        return Promise.resolve(upsertedListings.length);
      }),
      findDuplicate: vi.fn().mockResolvedValue(null),
      swapCanonical: vi.fn().mockResolvedValue(undefined),
    };
  });

  it('should mark listing as duplicate when findDuplicate returns a match with higher priority source', async () => {
    const yad2Source: Source = { id: 1, name: 'yad2', enabled: true, created_at: '2026-01-01' };
    const fbSource: Source = { id: 2, name: 'facebook', enabled: true, created_at: '2026-01-01' };

    const rawListing: ListingRaw = {
      id: 1,
      source_id: 1, // YAD2 source (lower priority)
      source_item_id: 'yad2_dup',
      url: 'https://yad2.co.il/item/dup',
      raw_json: JSON.stringify({
        source: 'yad2',
        sourceItemId: 'yad2_dup',
        rawTitle: 'דירה בתל אביב',
        rawDescription: 'דירה יפה',
        rawUrl: 'https://yad2.co.il/item/dup',
        rawPostedAt: null,
        sourceData: {
          orderId: 'dup',
          token: 'test-token',
          price: 5000,
          address: {
            city: { text: 'תל אביב' },
            neighborhood: { text: 'פלורנטין' },
            street: { text: 'דיזנגוף' },
            house: { number: '10' },
          },
          additionalDetails: {
            roomsCount: 3,
          },
        },
      }),
      fetched_at: '2026-03-01',
      processed_at: null,
    };

    (mockDb.getUnprocessedRawListings as any).mockResolvedValue([rawListing]);
    (mockDb.getSourceById as any).mockImplementation((id: number) => {
      return id === 1 ? yad2Source : fbSource;
    });
    (mockDb.findDuplicate as any).mockResolvedValue({
      id: 100,
      sourceId: 2, // Facebook source (higher priority)
      street: 'דיזנגוף',
      house_number: '10',
      neighborhood: 'פלורנטין',
      latitude: null,
      longitude: null,
      price: 5000,
    });

    await processBatch(mockDb as DB, 10);

    expect(mockDb.findDuplicate).toHaveBeenCalledWith({
      city: 'תל אביב',
      bedrooms: 3,
      price: 5000,
      street: 'דיזנגוף',
      house_number: '10',
      neighborhood: 'פלורנטין',
      latitude: null,
      longitude: null,
      source_id: 1,
      source_item_id: 'yad2_dup',
    });
    expect(upsertedListings[0].duplicate_of).toBe(100);
    expect(mockDb.swapCanonical).not.toHaveBeenCalled();
  });

  it('should swap canonical when findDuplicate returns a match with lower priority source', async () => {
    const yad2Source: Source = { id: 1, name: 'yad2', enabled: true, created_at: '2026-01-01' };
    const fbSource: Source = { id: 2, name: 'facebook', enabled: true, created_at: '2026-01-01' };

    const rawListing: ListingRaw = {
      id: 2,
      source_id: 2, // Facebook source (higher priority)
      source_item_id: 'fb_123',
      url: 'https://facebook.com/groups/123/posts/123',
      raw_json: JSON.stringify({
        source: 'facebook',
        sourceItemId: 'fb_123',
        rawTitle: 'דירה 3 חדרים',
        rawDescription: 'דירה בתל אביב פלורנטין רחוב דיזנגוף 10, 5000 שקלים לחודש',
        rawUrl: 'https://facebook.com/groups/123/posts/123',
        rawPostedAt: '2026-03-01T10:00:00Z',
        sourceData: { groupId: '123' },
      }),
      fetched_at: '2026-03-01',
      processed_at: null,
    };

    (mockDb.getUnprocessedRawListings as any).mockResolvedValue([rawListing]);
    (mockDb.getSourceById as any).mockImplementation((id: number) => {
      return id === 1 ? yad2Source : fbSource;
    });
    (mockDb.findDuplicate as any).mockResolvedValue({
      id: 200,
      sourceId: 1, // YAD2 source (lower priority)
      street: 'דיזנגוף',
      house_number: '10',
      neighborhood: 'פלורנטין',
      latitude: null,
      longitude: null,
      price: 5000,
    });

    await processBatch(mockDb as DB, 10);

    expect(upsertedListings[0].duplicate_of).toBeNull();
    expect(mockDb.swapCanonical).toHaveBeenCalledWith(1, 200);
  });

  it('should not mark as duplicate when findDuplicate returns null', async () => {
    const yad2Source: Source = { id: 1, name: 'yad2', enabled: true, created_at: '2026-01-01' };

    const rawListing: ListingRaw = {
      id: 3,
      source_id: 1,
      source_item_id: 'yad2_unique',
      url: 'https://yad2.co.il/item/unique',
      raw_json: JSON.stringify({
        source: 'yad2',
        sourceItemId: 'yad2_unique',
        rawTitle: 'דירה בתל אביב',
        rawDescription: 'דירה יפה',
        rawUrl: 'https://yad2.co.il/item/unique',
        rawPostedAt: null,
        sourceData: {
          orderId: 'unique',
          token: 'test-token',
          price: 5000,
          address: {
            city: { text: 'תל אביב' },
            neighborhood: { text: 'פלורנטין' },
            street: { text: 'אלנבי' },
            house: { number: '20' },
          },
          additionalDetails: {
            roomsCount: 3,
          },
        },
      }),
      fetched_at: '2026-03-01',
      processed_at: null,
    };

    (mockDb.getUnprocessedRawListings as any).mockResolvedValue([rawListing]);
    (mockDb.getSourceById as any).mockResolvedValue(yad2Source);
    (mockDb.findDuplicate as any).mockResolvedValue(null);

    await processBatch(mockDb as DB, 10);

    expect(mockDb.findDuplicate).toHaveBeenCalled();
    expect(upsertedListings[0].duplicate_of).toBeNull();
    expect(mockDb.swapCanonical).not.toHaveBeenCalled();
  });

  it('should skip duplicate detection when city is null', async () => {
    const fbSource: Source = { id: 2, name: 'facebook', enabled: true, created_at: '2026-01-01' };

    const rawListing: ListingRaw = {
      id: 4,
      source_id: 2,
      source_item_id: 'fb_no_city',
      url: 'https://facebook.com/groups/123/posts/no_city',
      raw_json: JSON.stringify({
        source: 'facebook',
        sourceItemId: 'fb_no_city',
        rawTitle: 'דירה',
        rawDescription: 'דירה יפה, 3 חדרים, 5000 שקלים',
        rawUrl: 'https://facebook.com/groups/123/posts/no_city',
        rawPostedAt: '2026-03-01T10:00:00Z',
        sourceData: { groupId: '123' },
      }),
      fetched_at: '2026-03-01',
      processed_at: null,
    };

    (mockDb.getUnprocessedRawListings as any).mockResolvedValue([rawListing]);
    (mockDb.getSourceById as any).mockResolvedValue(fbSource);

    await processBatch(mockDb as DB, 10);

    expect(mockDb.findDuplicate).not.toHaveBeenCalled();
    expect(upsertedListings[0].duplicate_of).toBeNull();
  });

  it('should skip duplicate detection when price is null', async () => {
    const fbSource: Source = { id: 2, name: 'facebook', enabled: true, created_at: '2026-01-01' };

    const rawListing: ListingRaw = {
      id: 5,
      source_id: 2,
      source_item_id: 'fb_no_price',
      url: 'https://facebook.com/groups/123/posts/no_price',
      raw_json: JSON.stringify({
        source: 'facebook',
        sourceItemId: 'fb_no_price',
        rawTitle: 'דירה 3 חדרים',
        rawDescription: 'דירה בתל אביב פלורנטין',
        rawUrl: 'https://facebook.com/groups/123/posts/no_price',
        rawPostedAt: '2026-03-01T10:00:00Z',
        sourceData: { groupId: '123' },
      }),
      fetched_at: '2026-03-01',
      processed_at: null,
    };

    (mockDb.getUnprocessedRawListings as any).mockResolvedValue([rawListing]);
    (mockDb.getSourceById as any).mockResolvedValue(fbSource);

    await processBatch(mockDb as DB, 10);

    expect(mockDb.findDuplicate).not.toHaveBeenCalled();
    expect(upsertedListings[0].duplicate_of).toBeNull();
  });

  it('should skip duplicate detection when bedrooms is null', async () => {
    const fbSource: Source = { id: 2, name: 'facebook', enabled: true, created_at: '2026-01-01' };

    const rawListing: ListingRaw = {
      id: 6,
      source_id: 2,
      source_item_id: 'fb_no_bedrooms',
      url: 'https://facebook.com/groups/123/posts/no_bedrooms',
      raw_json: JSON.stringify({
        source: 'facebook',
        sourceItemId: 'fb_no_bedrooms',
        rawTitle: 'דירה',
        rawDescription: 'דירה בתל אביב, 5000 שקלים לחודש',
        rawUrl: 'https://facebook.com/groups/123/posts/no_bedrooms',
        rawPostedAt: '2026-03-01T10:00:00Z',
        sourceData: { groupId: '123' },
      }),
      fetched_at: '2026-03-01',
      processed_at: null,
    };

    (mockDb.getUnprocessedRawListings as any).mockResolvedValue([rawListing]);
    (mockDb.getSourceById as any).mockResolvedValue(fbSource);

    await processBatch(mockDb as DB, 10);

    expect(mockDb.findDuplicate).not.toHaveBeenCalled();
    expect(upsertedListings[0].duplicate_of).toBeNull();
  });
});
