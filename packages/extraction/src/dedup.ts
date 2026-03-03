export interface DedupFields {
  street: string | null;
  house_number: string | null;
  neighborhood: string | null;
  latitude: number | null;
  longitude: number | null;
  price: number | null;
}

export const DEDUP_THRESHOLD = 2.0;

/**
 * Normalize street name for comparison.
 * Strips Hebrew prefix words (רחוב, רח', ברחוב, ברח'), trims, lowercases.
 */
export function normalizeStreet(street: string): string {
  return street
    .trim()
    .replace(/^(ברחוב|ברח[׳'"]?\s*|רחוב|רח[׳'"]?\s*)/u, '')
    .trim()
    .toLowerCase();
}

/**
 * Flat-earth distance approximation in meters.
 * Valid for short distances at Israel's latitude (~32°N).
 */
export function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dlat = (lat2 - lat1) * 111320;
  const dlon = (lon2 - lon1) * 111320 * Math.cos(lat1 * Math.PI / 180);
  return Math.sqrt(dlat * dlat + dlon * dlon);
}

/**
 * Score how likely two listings are the same physical apartment.
 * Higher score = more likely duplicate. Threshold is DEDUP_THRESHOLD (2.0).
 *
 * Scoring:
 * - Same street + same house_number: 3.0
 * - Same street, missing house_number: 1.5
 * - Same neighborhood + price within 5%: 1.5
 * - Same neighborhood only: 0.5
 * - Coordinates within 50m: 2.0
 * - Price within 3%: 0.5 bonus
 */
export function matchScore(a: DedupFields, b: DedupFields): number {
  let score = 0;

  // Street matching
  if (a.street && b.street) {
    const streetA = normalizeStreet(a.street);
    const streetB = normalizeStreet(b.street);
    if (streetA === streetB) {
      if (a.house_number && b.house_number && a.house_number === b.house_number) {
        score += 3.0;
      } else if (!a.house_number || !b.house_number) {
        score += 1.5;
      }
      // If both have house_number but they differ, no street score (different apartments)
    }
  }

  // Neighborhood matching
  if (a.neighborhood && b.neighborhood && a.neighborhood === b.neighborhood) {
    if (a.price != null && b.price != null && b.price > 0) {
      const priceDiff = Math.abs(a.price - b.price) / Math.max(a.price, b.price);
      if (priceDiff <= 0.05) {
        score += 1.5; // neighborhood + tight price
      } else {
        score += 0.5; // neighborhood only
      }
    } else {
      score += 0.5; // neighborhood only (no price to compare)
    }
  }

  // Coordinate matching
  if (a.latitude != null && a.longitude != null && b.latitude != null && b.longitude != null) {
    const dist = distanceMeters(a.latitude, a.longitude, b.latitude, b.longitude);
    if (dist <= 50) {
      score += 2.0;
    }
  }

  // Price bonus (only applies when there's already some match)
  if (score > 0 && a.price != null && b.price != null && b.price > 0) {
    const priceDiff = Math.abs(a.price - b.price) / Math.max(a.price, b.price);
    if (priceDiff < 0.03) {
      score += 0.5;
    }
  }

  return score;
}
