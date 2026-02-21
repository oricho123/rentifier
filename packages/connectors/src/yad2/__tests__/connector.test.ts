import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Yad2Connector } from '../index';
import type { ListingCandidate } from '@rentifier/core';
import type { Yad2Marker } from '../types';
import * as client from '../client';

vi.mock('../client', () => ({
  fetchWithRetry: vi.fn(),
  Yad2ApiError: class extends Error {
    constructor(
      message: string,
      public readonly statusCode: number | null,
      public readonly errorType: 'network' | 'captcha' | 'http' | 'parse' | 'timeout',
      public readonly retryable: boolean,
    ) {
      super(message);
      this.name = 'Yad2ApiError';
    }
  },
}));

function createTestMarker(overrides: Partial<Yad2Marker> = {}): Yad2Marker {
  return {
    orderId: 'test-123',
    token: 'test-token',
    price: 5000,
    adType: 1,
    categoryId: 2,
    subcategoryId: 1,
    address: {
      city: { text: 'תל אביב' },
      area: { text: 'מרכז' },
      neighborhood: { text: 'פלורנטין' },
      street: { text: 'אלנבי' },
      house: { number: '10', floor: 3 },
      coords: { lat: 32.06, lon: 34.77 },
    },
    additionalDetails: {
      roomsCount: 3,
      squareMeter: 75,
      property: { text: 'דירה' },
      propertyCondition: { id: 3 },
    },
    metaData: {
      coverImage: 'https://img.yad2.co.il/test.jpg',
      images: ['img1.jpg', 'img2.jpg'],
      squareMeterBuild: null,
    },
    ...overrides,
  };
}

describe('Yad2Connector', () => {
  let connector: Yad2Connector;

  beforeEach(() => {
    connector = new Yad2Connector();
    vi.clearAllMocks();
  });

  describe('normalize', () => {
    it('should map structured fields correctly', () => {
      const marker = createTestMarker();
      const candidate: ListingCandidate = {
        source: 'yad2',
        sourceItemId: marker.orderId,
        rawTitle: '3 חדרים בתל אביב - 5,000 ₪',
        rawDescription: 'אלנבי, פלורנטין, 75 מ״ר',
        rawUrl: `https://www.yad2.co.il/realestate/item/${marker.token}`,
        rawPostedAt: null,
        sourceData: marker as unknown as Record<string, unknown>,
      };

      const draft = connector.normalize(candidate);

      expect(draft.sourceId).toBe('yad2');
      expect(draft.sourceItemId).toBe('test-123');
      expect(draft.price).toBe(5000);
      expect(draft.currency).toBe('ILS');
      expect(draft.pricePeriod).toBe('month');
      expect(draft.bedrooms).toBe(3);
      expect(draft.city).toBe('תל אביב');
      expect(draft.neighborhood).toBe('פלורנטין');
      expect(draft.floor).toBe(3);
      expect(draft.squareMeters).toBe(75);
      expect(draft.propertyType).toBe('דירה');
      expect(draft.latitude).toBe(32.06);
      expect(draft.longitude).toBe(34.77);
      expect(draft.imageUrl).toBe('https://img.yad2.co.il/test.jpg');
    });

    it('should handle missing optional fields', () => {
      const marker: Yad2Marker = {
        orderId: 'test-minimal',
        token: 'test-token',
        price: null,
        adType: 1,
        categoryId: 2,
        subcategoryId: 1,
        address: {
          city: { text: 'תל אביב' },
          area: { text: 'מרכז' },
          neighborhood: { text: '' },
          street: { text: '' },
          house: { number: null, floor: null },
          coords: { lat: 0, lon: 0 },
        },
        additionalDetails: {
          roomsCount: null,
          squareMeter: null,
          property: { text: '' },
          propertyCondition: { id: null },
        },
        metaData: {
          coverImage: null,
          images: [],
          squareMeterBuild: null,
        },
      };

      const candidate: ListingCandidate = {
        source: 'yad2',
        sourceItemId: marker.orderId,
        rawTitle: 'בתל אביב',
        rawDescription: '',
        rawUrl: 'https://www.yad2.co.il/realestate/rent',
        rawPostedAt: null,
        sourceData: marker as unknown as Record<string, unknown>,
      };

      const draft = connector.normalize(candidate);

      expect(draft.price).toBeNull();
      expect(draft.bedrooms).toBeNull();
      expect(draft.floor).toBeNull();
      expect(draft.squareMeters).toBeNull();
      expect(draft.imageUrl).toBeNull();
    });

    it('should extract tags from property type', () => {
      const marker = createTestMarker({
        additionalDetails: {
          roomsCount: 3,
          squareMeter: 75,
          property: { text: 'פנטהאוז' },
          propertyCondition: { id: null },
        },
      });

      const candidate: ListingCandidate = {
        source: 'yad2',
        sourceItemId: marker.orderId,
        rawTitle: 'Test',
        rawDescription: 'Test',
        rawUrl: 'https://www.yad2.co.il/realestate/rent',
        rawPostedAt: null,
        sourceData: marker as unknown as Record<string, unknown>,
      };

      const draft = connector.normalize(candidate);

      expect(draft.tags).toContain('penthouse');
    });

    it('should extract tags from condition', () => {
      const marker = createTestMarker({
        additionalDetails: {
          roomsCount: 3,
          squareMeter: 75,
          property: { text: 'דירה' },
          propertyCondition: { id: 2 },
        },
      });

      const candidate: ListingCandidate = {
        source: 'yad2',
        sourceItemId: marker.orderId,
        rawTitle: 'Test',
        rawDescription: 'Test',
        rawUrl: 'https://www.yad2.co.il/realestate/rent',
        rawPostedAt: null,
        sourceData: marker as unknown as Record<string, unknown>,
      };

      const draft = connector.normalize(candidate);

      expect(draft.tags).toContain('renovated');
    });

    it('should extract floor tags', () => {
      const groundFloorMarker = createTestMarker({
        address: {
          city: { text: 'תל אביב' },
          area: { text: 'מרכז' },
          neighborhood: { text: 'פלורנטין' },
          street: { text: 'אלנבי' },
          house: { number: '10', floor: 0 },
          coords: { lat: 32.06, lon: 34.77 },
        },
      });

      const candidate1: ListingCandidate = {
        source: 'yad2',
        sourceItemId: groundFloorMarker.orderId,
        rawTitle: 'Test',
        rawDescription: 'Test',
        rawUrl: 'https://www.yad2.co.il/realestate/rent',
        rawPostedAt: null,
        sourceData: groundFloorMarker as unknown as Record<string, unknown>,
      };

      const draft1 = connector.normalize(candidate1);
      expect(draft1.tags).toContain('ground-floor');

      const highFloorMarker = createTestMarker({
        address: {
          city: { text: 'תל אביב' },
          area: { text: 'מרכז' },
          neighborhood: { text: 'פלורנטין' },
          street: { text: 'אלנבי' },
          house: { number: '10', floor: 8 },
          coords: { lat: 32.06, lon: 34.77 },
        },
      });

      const candidate2: ListingCandidate = {
        source: 'yad2',
        sourceItemId: highFloorMarker.orderId,
        rawTitle: 'Test',
        rawDescription: 'Test',
        rawUrl: 'https://www.yad2.co.il/realestate/rent',
        rawPostedAt: null,
        sourceData: highFloorMarker as unknown as Record<string, unknown>,
      };

      const draft2 = connector.normalize(candidate2);
      expect(draft2.tags).toContain('high-floor');
    });
  });

  describe('fetchNew', () => {
    it('should create default state when cursor is null', async () => {
      const mockMarkers = [createTestMarker()];
      vi.mocked(client.fetchWithRetry).mockResolvedValue({
        data: { markers: mockMarkers },
      });

      const result = await connector.fetchNew(null);

      expect(result.candidates).toHaveLength(1);
      expect(result.nextCursor).toBeTruthy();

      const cursorState = JSON.parse(result.nextCursor!);
      expect(cursorState.lastFetchedAt).toBeTruthy();
      expect(cursorState.knownOrderIds).toContain('test-123');
      expect(cursorState.consecutiveFailures).toBe(0);
      expect(cursorState.circuitOpenUntil).toBeNull();
    });

    it('should skip fetch when circuit breaker is open', async () => {
      const futureTime = new Date(Date.now() + 60000).toISOString();
      const cursor = JSON.stringify({
        lastFetchedAt: new Date().toISOString(),
        knownOrderIds: [],
        consecutiveFailures: 5,
        circuitOpenUntil: futureTime,
        lastCityIndex: 0,
      });

      const result = await connector.fetchNew(cursor);

      expect(result.candidates).toHaveLength(0);
      expect(client.fetchWithRetry).not.toHaveBeenCalled();
    });

    it('should filter out known orderIds', async () => {
      const cursor = JSON.stringify({
        lastFetchedAt: new Date().toISOString(),
        knownOrderIds: ['test-123', 'test-456'],
        consecutiveFailures: 0,
        circuitOpenUntil: null,
        lastCityIndex: 0,
      });

      const mockMarkers = [
        createTestMarker({ orderId: 'test-123' }),
        createTestMarker({ orderId: 'test-789' }),
      ];

      vi.mocked(client.fetchWithRetry).mockResolvedValue({
        data: { markers: mockMarkers },
      });

      const result = await connector.fetchNew(cursor);

      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0].sourceItemId).toBe('test-789');
    });

    it('should open circuit after max consecutive failures', async () => {
      const cursor = JSON.stringify({
        lastFetchedAt: new Date().toISOString(),
        knownOrderIds: [],
        consecutiveFailures: 4,
        circuitOpenUntil: null,
        lastCityIndex: 0,
      });

      vi.mocked(client.fetchWithRetry).mockRejectedValue(
        new Error('Network error')
      );

      const result = await connector.fetchNew(cursor);

      expect(result.candidates).toHaveLength(0);

      const cursorState = JSON.parse(result.nextCursor!);
      expect(cursorState.consecutiveFailures).toBe(5);
      expect(cursorState.circuitOpenUntil).toBeTruthy();
    });
  });
});
