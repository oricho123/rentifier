/** Monitored Facebook groups — static config for now */
export const MONITORED_GROUPS: { groupId: string; name: string }[] = [
  { groupId: '305724686290054', name: 'דירות להשכרה בתל אביב' },
  { groupId: '981208559966255', name: '[RENTME] דירות להשכרה בתל אביב ללא תיווך' },
  { groupId: '101875683484689', name: 'דירות מפה לאוזן בתל אביב' },
];

export const MAX_CONSECUTIVE_FAILURES = 5;
export const CIRCUIT_OPEN_DURATION_MS = 30 * 60 * 1000; // 30 minutes
export const MAX_RETRIES = 2;
export const INITIAL_RETRY_DELAY_MS = 2000;
export const REQUEST_TIMEOUT_MS = 30_000;
export const MAX_KNOWN_POST_IDS = 1000;

/** Playwright browser timeouts */
export const BROWSER_TIMEOUT_MS = 30_000;
export const FEED_WAIT_TIMEOUT_MS = 15_000;

/** Group URL template with chronological sorting */
export const GROUP_URL_TEMPLATE =
  'https://www.facebook.com/groups/{groupId}?sorting_setting=CHRONOLOGICAL';
