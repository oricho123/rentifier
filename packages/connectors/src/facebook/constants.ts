export const MBASIC_BASE_URL = 'https://mbasic.facebook.com';

export const MBASIC_HEADERS: Record<string, string> = {
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'User-Agent':
    'Mozilla/5.0 (Linux; Android 10; SM-G960F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
};

/** Monitored Facebook groups — static config for now */
export const MONITORED_GROUPS: { groupId: string; name: string }[] = [
  // Add your groups here:
  // { groupId: '123456789', name: 'דירות להשכרה תל אביב' },
];

export const MAX_CONSECUTIVE_FAILURES = 5;
export const CIRCUIT_OPEN_DURATION_MS = 30 * 60 * 1000; // 30 minutes
export const MAX_RETRIES = 2;
export const INITIAL_RETRY_DELAY_MS = 2000;
export const REQUEST_TIMEOUT_MS = 10_000;
export const MAX_KNOWN_POST_IDS = 1000;
