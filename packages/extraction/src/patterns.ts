export const PRICE_PATTERNS: { pattern: RegExp; currency: 'ILS' | 'USD' | 'EUR' }[] = [
  { pattern: /(\d{1,3}(?:,?\d{3})*(?:\.\d+)?)\s*(?:ש״ח|שח|shekel|שקל)/i, currency: 'ILS' },
  { pattern: /(\d{1,3}(?:,?\d{3})*(?:\.\d+)?)\s*₪/, currency: 'ILS' },
  { pattern: /₪\s*(\d+(?:\.\d+)?)/, currency: 'ILS' },
  { pattern: /\$\s*(\d+(?:\.\d+)?)/, currency: 'USD' },
  { pattern: /(\d{1,3}(?:,?\d{3})*(?:\.\d+)?)\s*\$/, currency: 'USD' },
  { pattern: /€\s*(\d+(?:\.\d+)?)/, currency: 'EUR' },
  { pattern: /(\d{1,3}(?:,?\d{3})*(?:\.\d+)?)\s*€/, currency: 'EUR' },
];

export const PERIOD_PATTERNS: { pattern: RegExp; period: 'month' | 'week' | 'day' }[] = [
  { pattern: /לחודש|\/חודש|per\s*month|\/mo(?:nth)?|monthly/i, period: 'month' },
  { pattern: /לשבוע|\/שבוע|per\s*week|\/w(?:ee)?k|weekly/i, period: 'week' },
  { pattern: /ליום|\/יום|per\s*day|\/day|daily/i, period: 'day' },
];

export const BEDROOM_PATTERNS: { pattern: RegExp; extractor: (match: RegExpMatchArray) => number }[] = [
  { pattern: /(\d+(?:\.5)?)\s*(?:חדרים|חדר)/i, extractor: (m) => parseFloat(m[1]) },
  { pattern: /(\d+(?:\.5)?)\s*(?:rooms?|br|bed(?:rooms?)?)/i, extractor: (m) => parseFloat(m[1]) },
  { pattern: /(?:סטודיו|studio)/i, extractor: () => 0 },
];

export const TAG_KEYWORDS: Record<string, string[]> = {
  parking: ['חניה', 'חנייה', 'parking', 'חניון'],
  balcony: ['מרפסת', 'מרפסות', 'balcony', 'balconies'],
  pets: ['חיות', 'pets', 'כלבים', 'חתולים', 'בעלי חיים', 'חיות מותר'],
  furnished: ['מרוהט', 'מרוהטת', 'furnished'],
  immediate: ['מיידי', 'מיידית', 'immediate', 'כניסה מיידית', 'פנוי מיד'],
  'long-term': ['לטווח ארוך', 'long-term', 'long term', 'ארוך טווח'],
  accessible: ['נגיש', 'נגישה', 'accessible', 'נגישות'],
  'air-conditioning': ['מזגן', 'מזגנים', 'ac', 'a/c', 'air-conditioning', 'air conditioning', 'מיזוג', 'מיזוג אוויר'],
};

// Hebrew city names mapped to English canonical names
export const CITY_NAMES: Record<string, string> = {
  'תל אביב': 'Tel Aviv',
  'תל-אביב': 'Tel Aviv',
  'tel aviv': 'Tel Aviv',
  'ירושלים': 'Jerusalem',
  'jerusalem': 'Jerusalem',
  'חיפה': 'Haifa',
  'haifa': 'Haifa',
  'הרצליה': 'Herzliya',
  'herzliya': 'Herzliya',
  'רמת גן': 'Ramat Gan',
  'רמת-גן': 'Ramat Gan',
  'ramat gan': 'Ramat Gan',
  'נתניה': 'Netanya',
  'netanya': 'Netanya',
  'באר שבע': 'Beer Sheva',
  'באר-שבע': 'Beer Sheva',
  'beer sheva': 'Beer Sheva',
};

export const CITY_NEIGHBORHOODS: Record<string, Record<string, string>> = {
  'Tel Aviv': {
    'פלורנטין': 'Florentin',
    'florentin': 'Florentin',
    'נווה צדק': 'Neve Tzedek',
    'neve tzedek': 'Neve Tzedek',
    'הצפון הישן': 'Old North',
    'old north': 'Old North',
    'יפו': 'Jaffa',
    'jaffa': 'Jaffa',
    'רוטשילד': 'Rothschild',
    'rothschild': 'Rothschild',
    'לב העיר': 'City Center',
    'city center': 'City Center',
  },
  'Jerusalem': {
    'נחלאות': 'Nachlaot',
    'nachlaot': 'Nachlaot',
    'המושבה הגרמנית': 'German Colony',
    'german colony': 'German Colony',
    'רחביה': 'Rehavia',
    'rehavia': 'Rehavia',
    'בקעה': 'Baka',
    'baka': 'Baka',
    'טלביה': 'Talbiya',
    'talbiya': 'Talbiya',
  },
  'Haifa': {
    'כרמל': 'Carmel',
    'carmel': 'Carmel',
    'הדר': 'Hadar',
    'hadar': 'Hadar',
    'עיר תחתית': 'Downtown',
    'downtown': 'Downtown',
  },
  'Herzliya': {
    'הרצליה פיתוח': 'Herzliya Pituach',
    'herzliya pituach': 'Herzliya Pituach',
  },
  'Ramat Gan': {
    'בורסה': 'Bursa',
    'bursa': 'Bursa',
  },
};
