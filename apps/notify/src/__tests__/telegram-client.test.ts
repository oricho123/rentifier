import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TelegramClient } from '../telegram-client';

describe('TelegramClient', () => {
  let client: TelegramClient;
  const mockToken = 'test-bot-token';
  const mockChatId = '123456';

  beforeEach(() => {
    client = new TelegramClient(mockToken);
    vi.clearAllMocks();
  });

  describe('sendPhoto', () => {
    it('should send photo successfully and return messageId', async () => {
      const mockResponse = {
        ok: true,
        result: { message_id: 789 },
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await client.sendPhoto(
        mockChatId,
        'https://example.com/photo.jpg',
        'Test caption',
        'HTML'
      );

      expect(result.success).toBe(true);
      expect(result.messageId).toBe(789);
      expect(result.retryable).toBe(false);
      expect(result.imageAvailable).toBe(true);

      expect(mockFetch).toHaveBeenCalledWith(
        `https://api.telegram.org/bot${mockToken}/sendPhoto`,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: mockChatId,
            photo: 'https://example.com/photo.jpg',
            caption: 'Test caption',
            parse_mode: 'HTML',
          }),
        })
      );
    });

    it('should return retryable=false for invalid image URL (400)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          ok: false,
          error_code: 400,
          description: 'Bad Request: wrong file identifier/HTTP URL specified',
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await client.sendPhoto(
        mockChatId,
        'https://invalid.url/bad-image.jpg',
        'Test caption',
        'HTML'
      );

      expect(result.success).toBe(false);
      expect(result.retryable).toBe(false);
      expect(result.error).toContain('wrong file identifier');
      expect(result.imageAvailable).toBe(true);
    });

    it('should return retryable=true for network errors (502)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => ({
          ok: false,
          error_code: 502,
          description: 'Bad Gateway',
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await client.sendPhoto(
        mockChatId,
        'https://example.com/photo.jpg',
        'Test caption',
        'HTML'
      );

      expect(result.success).toBe(false);
      expect(result.retryable).toBe(true);
      expect(result.error).toContain('Bad Gateway');
      expect(result.imageAvailable).toBe(true);
    });

    it('should return retryable=true for rate limiting (429)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({
          ok: false,
          error_code: 429,
          description: 'Too Many Requests',
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await client.sendPhoto(
        mockChatId,
        'https://example.com/photo.jpg',
        'Test caption',
        'HTML'
      );

      expect(result.success).toBe(false);
      expect(result.retryable).toBe(true);
      expect(result.imageAvailable).toBe(true);
    });

    it('should return retryable=false for image too large (400)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          ok: false,
          error_code: 400,
          description: 'Bad Request: PHOTO_INVALID_DIMENSIONS',
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await client.sendPhoto(
        mockChatId,
        'https://example.com/huge-photo.jpg',
        'Test caption',
        'HTML'
      );

      expect(result.success).toBe(false);
      expect(result.retryable).toBe(false);
      expect(result.error).toContain('PHOTO_INVALID_DIMENSIONS');
      expect(result.imageAvailable).toBe(true);
    });

    it('should return retryable=true for network fetch errors', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network connection failed'));
      vi.stubGlobal('fetch', mockFetch);

      const result = await client.sendPhoto(
        mockChatId,
        'https://example.com/photo.jpg',
        'Test caption',
        'HTML'
      );

      expect(result.success).toBe(false);
      expect(result.retryable).toBe(true);
      expect(result.error).toContain('Network connection failed');
      expect(result.imageAvailable).toBe(true);
    });

    it('should handle HTML parse mode correctly', async () => {
      const mockResponse = {
        ok: true,
        result: { message_id: 123 },
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });
      vi.stubGlobal('fetch', mockFetch);

      await client.sendPhoto(
        mockChatId,
        'https://example.com/photo.jpg',
        '<b>Bold caption</b>',
        'HTML'
      );

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"parse_mode":"HTML"'),
        })
      );
    });
  });
});
