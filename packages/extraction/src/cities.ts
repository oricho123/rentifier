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
  'תל אביב יפו': 'תל אביב',
  'ת"א': 'תל אביב',
  'ת״א': 'תל אביב',
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
  "giv'atayim": 'גבעתיים',

  // Be'er Sheva variants
  'באר שבע': 'באר שבע',
  'באר-שבע': 'באר שבע',
  'ב"ש': 'באר שבע',
  'beer sheva': 'באר שבע',
  "be'er sheva": 'באר שבע',
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
  console.log(
    JSON.stringify({
      event: 'unknown_city',
      input: trimmedInput,
      message: 'City name not in normalization map - consider adding to CITY_VARIANTS',
    })
  );

  return null;
}

/**
 * Hebrew neighborhood names by city.
 * Keys are Hebrew canonical city names.
 */
export const CITY_NEIGHBORHOODS: Record<string, Record<string, string>> = {
  'תל אביב': {
    // South
    'פלורנטין': 'פלורנטין',
    'florentin': 'פלורנטין',
    'נווה צדק': 'נווה צדק',
    'neve tzedek': 'נווה צדק',
    'שפירא': 'שפירא',
    'shapira': 'שפירא',
    'שכונת שפירא': 'שפירא',
    'נווה שאנן': 'נווה שאנן',
    'neve shaanan': 'נווה שאנן',
    'התקווה': 'התקווה',
    'שכונת התקווה': 'התקווה',
    'hatikva': 'התקווה',
    'כפר שלם': 'כפר שלם',
    'kfar shalem': 'כפר שלם',
    'קריית שלום': 'קריית שלום',
    'kiryat shalom': 'קריית שלום',
    'נווה עופר': 'נווה עופר',
    'neve ofer': 'נווה עופר',
    'עזרא': 'עזרא',
    'ezra': 'עזרא',
    'שכונת עזרא': 'עזרא',

    // Center
    'לב העיר': 'לב העיר',
    'מרכז העיר': 'לב העיר',
    'לב תל אביב': 'לב העיר',
    'city center': 'לב העיר',
    'רוטשילד': 'רוטשילד',
    'rothschild': 'רוטשילד',
    'כרם התימנים': 'כרם התימנים',
    'kerem hateimanim': 'כרם התימנים',
    'מונטיפיורי': 'מונטיפיורי',
    'montefiore': 'מונטיפיורי',
    'נחלת בנימין': 'נחלת בנימין',
    'nachalat binyamin': 'נחלת בנימין',
    'אלנבי': 'אלנבי',
    'allenby': 'אלנבי',
    'לילינבלום': 'לילינבלום',
    'גן מאיר': 'גן מאיר',
    'gan meir': 'גן מאיר',
    'בוגרשוב': 'בוגרשוב',
    'bugrashov': 'בוגרשוב',
    'דיזנגוף': 'דיזנגוף',
    'דיזינגוף': 'דיזנגוף',
    'dizengoff': 'דיזנגוף',
    'גינדי': 'גינדי',
    'לב יפו': 'לב יפו',
    'נוגה': 'נוגה',
    'noga': 'נוגה',

    // North
    'הצפון הישן': 'הצפון הישן',
    'צפון הישן': 'הצפון הישן',
    'old north': 'הצפון הישן',
    'הצפון החדש': 'הצפון החדש',
    'צפון החדש': 'הצפון החדש',
    'new north': 'הצפון החדש',
    'בבלי': 'בבלי',
    'bavli': 'בבלי',
    'רמת אביב': 'רמת אביב',
    'ramat aviv': 'רמת אביב',
    'אפקה': 'אפקה',
    'afeka': 'אפקה',
    'נווה אביבים': 'נווה אביבים',
    'neve avivim': 'נווה אביבים',
    'כוכב הצפון': 'כוכב הצפון',
    'kochav hatzafon': 'כוכב הצפון',
    'צהלה': 'צהלה',
    'tzahala': 'צהלה',
    'נווה חן': 'נווה חן',
    'neve chen': 'נווה חן',
    'תל ברוך': 'תל ברוך',
    'tel baruch': 'תל ברוך',
    'נווה דן': 'נווה דן',
    'neve dan': 'נווה דן',

    // East
    'יד אליהו': 'יד אליהו',
    'yad eliyahu': 'יד אליהו',
    'הדר יוסף': 'הדר יוסף',
    'hadar yosef': 'הדר יוסף',
    'נחלת יצחק': 'נחלת יצחק',
    'nachalat yitzhak': 'נחלת יצחק',
    'בר כוכבא': 'בר כוכבא',
    'bar kochba': 'בר כוכבא',
    'גבעת הרצל': 'גבעת הרצל',
    'givat herzl': 'גבעת הרצל',
    'ביצרון': 'ביצרון',
    'bitzaron': 'ביצרון',
    'גבעת עמל': 'גבעת עמל',
    'givat amal': 'גבעת עמל',
    'הירשנברג': 'הירשנברג',

    // Jaffa
    'יפו': 'יפו',
    'jaffa': 'יפו',
    'עג\'מי': 'עג\'מי',
    'אג\'מי': 'עג\'מי',
    'ajami': 'עג\'מי',
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
    'קטמון': 'קטמון',
    'katamon': 'קטמון',
    'המושבה היוונית': 'המושבה היוונית',
    'greek colony': 'המושבה היוונית',
    'ארנונה': 'ארנונה',
    'arnona': 'ארנונה',
    'תלפיות': 'תלפיות',
    'talpiot': 'תלפיות',
    'גילה': 'גילה',
    'gilo': 'גילה',
    'פסגת זאב': 'פסגת זאב',
    'pisgat zeev': 'פסגת זאב',
    'רמות': 'רמות',
    'ramot': 'רמות',
    'עין כרם': 'עין כרם',
    'ein kerem': 'עין כרם',
    'מלחה': 'מלחה',
    'malha': 'מלחה',
    'קריית יובל': 'קריית יובל',
    'kiryat yovel': 'קריית יובל',
    'קריית מנחם': 'קריית מנחם',
    'kiryat menachem': 'קריית מנחם',
    'גבעת רם': 'גבעת רם',
    'givat ram': 'גבעת רם',
    'נווה יעקב': 'נווה יעקב',
    'neve yaakov': 'נווה יעקב',
    'מאה שערים': 'מאה שערים',
    'meah shearim': 'מאה שערים',
    'בית הכרם': 'בית הכרם',
    'beit hakerem': 'בית הכרם',
    'הר נוף': 'הר נוף',
    'har nof': 'הר נוף',
    'בית וגן': 'בית וגן',
    'beit vegan': 'בית וגן',
    'גבעת מרדכי': 'גבעת מרדכי',
    'givat mordechai': 'גבעת מרדכי',
    'קריית משה': 'קריית משה',
    'kiryat moshe': 'קריית משה',
    'שמעון הצדיק': 'שמעון הצדיק',
    'מוסררה': 'מוסררה',
    'musrara': 'מוסררה',
    'עיר העתיקה': 'עיר העתיקה',
    'old city': 'עיר העתיקה',
  },
  'חיפה': {
    'כרמל': 'כרמל',
    'carmel': 'כרמל',
    'מרכז הכרמל': 'מרכז הכרמל',
    'merkaz hacarmel': 'מרכז הכרמל',
    'כרמליה': 'כרמליה',
    'carmelia': 'כרמליה',
    'הדר': 'הדר',
    'hadar': 'הדר',
    'עיר תחתית': 'עיר תחתית',
    'downtown': 'עיר תחתית',
    'בת גלים': 'בת גלים',
    'bat galim': 'בת גלים',
    'דניה': 'דניה',
    'denya': 'דניה',
    'danya': 'דניה',
    'אחוזה': 'אחוזה',
    'ahuza': 'אחוזה',
    'נווה שאנן': 'נווה שאנן',
    'neve shaanan haifa': 'נווה שאנן',
    'קריית חיים': 'קריית חיים',
    'kiryat haim': 'קריית חיים',
    'קריית שמואל': 'קריית שמואל',
    'kiryat shmuel': 'קריית שמואל',
    'ואדי ניסנאס': 'ואדי ניסנאס',
    'wadi nisnas': 'ואדי ניסנאס',
    'רמות בן גוריון': 'רמות בן גוריון',
    'קריית אליעזר': 'קריית אליעזר',
    'kiryat eliezer': 'קריית אליעזר',
    'שמבור': 'שמבור',
    'רמת אלמוגי': 'רמת אלמוגי',
    'ramat almogi': 'רמת אלמוגי',
  },
  'הרצליה': {
    'הרצליה פיתוח': 'הרצליה פיתוח',
    'herzliya pituach': 'הרצליה פיתוח',
    'הרצליה הצעירה': 'הרצליה הצעירה',
    'נווה אמירים': 'נווה אמירים',
    'neve amirim': 'נווה אמירים',
    'גליל ים': 'גליל ים',
    'glil yam': 'גליל ים',
    'נווה ישראל': 'נווה ישראל',
  },
  'רמת גן': {
    'בורסה': 'בורסה',
    'bursa': 'בורסה',
    'רמת חן': 'רמת חן',
    'ramat chen': 'רמת חן',
    'נחלת גנים': 'נחלת גנים',
    'nachalat ganim': 'נחלת גנים',
    'גפן': 'גפן',
    'הגפן': 'הגפן',
    'מרום נווה': 'מרום נווה',
    'marom nave': 'מרום נווה',
    'תל בנימין': 'תל בנימין',
    'tel binyamin': 'תל בנימין',
    'קריית קריניצי': 'קריית קריניצי',
    'kiryat krinitzi': 'קריית קריניצי',
    'שיכון ויצמן': 'שיכון ויצמן',
    'shikun weizmann': 'שיכון ויצמן',
    'שיכון ח\'': 'שיכון ח\'',
    'נווה יהושע': 'נווה יהושע',
    'neve yehoshua': 'נווה יהושע',
    'תל יהודה': 'תל יהודה',
    'tel yehuda': 'תל יהודה',
    'רמת עמידר': 'רמת עמידר',
    'ramat amidar': 'רמת עמידר',
    'שיכון ותיקים': 'שיכון ותיקים',
    'shikun vatikim': 'שיכון ותיקים',
    'מרכז העיר': 'מרכז העיר',
    'city center': 'מרכז העיר',
  },
  'גבעתיים': {
    'בורוכוב': 'בורוכוב',
    'borochov': 'בורוכוב',
    'רמת עמידר': 'רמת עמידר',
    'ramat amidar': 'רמת עמידר',
    'שינקין': 'שינקין',
    'גבעת רמב"ם': 'גבעת רמב"ם',
    'givat rambam': 'גבעת רמב"ם',
    'נווה גן': 'נווה גן',
    'neve gan': 'נווה גן',
    'מרכז העיר': 'מרכז העיר',
    'city center': 'מרכז העיר',
  },
  'באר שבע': {
    'עיר העתיקה': 'עיר העתיקה',
    'old city': 'עיר העתיקה',
    'רמות': 'רמות',
    'ramot': 'רמות',
    'נווה זאב': 'נווה זאב',
    'neve zeev': 'נווה זאב',
    'נווה נוי': 'נווה נוי',
    'neve noy': 'נווה נוי',
    'שכונה ד\'': 'שכונה ד\'',
    'נאות לון': 'נאות לון',
    'neot lon': 'נאות לון',
    'נחל עשן': 'נחל עשן',
    'nachal ashan': 'נחל עשן',
    'נחל בקע': 'נחל בקע',
    'nachal beka': 'נחל בקע',
  },
  'נתניה': {
    'עיר ימים': 'עיר ימים',
    'ir yamim': 'עיר ימים',
    'קריית נורדאו': 'קריית נורדאו',
    'kiryat nordau': 'קריית נורדאו',
    'אגם': 'אגם',
    'agam': 'אגם',
    'פולג': 'פולג',
    'poleg': 'פולג',
    'נווה עוז': 'נווה עוז',
    'neve oz': 'נווה עוז',
    'דורה': 'דורה',
    'dora': 'דורה',
    'קריית השרון': 'קריית השרון',
    'kiryat hasharon': 'קריית השרון',
  },
  'ראשון לציון': {
    'נחלת יהודה': 'נחלת יהודה',
    'nachalat yehuda': 'נחלת יהודה',
    'נווה ים': 'נווה ים',
    'neve yam': 'נווה ים',
    'קריית משה': 'קריית משה',
    'kiryat moshe': 'קריית משה',
    'רמת אלון': 'רמת אלון',
    'ramat alon': 'רמת אלון',
    'נאות שקמה': 'נאות שקמה',
    'neot shikma': 'נאות שקמה',
    'מערב': 'מערב',
    'west': 'מערב',
  },
  'פתח תקווה': {
    'כפר גנים': 'כפר גנים',
    'kfar ganim': 'כפר גנים',
    'עין גנים': 'עין גנים',
    'ein ganim': 'עין גנים',
    'אם המושבות': 'אם המושבות',
    'em hamoshavot': 'אם המושבות',
    'נווה עוז': 'נווה עוז',
    'neve oz': 'נווה עוז',
    'קריית מטלון': 'קריית מטלון',
    'kiryat matalon': 'קריית מטלון',
    'הדר גנים': 'הדר גנים',
    'hadar ganim': 'הדר גנים',
  },
};
