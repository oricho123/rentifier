import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationService } from '../notification-service';
import type { DB, ListingRow, FilterRow, User } from '@rentifier/db';
import type { TelegramClient, SendPhotoResult } from '../telegram-client';
import type { MessageFormatter } from '../message-formatter';

describe('NotificationService - Image Integration', () => {
  let service: NotificationService;
  let mockDb: Partial<DB>;
  let mockTelegram: Partial<TelegramClient>;
  let mockFormatter: Partial<MessageFormatter>;

  const mockUser: User = {
    id: 1,
    telegram_chat_id: '123456',
    display_name: 'Test User',
    created_at: '2026-01-01T00:00:00Z',
  };

  const createMockListing = (overrides: Partial<ListingRow> = {}): ListingRow => ({
    id: 1,
    source_id: 1,
    source_item_id: 'test-123',
    title: 'Test Listing',
    description: null,
    price: 5000,
    currency: 'ILS',
    price_period: 'month',
    bedrooms: 3,
    city: 'Tel Aviv',
    neighborhood: 'Center',
    area_text: null,
    street: null,
    house_number: null,
    url: 'https://example.com/listing',
    posted_at: null,
    ingested_at: '2026-02-22T10:00:00Z',
    tags_json: null,
    relevance_score: null,
    floor: null,
    square_meters: null,
    property_type: null,
    latitude: null,
    longitude: null,
    image_url: null,
    ...overrides,
  });

  const mockFilter: FilterRow & { user: User } = {
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
    user: mockUser,
  };

  beforeEach(() => {
    mockDb = {
      getWorkerState: vi.fn().mockResolvedValue({ lastRunAt: '2026-02-22T09:00:00Z' }),
      updateWorkerState: vi.fn().mockResolvedValue(undefined),
      getActiveFilters: vi.fn().mockResolvedValue([mockFilter]),
      getNewListingsSince: vi.fn().mockResolvedValue([]),
      checkNotificationSent: vi.fn().mockResolvedValue(false),
      recordNotificationSent: vi.fn().mockResolvedValue(undefined),
    };

    mockTelegram = {
      sendMessage: vi.fn().mockResolvedValue({ success: true, messageId: 123 }),
      sendPhoto: vi.fn().mockResolvedValue({
        success: true,
        messageId: 456,
        retryable: false,
        imageAvailable: true,
      } as SendPhotoResult),
    };

    mockFormatter = {
      format: vi.fn().mockReturnValue('Formatted message'),
    };

    service = new NotificationService(
      mockDb as DB,
      mockTelegram as TelegramClient,
      mockFormatter as MessageFormatter
    );
  });

  it('should call sendPhoto when listing has image_url', async () => {
    const listingWithImage = createMockListing({
      id: 1,
      image_url: 'https://example.com/image.jpg',
    });

    mockDb.getNewListingsSince = vi.fn().mockResolvedValue([listingWithImage]);

    await service.processNotifications();

    expect(mockTelegram.sendPhoto).toHaveBeenCalledWith(
      mockUser.telegram_chat_id,
      'https://example.com/image.jpg',
      'Formatted message',
      'HTML'
    );
  });

  it('should increment imageSuccess when photo sends successfully', async () => {
    const listingWithImage = createMockListing({
      id: 1,
      image_url: 'https://example.com/image.jpg',
    });

    mockDb.getNewListingsSince = vi.fn().mockResolvedValue([listingWithImage]);

    const result = await service.processNotifications();

    expect(result.imageSuccess).toBe(1);
    expect(result.imageFallback).toBe(0);
    expect(result.noImage).toBe(0);
    expect(result.sent).toBe(1);
  });

  it('should fall back to sendMessage when photo fails with non-retryable error', async () => {
    const listingWithImage = createMockListing({
      id: 1,
      image_url: 'https://invalid.url/bad-image.jpg',
    });

    mockDb.getNewListingsSince = vi.fn().mockResolvedValue([listingWithImage]);

    mockTelegram.sendPhoto = vi.fn().mockResolvedValue({
      success: false,
      error: 'Invalid image URL',
      retryable: false,
      imageAvailable: true,
    } as SendPhotoResult);

    mockTelegram.sendMessage = vi.fn().mockResolvedValue({
      success: true,
      messageId: 789,
    });

    const result = await service.processNotifications();

    expect(mockTelegram.sendPhoto).toHaveBeenCalled();
    expect(mockTelegram.sendMessage).toHaveBeenCalledWith(
      mockUser.telegram_chat_id,
      'Formatted message',
      'HTML'
    );
    expect(result.imageFallback).toBe(1);
    expect(result.imageSuccess).toBe(0);
    expect(result.sent).toBe(1);
  });

  it('should NOT fall back when photo fails with retryable error', async () => {
    const listingWithImage = createMockListing({
      id: 1,
      image_url: 'https://example.com/image.jpg',
    });

    mockDb.getNewListingsSince = vi.fn().mockResolvedValue([listingWithImage]);

    mockTelegram.sendPhoto = vi.fn().mockResolvedValue({
      success: false,
      error: 'Network error',
      retryable: true,
      imageAvailable: true,
    } as SendPhotoResult);

    const result = await service.processNotifications();

    expect(mockTelegram.sendPhoto).toHaveBeenCalled();
    expect(mockTelegram.sendMessage).not.toHaveBeenCalled();
    expect(result.failed).toBe(1);
    expect(result.imageFallback).toBe(0);
  });

  it('should call sendMessage directly when listing has no image_url', async () => {
    const listingWithoutImage = createMockListing({
      id: 1,
      image_url: null,
    });

    mockDb.getNewListingsSince = vi.fn().mockResolvedValue([listingWithoutImage]);

    const result = await service.processNotifications();

    expect(mockTelegram.sendPhoto).not.toHaveBeenCalled();
    expect(mockTelegram.sendMessage).toHaveBeenCalledWith(
      mockUser.telegram_chat_id,
      'Formatted message',
      'HTML'
    );
    expect(result.noImage).toBe(1);
    expect(result.sent).toBe(1);
  });

  it('should increment noImage counter for listings without images', async () => {
    const listingsWithoutImages = [
      createMockListing({ id: 1, image_url: null }),
      createMockListing({ id: 2, image_url: null }),
    ];

    mockDb.getNewListingsSince = vi.fn().mockResolvedValue(listingsWithoutImages);

    const result = await service.processNotifications();

    expect(result.noImage).toBe(2);
    expect(result.imageSuccess).toBe(0);
    expect(result.imageFallback).toBe(0);
  });

  it('should calculate image success rate correctly in logs', async () => {
    const listings = [
      createMockListing({ id: 1, image_url: 'https://example.com/image1.jpg' }),
      createMockListing({ id: 2, image_url: 'https://example.com/image2.jpg' }),
      createMockListing({ id: 3, image_url: null }),
    ];

    mockDb.getNewListingsSince = vi.fn().mockResolvedValue(listings);

    const consoleSpy = vi.spyOn(console, 'log');

    await service.processNotifications();

    const notifyCompleteLog = consoleSpy.mock.calls.find((call) => {
      const log = JSON.parse(call[0] as string);
      return log.event === 'notify_complete';
    });

    expect(notifyCompleteLog).toBeDefined();
    const log = JSON.parse(notifyCompleteLog![0] as string);
    expect(log.imageSuccess).toBe(2);
    expect(log.noImage).toBe(1);
    expect(log.imageFallback).toBe(0);
    expect(log.imageSuccessRate).toBeCloseTo(2 / 3);
  });

  it('should handle mixed image success and fallback scenarios', async () => {
    const listings = [
      createMockListing({ id: 1, image_url: 'https://example.com/good-image.jpg' }),
      createMockListing({ id: 2, image_url: 'https://example.com/bad-image.jpg' }),
      createMockListing({ id: 3, image_url: null }),
    ];

    mockDb.getNewListingsSince = vi.fn().mockResolvedValue(listings);

    let photoCallCount = 0;
    mockTelegram.sendPhoto = vi.fn().mockImplementation(async () => {
      photoCallCount++;
      if (photoCallCount === 1) {
        return {
          success: true,
          messageId: 100,
          retryable: false,
          imageAvailable: true,
        } as SendPhotoResult;
      } else {
        return {
          success: false,
          error: 'Invalid image',
          retryable: false,
          imageAvailable: true,
        } as SendPhotoResult;
      }
    });

    const result = await service.processNotifications();

    expect(result.imageSuccess).toBe(1);
    expect(result.imageFallback).toBe(1);
    expect(result.noImage).toBe(1);
    expect(result.sent).toBe(3);
  });
});
