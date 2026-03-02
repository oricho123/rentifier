export const GRAPHQL_API_URL = 'https://www.facebook.com/api/graphql/';

export const GRAPHQL_HEADERS: Record<string, string> = {
  'Content-Type': 'application/x-www-form-urlencoded',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Origin: 'https://www.facebook.com',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
};

/** Monitored Facebook groups — static config for now */
export const MONITORED_GROUPS: { groupId: string; name: string }[] = [
  // Add your groups here:
  { groupId: '305724686290054', name: 'דירות להשכרה בתל אביב' },
];

export const MAX_CONSECUTIVE_FAILURES = 5;
export const CIRCUIT_OPEN_DURATION_MS = 30 * 60 * 1000; // 30 minutes
export const MAX_RETRIES = 2;
export const INITIAL_RETRY_DELAY_MS = 2000;
export const REQUEST_TIMEOUT_MS = 30_000; // GraphQL responses can be large
export const MAX_KNOWN_POST_IDS = 1000;

/** Number of posts to request per GraphQL query */
export const GRAPHQL_POST_COUNT = 10;

/** GraphQL query name used by Facebook's group feed */
export const GRAPHQL_QUERY_NAME =
  'GroupsCometFeedRegularStoriesPaginationQuery';
