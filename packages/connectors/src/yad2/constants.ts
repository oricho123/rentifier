// Active endpoint — confirmed rental map API.
// Alternative endpoints to try if this gets blocked:
//   https://gw.yad2.co.il/feed/realestate/rent
//   https://gw.yad2.co.il/realestate-feed/forrent/map
export const YAD2_API_BASE = 'https://gw.yad2.co.il/realestate-feed/rent/map';

export const YAD2_HEADERS: Record<string, string> = {
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'he,en-US;q=0.9,en;q=0.7',
  'Origin': 'https://www.yad2.co.il',
  'Referer': 'https://www.yad2.co.il/',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-site',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
  // Chrome client hints — must match User-Agent platform
  'sec-ch-ua': '"Chromium";v="137", "Not/A)Brand";v="24", "Google Chrome";v="137"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
};

/** Yad2 city codes for rental listings */
export const YAD2_CITY_CODES: Record<string, number> = {
  'תל אביב': 5000,
  'ירושלים': 3000,
  'חיפה': 4000,
  'הרצליה': 6400,
  'רמת גן': 8600,
  'גבעתיים': 6300,
  'באר שבע': 7900,
  'נתניה': 7400,
  'ראשון לציון': 8300,
  'פתח תקווה': 7900,
};

export const MAX_CONSECUTIVE_FAILURES = 5;
export const CIRCUIT_OPEN_DURATION_MS = 30 * 60 * 1000; // 30 minutes
export const MAX_RETRIES = 3;
export const INITIAL_RETRY_DELAY_MS = 1000;
export const REQUEST_TIMEOUT_MS = 10_000;
export const MAX_KNOWN_ORDER_IDS = 500;
