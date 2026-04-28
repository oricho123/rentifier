/**
 * Helpers for aligning provider output to the canonical Hebrew neighborhood
 * vocabulary used by filters (`CITY_NEIGHBORHOODS` in @rentifier/extraction).
 *
 * The spike uses these helpers to compute the "canonical-name alignment" metric:
 *   % of resolver hits whose raw provider output is already a key in CITY_NEIGHBORHOODS
 *   (i.e., no manual alias work needed before the name is usable in a user filter).
 */

import { CITY_NEIGHBORHOODS, normalizeCity } from '../../packages/extraction/src/cities';

/**
 * Try to align a raw neighborhood name returned by an external provider
 * to a canonical Hebrew name in CITY_NEIGHBORHOODS[city].
 *
 * Returns the canonical name if the variant map already knows this string
 * (under the normalized city). Returns null if the name is unknown — the
 * spike counts these as "hit_unknown".
 *
 * The check is intentionally conservative: we do NOT fuzzy-match. Fuzzy
 * matching is a deliberate later design decision (alias-learning layer);
 * what the spike measures is whether the raw output Just Works.
 */
export function alignToCanonical(
  rawName: string | null | undefined,
  rawCity: string | null | undefined,
): string | null {
  if (!rawName) return null;
  const canonicalCity = normalizeCity(rawCity ?? null);
  if (!canonicalCity) return null;
  const variants = CITY_NEIGHBORHOODS[canonicalCity];
  if (!variants) return null;

  const trimmed = rawName.trim();
  if (variants[trimmed]) return variants[trimmed];

  const lower = trimmed.toLowerCase();
  if (variants[lower]) return variants[lower];

  return null;
}
