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

// Import city normalization data from centralized module
// All city names now normalize to Hebrew canonical form
import { CITY_VARIANTS, CITY_NEIGHBORHOODS } from './cities';

// Re-export for backward compatibility with extractors.ts
export const CITY_NAMES = CITY_VARIANTS;
export { CITY_NEIGHBORHOODS };
