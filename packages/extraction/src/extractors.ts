import { PriceResult, LocationResult, ExtractionResult } from './types';
import { PRICE_PATTERNS, PERIOD_PATTERNS, BEDROOM_PATTERNS, TAG_KEYWORDS, CITY_NAMES, CITY_NEIGHBORHOODS, STREET_PATTERNS, SEARCH_POST_PATTERNS, SALE_POST_PATTERNS, SERVICE_AD_PATTERNS } from './patterns';

export function extractPrice(text: string): PriceResult | null {
  for (const { pattern, currency } of PRICE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const amount = parseFloat(match[1].replace(/,/g, ''));
      if (isNaN(amount) || amount <= 0) continue;

      // Detect period
      let period: 'month' | 'week' | 'day' = 'month'; // default
      let confidence = 0.7; // default confidence without explicit period
      for (const { pattern: periodPattern, period: p } of PERIOD_PATTERNS) {
        if (periodPattern.test(text)) {
          period = p;
          confidence = 0.9;
          break;
        }
      }

      return { amount, currency, period, confidence };
    }
  }
  return null;
}

export function extractBedrooms(text: string): number | null {
  for (const { pattern, extractor } of BEDROOM_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      return extractor(match);
    }
  }
  return null;
}

// Hebrew negation prefixes that negate the following keyword
const NEGATION_PATTERNS = ['בלי ', 'ללא ', 'אין ', 'without '];

export function extractTags(text: string): string[] {
  const found: string[] = [];
  const lowerText = text.toLowerCase();

  for (const [tag, keywords] of Object.entries(TAG_KEYWORDS)) {
    let matched = false;
    for (const keyword of keywords) {
      const idx = text.indexOf(keyword);
      const idxLower = idx === -1 ? lowerText.indexOf(keyword.toLowerCase()) : idx;
      if (idxLower !== -1) {
        // Check for negation before the keyword
        const prefix = text.slice(Math.max(0, idxLower - 5), idxLower);
        const negated = NEGATION_PATTERNS.some((neg) => prefix.includes(neg.trim()));
        if (!negated) {
          matched = true;
          break;
        }
      }
    }
    if (matched) found.push(tag);
  }

  return found;
}

/**
 * First words of known two-word Hebrew street names.
 * Only keep the second captured word if the first word is one of these.
 * e.g., "בן יהודה", "נחלת בנימין", "קרית ספר", "אבן גבירול"
 */
const TWO_WORD_STREET_PREFIXES = ['בן', 'נחלת', 'קרית', 'אבן', 'בר', 'הרב', 'שדרות'];

export function extractStreet(text: string): string | null {
  for (const pattern of STREET_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const street = match[1].trim();
      const words = street.split(/\s+/);
      // Only keep second word if first word is a known two-word street prefix
      // (e.g., "בן יהודה" → keep both, "אברבנאל בפלורנטין" → keep only first)
      if (words.length === 2 && !TWO_WORD_STREET_PREFIXES.includes(words[0])) {
        return words[0];
      }
      return street;
    }
  }
  return null;
}

/**
 * Common Hebrew prepositions that are attached to words as prefixes.
 * These are allowed before a match: ב (in), ה (the), ו (and), כ (like), ל (to), מ (from), ש (that)
 */
const HEBREW_PREPOSITIONS = ['ב', 'ה', 'ו', 'כ', 'ל', 'מ', 'ש'];

/**
 * Check if characters before and after a match position are word boundaries.
 * A boundary before the match is:
 * - Start of string, OR
 * - Non-letter character, OR
 * - Single-letter Hebrew preposition (ב, ה, ו, כ, ל, מ, ש) that's preceded by a boundary
 *
 * A boundary after the match is:
 * - End of string, OR
 * - Non-letter character
 */
function checkBoundaries(text: string, idx: number, len: number): boolean {
  // Check character before match
  if (idx > 0) {
    const charBefore = text[idx - 1];

    // If it's a letter, check if it's a single-character Hebrew preposition
    if (/\p{L}/u.test(charBefore)) {
      // Check if it's a Hebrew preposition
      if (HEBREW_PREPOSITIONS.includes(charBefore)) {
        // The preposition itself must be at a word boundary
        // Check what comes before the preposition
        if (idx > 1) {
          const charBeforePrep = text[idx - 2];
          if (/\p{L}/u.test(charBeforePrep)) {
            // Another letter before the preposition - not a valid boundary
            return false;
          }
        }
        // Preposition is at start or after non-letter - valid boundary
      } else {
        // It's a letter but not a preposition - not a valid boundary
        return false;
      }
    }
  }

  // Check character after match
  const endIdx = idx + len;
  if (endIdx < text.length) {
    const charAfter = text[endIdx];
    if (/\p{L}/u.test(charAfter)) {
      return false;
    }
  }

  return true;
}

/**
 * Find word in text with word boundary checking.
 * Tries case-sensitive match first, then case-insensitive for English text.
 */
function includesWord(text: string, word: string): boolean {
  // Try case-sensitive match first
  let idx = text.indexOf(word);
  while (idx !== -1) {
    if (checkBoundaries(text, idx, word.length)) {
      return true;
    }
    idx = text.indexOf(word, idx + 1);
  }

  // Try case-insensitive match for English
  const lowerText = text.toLowerCase();
  const lowerWord = word.toLowerCase();
  if (lowerWord !== word) {
    idx = lowerText.indexOf(lowerWord);
    while (idx !== -1) {
      if (checkBoundaries(text, idx, lowerWord.length)) {
        return true;
      }
      idx = lowerText.indexOf(lowerWord, idx + 1);
    }
  }

  return false;
}

/**
 * Match a neighborhood within a specific city using word boundary checking.
 * @param text - The text to search in
 * @param city - The canonical city name (Hebrew)
 * @returns The canonical neighborhood name if found, null otherwise
 */
export function matchNeighborhoodInCity(text: string, city: string): string | null {
  const neighborhoods = CITY_NEIGHBORHOODS[city];
  if (!neighborhoods) return null;

  for (const [variant, canonical] of Object.entries(neighborhoods)) {
    if (includesWord(text, variant)) {
      return canonical;
    }
  }
  return null;
}

export function extractLocation(text: string): LocationResult | null {
  let matchedCity: string | null = null;
  let matchedNeighborhood: string | null = null;
  let confidence = 0;

  // Try to match city
  for (const [variant, canonical] of Object.entries(CITY_NAMES)) {
    if (includesWord(text, variant)) {
      matchedCity = canonical;
      confidence = 0.8;
      break;
    }
  }

  // Try to match neighborhood (in all cities if no city matched yet)
  if (matchedCity) {
    const neighborhoods = CITY_NEIGHBORHOODS[matchedCity];
    if (neighborhoods) {
      for (const [variant, canonical] of Object.entries(neighborhoods)) {
        if (includesWord(text, variant)) {
          matchedNeighborhood = canonical;
          confidence = 0.9;
          break;
        }
      }
    }
  } else {
    // Reverse lookup: try all neighborhoods to infer city
    for (const [city, neighborhoods] of Object.entries(CITY_NEIGHBORHOODS)) {
      for (const [variant, canonical] of Object.entries(neighborhoods)) {
        if (includesWord(text, variant)) {
          matchedCity = city;
          matchedNeighborhood = canonical;
          confidence = 0.85;
          break;
        }
      }
      if (matchedCity) break;
    }
  }

  if (!matchedCity) return null;

  return {
    city: matchedCity,
    neighborhood: matchedNeighborhood,
    confidence,
  };
}

export function isSearchPost(text: string): boolean {
  return SEARCH_POST_PATTERNS.some((pattern) => pattern.test(text));
}

export function isSalePost(text: string): boolean {
  return SALE_POST_PATTERNS.some((pattern) => pattern.test(text));
}

export function isServiceAd(text: string): boolean {
  return SERVICE_AD_PATTERNS.some((pattern) => pattern.test(text));
}

/** Unified check: returns true if text is not a rental listing (search, sale, or service ad). */
export function isNonRentalPost(text: string): boolean {
  return isSearchPost(text) || isSalePost(text) || isServiceAd(text);
}

export function extractAll(title: string, description: string): ExtractionResult {
  const combinedText = `${title} ${description}`;

  const price = extractPrice(combinedText);
  const bedrooms = extractBedrooms(combinedText);
  const street = extractStreet(combinedText);
  const tags = extractTags(combinedText);
  const location = extractLocation(combinedText);
  const nonRental = isNonRentalPost(combinedText);

  // Weighted field coverage confidence
  // Each field contributes based on its importance for filter matching
  let overallConfidence = 0;
  if (price) overallConfidence += 0.30 * price.confidence;           // 0.21 or 0.27
  if (location) overallConfidence += 0.25 * location.confidence;     // 0.20, 0.21, or 0.225
  if (bedrooms !== null) overallConfidence += 0.20;
  if (location?.neighborhood) overallConfidence += 0.10;
  if (street) overallConfidence += 0.05;
  if (tags.length > 0) overallConfidence += 0.05;
  if (!nonRental) overallConfidence += 0.05;
  // Round to 2 decimal places to avoid floating point noise
  overallConfidence = Math.round(overallConfidence * 100) / 100;

  return {
    price,
    bedrooms,
    street,
    tags,
    location,
    isNonRental: nonRental,
    overallConfidence,
    floor: null,
    squareMeters: null,
    entryDate: null,
  };
}
