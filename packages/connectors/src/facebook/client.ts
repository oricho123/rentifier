import type { FacebookGraphQLTokens } from './types';
import {
  GRAPHQL_API_URL,
  GRAPHQL_HEADERS,
  GRAPHQL_POST_COUNT,
  GRAPHQL_QUERY_NAME,
  SORTING_MUTATION_DOC_ID,
  SORTING_MUTATION_NAME,
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
  | 'timeout'
  | 'token_expired';

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
 * Compute jazoest checksum from fb_dtsg.
 * Required by Facebook's CSRF validation.
 */
export function computeJazoest(fbDtsg: string): string {
  let sum = 0;
  for (let i = 0; i < fbDtsg.length; i++) {
    sum += fbDtsg.charCodeAt(i);
  }
  return '2' + sum;
}

/**
 * Extract c_user ID from cookie string.
 */
function extractCUser(cookies: string): string {
  const match = cookies.match(/c_user=(\d+)/);
  return match ? match[1] : '';
}

/**
 * Switch a group's feed sorting to CHRONOLOGICAL via Facebook's internal mutation.
 * This must be called before the feed query to ensure posts come back in time order.
 *
 * SECURITY: cookies are never logged.
 */
export async function setSortingChronological(
  groupId: string,
  cookies: string,
  tokens: FacebookGraphQLTokens,
): Promise<void> {
  const cUser = extractCUser(cookies);
  const jazoest = computeJazoest(tokens.fbDtsg);

  const variables = JSON.stringify({
    input: {
      actor_id: cUser,
      client_mutation_id: '1',
      group_id: groupId,
      new_sorting_setting: 'CHRONOLOGICAL',
    },
  });

  const body = new URLSearchParams({
    av: cUser,
    __user: cUser,
    __a: '1',
    __comet_req: '15',
    dpr: '2',
    fb_api_caller_class: 'RelayModern',
    fb_api_req_friendly_name: SORTING_MUTATION_NAME,
    variables,
    doc_id: SORTING_MUTATION_DOC_ID,
    fb_dtsg: tokens.fbDtsg,
    lsd: tokens.lsd,
    jazoest,
    server_timestamps: 'true',
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(GRAPHQL_API_URL, {
      method: 'POST',
      headers: {
        ...GRAPHQL_HEADERS,
        Cookie: cookies,
        Referer: `https://www.facebook.com/groups/${groupId}`,
        'x-fb-friendly-name': SORTING_MUTATION_NAME,
        'x-fb-lsd': tokens.lsd,
      },
      body: body.toString(),
      signal: controller.signal,
    });

    if (!response.ok) {
      console.log(
        JSON.stringify({
          event: 'fb_sorting_mutation_failed',
          status: response.status,
          groupId,
        }),
      );
      // Non-fatal: feed query will still work, just with default sorting
      return;
    }

    console.log(
      JSON.stringify({
        event: 'fb_sorting_set_chronological',
        groupId,
      }),
    );
  } catch (error) {
    // Non-fatal: log and continue with feed query
    console.log(
      JSON.stringify({
        event: 'fb_sorting_mutation_error',
        error: error instanceof Error ? error.message : String(error),
        groupId,
      }),
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Fetch group feed posts via Facebook's internal GraphQL API.
 * Returns raw response text (NDJSON format).
 *
 * SECURITY: cookies are never logged.
 */
export async function fetchGroupGraphQL(
  groupId: string,
  cookies: string,
  tokens: FacebookGraphQLTokens,
): Promise<string> {
  const cUser = extractCUser(cookies);
  const jazoest = computeJazoest(tokens.fbDtsg);

  const variables = JSON.stringify({
    count: GRAPHQL_POST_COUNT,
    feedLocation: 'GROUP',
    feedType: 'DISCUSSION',
    feedbackSource: 0,
    id: groupId,
    renderLocation: 'group',
    scale: 2,
    sortingSetting: 'CHRONOLOGICAL',
    stream_initial_count: 1,
    useDefaultActor: false,
  });

  const body = new URLSearchParams({
    av: cUser,
    __user: cUser,
    __a: '1',
    __comet_req: '15',
    dpr: '2',
    fb_api_caller_class: 'RelayModern',
    fb_api_req_friendly_name: GRAPHQL_QUERY_NAME,
    variables,
    doc_id: tokens.docId,
    fb_dtsg: tokens.fbDtsg,
    lsd: tokens.lsd,
    jazoest,
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(GRAPHQL_API_URL, {
      method: 'POST',
      headers: {
        ...GRAPHQL_HEADERS,
        Cookie: cookies,
        Referer: `https://www.facebook.com/groups/${groupId}`,
        'x-fb-friendly-name': GRAPHQL_QUERY_NAME,
        'x-fb-lsd': tokens.lsd,
      },
      body: body.toString(),
      signal: controller.signal,
    });

    if (response.status === 401 || response.status === 403) {
      throw new FacebookClientError(
        'Authentication failed',
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

    if (!response.ok) {
      throw new FacebookClientError(
        `HTTP ${response.status}: ${response.statusText}`,
        'network',
        response.status >= 500,
      );
    }

    let text = await response.text();

    // Strip Facebook's anti-JSON-hijacking prefix
    text = text.replace(/^for \(;;\);/, '');

    // Check for GraphQL error responses
    try {
      // Try parsing first line for error detection
      const firstLine = text.split('\n')[0];
      const firstJson = JSON.parse(firstLine);

      if (firstJson.error) {
        const errorCode = firstJson.error;
        const errorDesc =
          firstJson.errorDescription || firstJson.errorSummary || '';

        // 1357004 = missing fb_dtsg, 1357054 = invalid tokens
        if (errorCode === 1357004 || errorCode === 1357054) {
          throw new FacebookClientError(
            `GraphQL token error ${errorCode}: ${errorDesc}`,
            'token_expired',
            false,
          );
        }

        throw new FacebookClientError(
          `GraphQL error ${errorCode}: ${errorDesc}`,
          'parse',
          false,
        );
      }
    } catch (e) {
      if (e instanceof FacebookClientError) throw e;
      // Not valid JSON on first line — could be a different format, let parser handle
    }

    return text;
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
  tokens: FacebookGraphQLTokens,
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

      return await fetchGroupGraphQL(groupId, cookies, tokens);
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
