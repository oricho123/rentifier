import { PriceResult, LocationResult, ExtractionResult } from './types';
import { PRICE_PATTERNS, PERIOD_PATTERNS, BEDROOM_PATTERNS, TAG_KEYWORDS, CITY_NAMES, CITY_NEIGHBORHOODS, STREET_PATTERNS, SEARCH_POST_PATTERNS } from './patterns';

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

export function extractTags(text: string): string[] {
  const found: string[] = [];
  const lowerText = text.toLowerCase();

  for (const [tag, keywords] of Object.entries(TAG_KEYWORDS)) {
    for (const keyword of keywords) {
      if (text.includes(keyword) || lowerText.includes(keyword.toLowerCase())) {
        found.push(tag);
        break; // Only add each tag once
      }
    }
  }

  return found;
}

export function extractStreet(text: string): string | null {
  for (const pattern of STREET_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }
  return null;
}

export function extractLocation(text: string): LocationResult | null {
  const lowerText = text.toLowerCase();
  let matchedCity: string | null = null;
  let matchedNeighborhood: string | null = null;
  let confidence = 0;

  // Try to match city
  for (const [variant, canonical] of Object.entries(CITY_NAMES)) {
    if (text.includes(variant) || lowerText.includes(variant.toLowerCase())) {
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
        if (text.includes(variant) || lowerText.includes(variant.toLowerCase())) {
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
        if (text.includes(variant) || lowerText.includes(variant.toLowerCase())) {
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

export function extractAll(title: string, description: string): ExtractionResult {
  const combinedText = `${title} ${description}`;

  const price = extractPrice(combinedText);
  const bedrooms = extractBedrooms(combinedText);
  const street = extractStreet(combinedText);
  const tags = extractTags(combinedText);
  const location = extractLocation(combinedText);
  const searchPost = isSearchPost(combinedText);

  // Overall confidence is the minimum of all sub-confidences
  const confidences: number[] = [];
  if (price) confidences.push(price.confidence);
  if (location) confidences.push(location.confidence);
  // bedrooms and tags don't have confidence scores — they're binary

  const overallConfidence = confidences.length > 0
    ? Math.min(...confidences)
    : 0;

  return {
    price,
    bedrooms,
    street,
    tags,
    location,
    isSearchPost: searchPost,
    overallConfidence,
  };
}
