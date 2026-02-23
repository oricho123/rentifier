/**
 * City Name Normalization
 *
 * This module provides a single source of truth for city name normalization.
 * All city names are normalized to Hebrew canonical form for consistency across
 * the system (database storage, filtering, display).
 *
 * Future data sources (Facebook, etc.) should use normalizeCity() to ensure
 * consistent city names regardless of source format.
 */

/**
 * Canonical Hebrew city names used throughout the system.
 * These match YAD2's city codes and are the standard form for storage.
 */
export const CANONICAL_CITY_NAMES = {
  'תל אביב': 'תל אביב',
  'ירושלים': 'ירושלים',
  'חיפה': 'חיפה',
  'הרצליה': 'הרצליה',
  'רמת גן': 'רמת גן',
  'גבעתיים': 'גבעתיים',
  'באר שבע': 'באר שבע',
  'נתניה': 'נתניה',
  'ראשון לציון': 'ראשון לציון',
  'פתח תקווה': 'פתח תקווה',
} as const;

/**
 * All known variants of city names mapped to Hebrew canonical form.
 * Includes Hebrew variants, English variants, and common abbreviations.
 */
export const CITY_VARIANTS: Record<string, string> = {
  // Tel Aviv variants
  'תל אביב': 'תל אביב',
  'תל-אביב': 'תל אביב',
  'ת"א': 'תל אביב',
  'tel aviv': 'תל אביב',
  'tel-aviv': 'תל אביב',
  'tlv': 'תל אביב',

  // Jerusalem variants
  'ירושלים': 'ירושלים',
  'ירושלַיִם': 'ירושלים',
  'jerusalem': 'ירושלים',

  // Haifa variants
  'חיפה': 'חיפה',
  'haifa': 'חיפה',

  // Herzliya variants
  'הרצליה': 'הרצליה',
  'herzliya': 'הרצליה',
  'herzlia': 'הרצליה',

  // Ramat Gan variants
  'רמת גן': 'רמת גן',
  'רמת-גן': 'רמת גן',
  'רמ"ג': 'רמת גן',
  'ramat gan': 'רמת גן',
  'ramat-gan': 'רמת גן',

  // Giv'atayim variants
  'גבעתיים': 'גבעתיים',
  'givatayim': 'גבעתיים',
  'giv\'atayim': 'גבעתיים',

  // Be'er Sheva variants
  'באר שבע': 'באר שבע',
  'באר-שבע': 'באר שבע',
  'ב"ש': 'באר שבע',
  'beer sheva': 'באר שבע',
  'be\'er sheva': 'באר שבע',
  'beersheba': 'באר שבע',

  // Netanya variants
  'נתניה': 'נתניה',
  'netanya': 'נתניה',

  // Rishon LeZion variants
  'ראשון לציון': 'ראשון לציון',
  'ראשון': 'ראשון לציון',
  'ראשל"צ': 'ראשון לציון',
  'rishon lezion': 'ראשון לציון',
  'rishon le zion': 'ראשון לציון',

  // Petah Tikva variants
  'פתח תקווה': 'פתח תקווה',
  'פתח-תקווה': 'פתח תקווה',
  'פת"ח': 'פתח תקווה',
  'petah tikva': 'פתח תקווה',
  'petach tikva': 'פתח תקווה',
  'petah-tikva': 'פתח תקווה',
};

/**
 * Normalize a city name to its Hebrew canonical form.
 *
 * This function handles:
 * - Hebrew variants (with/without hyphens, abbreviations)
 * - English variants (case-insensitive)
 * - Unknown cities (returns null and logs warning)
 *
 * @param input - City name in any recognized variant
 * @returns Hebrew canonical name, or null if not recognized
 *
 * @example
 * normalizeCity('Tel Aviv') → 'תל אביב'
 * normalizeCity('תל-אביב') → 'תל אביב'
 * normalizeCity('Unknown City') → null
 */
export function normalizeCity(input: string | null | undefined): string | null {
  if (!input) return null;

  const trimmedInput = input.trim();
  if (!trimmedInput) return null;

  // Try exact match first (case-sensitive for Hebrew)
  if (CITY_VARIANTS[trimmedInput]) {
    return CITY_VARIANTS[trimmedInput];
  }

  // Try case-insensitive match for English variants
  const lowerInput = trimmedInput.toLowerCase();
  if (CITY_VARIANTS[lowerInput]) {
    return CITY_VARIANTS[lowerInput];
  }

  // Not recognized - log warning and return null
  console.log(JSON.stringify({
    event: 'unknown_city',
    input: trimmedInput,
    message: 'City name not in normalization map - consider adding to CITY_VARIANTS',
  }));

  return null;
}

/**
 * Hebrew neighborhood names by city.
 * Keys are Hebrew canonical city names.
 */
export const CITY_NEIGHBORHOODS: Record<string, Record<string, string>> = {
  'תל אביב': {
    'פלורנטין': 'פלורנטין',
    'florentin': 'פלורנטין',
    'נווה צדק': 'נווה צדק',
    'neve tzedek': 'נווה צדק',
    'הצפון הישן': 'הצפון הישן',
    'old north': 'הצפון הישן',
    'יפו': 'יפו',
    'jaffa': 'יפו',
    'רוטשילד': 'רוטשילד',
    'rothschild': 'רוטשילד',
    'לב העיר': 'לב העיר',
    'city center': 'לב העיר',
  },
  'ירושלים': {
    'נחלאות': 'נחלאות',
    'nachlaot': 'נחלאות',
    'המושבה הגרמנית': 'המושבה הגרמנית',
    'german colony': 'המושבה הגרמנית',
    'רחביה': 'רחביה',
    'rehavia': 'רחביה',
    'בקעה': 'בקעה',
    'baka': 'בקעה',
    'טלביה': 'טלביה',
    'talbiya': 'טלביה',
  },
  'חיפה': {
    'כרמל': 'כרמל',
    'carmel': 'כרמל',
    'הדר': 'הדר',
    'hadar': 'הדר',
    'עיר תחתית': 'עיר תחתית',
    'downtown': 'עיר תחתית',
  },
  'הרצליה': {
    'הרצליה פיתוח': 'הרצליה פיתוח',
    'herzliya pituach': 'הרצליה פיתוח',
  },
  'רמת גן': {
    'בורסה': 'בורסה',
    'bursa': 'בורסה',
  },
};
