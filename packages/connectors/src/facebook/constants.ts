/** Monitored Facebook groups — static config for now */
export const MONITORED_GROUPS: {
  groupId: string;
  name: string;
  defaultCities: string[];
}[] = [
  {
    groupId: '305724686290054',
    name: 'דירות להשכרה בתל אביב',
    defaultCities: ['תל אביב'],
  },
  {
    groupId: '981208559966255',
    name: '[RENTME] דירות להשכרה בתל אביב ללא תיווך',
    defaultCities: ['תל אביב'],
  },
  {
    groupId: '101875683484689',
    name: 'דירות מפה לאוזן בתל אביב',
    defaultCities: ['תל אביב'],
  },
  {
    groupId: '457465901082882',
    name: 'דירות בתל אביב ללא תיווך',
    defaultCities: ['תל אביב'],
  },
  {
    groupId: '253957624766723',
    name: 'דירות להשכרה ברמת גן',
    defaultCities: ['רמת גן'],
  },
  {
    groupId: '402682483445663',
    name: 'דירות להשכרה רמת גן/גבעתיים',
    defaultCities: ['רמת גן', 'גבעתיים'],
  },
  {
    groupId: '1870209196564360',
    name: 'דירות להשכרה רמת גן גבעתיים',
    defaultCities: ['רמת גן', 'גבעתיים'],
  },
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

/** Number of scroll iterations to load more posts from the feed */
export const FEED_SCROLL_COUNT = 5;
/** Delay between scrolls in ms */
export const FEED_SCROLL_DELAY_MS = 3000;

/** Group URL template with chronological sorting */
export const GROUP_URL_TEMPLATE =
  'https://www.facebook.com/groups/{groupId}?sorting_setting=CHRONOLOGICAL';

/**
 * Get monitored group configuration by group ID
 * @param groupId - Facebook group ID
 * @returns Group config if found, undefined otherwise
 */
export function getMonitoredGroup(groupId: string) {
  return MONITORED_GROUPS.find((g) => g.groupId === groupId);
}
