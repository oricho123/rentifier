export const PRICE_PATTERNS: { pattern: RegExp; currency: 'ILS' | 'USD' | 'EUR' }[] = [
  { pattern: /(\d{1,3}(?:,?\d{3})*(?:\.\d+)?)\s*(?:שח|ש[״׳'"""]ח|shekel|שקל)/i, currency: 'ILS' },
  { pattern: /(\d{1,3}(?:,?\d{3})*(?:\.\d+)?)\s*₪/, currency: 'ILS' },
  { pattern: /₪\s*(\d+(?:\.\d+)?)/, currency: 'ILS' },
  // "מחיר" / "שכירות" / "שכ'ד" (שכר דירה) prefix implies ILS
  { pattern: /מחיר\s*[-–:]?\s*(\d+(?:,\d{3})*(?:\.\d+)?)/, currency: 'ILS' },
  { pattern: /שכירות\s*[-–:]?\s*(\d+(?:,\d{3})*(?:\.\d+)?)/, currency: 'ILS' },
  { pattern: /שכ[״׳'"]?ד\s*[-–:]?\s*(\d+(?:,\d{3})*(?:\.\d+)?)/, currency: 'ILS' },
  // "ב" prefix + number in rental range (e.g., "ב7,600", "ב-4,500")
  { pattern: /ב[-–]?(\d{1,3}(?:,\d{3})+)(?!\d)/, currency: 'ILS' },
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
  { pattern: /(\d+(?:\.5)?)\s*(?:ח[׳']|חד[׳']?)/i, extractor: (m) => parseFloat(m[1]) },
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
  'elevator': ['מעלית', 'elevator'],
  'storage': ['מחסן', 'storage'],
  'renovated': ['משופצת', 'משופץ', 'שיפוץ', 'renovated'],
};

export const STREET_PATTERNS: RegExp[] = [
  // Match "ברחוב X", "ברח' X", "רחוב X"
  // Capture 1-2 Hebrew words (Israeli streets are 1-2 words: הרצל, בן יהודה, נחלת בנימין)
  // Each word is 2-10 Hebrew chars (prevents capturing run-together Facebook text)
  /ברחוב\s+([\u0590-\u05FF]{2,10}(?:\s[\u0590-\u05FF]{2,10})?)/,
  /ברח[׳'"]\s+([\u0590-\u05FF]{2,10}(?:\s[\u0590-\u05FF]{2,10})?)/,
  /רחוב\s+([\u0590-\u05FF]{2,10}(?:\s[\u0590-\u05FF]{2,10})?)/,
];

/** Patterns indicating a "wanted/searching" post, not a rental listing.
 * Only match when the keyword appears near the start of the text (first 50 chars)
 * to avoid false positives from CTAs like "מחפשים דירה אחרת?" at the end of listings. */
export const SEARCH_POST_PATTERNS: RegExp[] = [
  /^[\s\S]{0,50}מחפש(?:ת|ים|ות)?\s+(?:דירה|דירת|חדר|סטודיו|סאבלט)/,
  /^[\s\S]{0,50}מחפש(?:ת|ים|ות)?\s+(?:שותף|שותפה|מחליף|מחליפה)/,
  /^[\s\S]{0,50}looking\s+for\s+(?:an?\s+)?(?:apartment|room|flat|studio)/i,
];

// Import city normalization data from centralized module
// All city names now normalize to Hebrew canonical form
import { CITY_VARIANTS, CITY_NEIGHBORHOODS } from './cities';

// Re-export for backward compatibility with extractors.ts
export const CITY_NAMES = CITY_VARIANTS;
export { CITY_NEIGHBORHOODS };
