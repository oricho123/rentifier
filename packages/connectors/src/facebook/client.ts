import {
  MBASIC_BASE_URL,
  MBASIC_HEADERS,
  MAX_RETRIES,
  INITIAL_RETRY_DELAY_MS,
  REQUEST_TIMEOUT_MS,
} from './constants';

export type FacebookErrorType =
  | 'network'
  | 'auth_expired'
  | 'rate_limited'
  | 'banned'
  | 'parse'
  | 'timeout';

export class FacebookClientError extends Error {
  constructor(
    message: string,
    public readonly errorType: FacebookErrorType,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'FacebookClientError';
  }
}

/**
 * Fetch a Facebook group page from mbasic.facebook.com.
 * Returns raw HTML string.
 *
 * SECURITY: cookies are never logged.
 */
export async function fetchGroupPage(
  groupId: string,
  cookies: string,
): Promise<string> {
  const url = `${MBASIC_BASE_URL}/groups/${groupId}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        ...MBASIC_HEADERS,
        Cookie: cookies,
      },
      redirect: 'manual',
      signal: controller.signal,
    });

    // Redirect to login → cookies expired
    const location = response.headers.get('location') || '';
    if (
      response.status === 302 &&
      (location.includes('/login') || location.includes('checkpoint'))
    ) {
      throw new FacebookClientError(
        'Cookies expired — redirected to login',
        'auth_expired',
        false,
      );
    }

    if (response.status === 429) {
      throw new FacebookClientError(
        'Rate limited by Facebook',
        'rate_limited',
        true,
      );
    }

    if (!response.ok && response.status !== 302) {
      throw new FacebookClientError(
        `HTTP ${response.status}: ${response.statusText}`,
        'network',
        response.status >= 500,
      );
    }

    const html = await response.text();

    // Check for login form in HTML body (fallback detection)
    if (
      html.includes('id="login_form"') ||
      html.includes('name="login"') ||
      (html.includes('/login/') && !html.includes('/groups/'))
    ) {
      throw new FacebookClientError(
        'Cookies expired — login form detected in response',
        'auth_expired',
        false,
      );
    }

    // Check for checkpoint/challenge page
    if (
      html.includes('checkpoint') &&
      html.includes('verify')
    ) {
      throw new FacebookClientError(
        'Account checkpoint/challenge detected',
        'banned',
        false,
      );
    }

    return html;
  } catch (error) {
    if (error instanceof FacebookClientError) throw error;

    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new FacebookClientError(
        `Request timed out after ${REQUEST_TIMEOUT_MS}ms`,
        'timeout',
        true,
      );
    }

    throw new FacebookClientError(
      `Network error: ${error instanceof Error ? error.message : String(error)}`,
      'network',
      true,
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Fetch with retry and exponential backoff.
 * SECURITY: groupId is logged, but cookies are NEVER logged.
 */
export async function fetchWithRetry(
  groupId: string,
  cookies: string,
  maxRetries: number = MAX_RETRIES,
): Promise<string> {
  let lastError: FacebookClientError | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        console.log(
          JSON.stringify({
            event: 'fb_retry',
            attempt: attempt + 1,
            maxRetries,
            delayMs: delay,
            groupId,
          }),
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      return await fetchGroupPage(groupId, cookies);
    } catch (error) {
      if (!(error instanceof FacebookClientError)) throw error;

      lastError = error;

      console.log(
        JSON.stringify({
          event: 'fb_fetch_error',
          attempt: attempt + 1,
          maxRetries,
          errorType: error.errorType,
          retryable: error.retryable,
          message: error.message,
          groupId,
        }),
      );

      if (!error.retryable) throw error;
    }
  }

  throw lastError!;
}
