import type { Yad2ApiResponse } from './types';
import {
  YAD2_API_BASE,
  YAD2_HEADERS,
  MAX_RETRIES,
  INITIAL_RETRY_DELAY_MS,
  REQUEST_TIMEOUT_MS,
} from './constants';

export class Yad2ApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number | null,
    public readonly errorType: 'network' | 'captcha' | 'http' | 'parse' | 'timeout',
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'Yad2ApiError';
  }
}

export async function fetchYad2Listings(cityCode: number): Promise<Yad2ApiResponse> {
  const url = new URL(YAD2_API_BASE);
  url.searchParams.set('city', String(cityCode));
  url.searchParams.set('priceOnly', '1');
  url.searchParams.set('zoom', '11');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      headers: YAD2_HEADERS,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Yad2ApiError(
        `HTTP ${response.status}: ${response.statusText}`,
        response.status,
        'http',
        response.status >= 500,
      );
    }

    // Read body as text first, then parse
    const text = await response.text();

    // Check for captcha in the raw text
    if (text.includes('Radware Bot Manager Captcha')) {
      throw new Yad2ApiError(
        'Captcha detected in response',
        response.status,
        'captcha',
        false,
      );
    }

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Yad2ApiError(
        'Failed to parse JSON response',
        response.status,
        'parse',
        false,
      );
    }

    // Validate response shape
    const apiResponse = data as Yad2ApiResponse;
    if (!apiResponse?.data?.markers) {
      throw new Yad2ApiError(
        'Invalid API response: missing data.markers',
        response.status,
        'parse',
        false,
      );
    }

    return apiResponse;
  } catch (error) {
    if (error instanceof Yad2ApiError) throw error;

    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Yad2ApiError(
        `Request timed out after ${REQUEST_TIMEOUT_MS}ms`,
        null,
        'timeout',
        true,
      );
    }

    throw new Yad2ApiError(
      `Network error: ${error instanceof Error ? error.message : String(error)}`,
      null,
      'network',
      true,
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function fetchWithRetry(
  cityCode: number,
  maxRetries: number = MAX_RETRIES,
): Promise<Yad2ApiResponse> {
  let lastError: Yad2ApiError | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        console.log(JSON.stringify({
          event: 'yad2_retry',
          attempt: attempt + 1,
          maxRetries,
          delayMs: delay,
          cityCode,
        }));
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      return await fetchYad2Listings(cityCode);
    } catch (error) {
      if (!(error instanceof Yad2ApiError)) throw error;

      lastError = error;

      console.log(JSON.stringify({
        event: 'yad2_fetch_error',
        attempt: attempt + 1,
        maxRetries,
        errorType: error.errorType,
        statusCode: error.statusCode,
        retryable: error.retryable,
        message: error.message,
        cityCode,
      }));

      // Do not retry non-retryable errors (captcha, 4xx, parse)
      if (!error.retryable) throw error;
    }
  }

  throw lastError!;
}
