import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchYad2Listings, fetchWithRetry, Yad2ApiError } from '../client';

function createMockResponse(markers: any[] = [], status = 200): Response {
  return new Response(JSON.stringify({ data: { markers } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('fetchYad2Listings', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should return valid response on success', async () => {
    const mockMarkers = [
      { orderId: 'test-1', price: 5000 },
      { orderId: 'test-2', price: 6000 },
    ];

    global.fetch = vi.fn().mockResolvedValue(createMockResponse(mockMarkers));

    const result = await fetchYad2Listings(5000);

    expect(result).toEqual({
      data: {
        markers: mockMarkers,
      },
    });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('city=5000'),
      expect.any(Object)
    );
  });

  it('should throw retryable Yad2ApiError on HTTP 500', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response('Internal Server Error', { status: 500, statusText: 'Internal Server Error' })
    );

    await expect(fetchYad2Listings(5000)).rejects.toMatchObject({
      name: 'Yad2ApiError',
      statusCode: 500,
      errorType: 'http',
      retryable: true,
    });
  });

  it('should throw non-retryable Yad2ApiError on HTTP 403', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response('Forbidden', { status: 403, statusText: 'Forbidden' })
    );

    await expect(fetchYad2Listings(5000)).rejects.toMatchObject({
      name: 'Yad2ApiError',
      statusCode: 403,
      errorType: 'http',
      retryable: false,
    });
  });

  it('should throw non-retryable Yad2ApiError on captcha detection', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response('Radware Bot Manager Captcha detected', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      })
    );

    await expect(fetchYad2Listings(5000)).rejects.toMatchObject({
      name: 'Yad2ApiError',
      errorType: 'captcha',
      retryable: false,
    });
  });

  it('should throw retryable Yad2ApiError on network error', async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError('Network request failed'));

    await expect(fetchYad2Listings(5000)).rejects.toMatchObject({
      name: 'Yad2ApiError',
      errorType: 'network',
      retryable: true,
    });
  });
});

describe('fetchWithRetry', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    vi.useFakeTimers();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
  });

  it('should succeed after transient failure', async () => {
    let callCount = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(
          new Response('Internal Server Error', { status: 500, statusText: 'Internal Server Error' })
        );
      }
      return Promise.resolve(createMockResponse([{ orderId: 'test-1' }]));
    });

    const promise = fetchWithRetry(5000, 3);

    // Advance timers to trigger retry
    await vi.runAllTimersAsync();

    const result = await promise;

    expect(result.data.markers).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('should not retry on captcha error', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response('Radware Bot Manager Captcha detected', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      })
    );

    await expect(fetchWithRetry(5000, 3)).rejects.toMatchObject({
      errorType: 'captcha',
      retryable: false,
    });

    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
