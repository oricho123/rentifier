/**
 * NominatimResolver — reverse/forward geocoding with D1 write-through cache.
 *
 * Design: .specs/features/neighborhood-extraction-coverage/design.md §3
 * Decision: AD-029 (Nominatim + D1 cache chosen over OSM polygons)
 */

import { CITY_NEIGHBORHOODS, normalizeCity } from './cities';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type NeighborhoodSource =
  | 'regex'
  | 'ai'
  | 'coords_cache'
  | 'coords_live'
  | 'street_cache'
  | 'street_live';

export interface ResolvedNeighborhood {
  neighborhood: string;
  source: NeighborhoodSource;
}

/** Thin abstraction over the D1 neighborhood_cache table. */
export interface NeighborhoodCache {
  get(cacheKey: string): Promise<{ rawName: string | null; canonicalName: string | null } | null>;
  set(
    cacheKey: string,
    cacheType: 'coords' | 'street',
    rawName: string | null,
    canonicalName: string | null,
    provider: string,
  ): Promise<void>;
}

export interface NominatimConfig {
  userAgent: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export interface ResolveNeighborhoodOptions {
  city: string | null;
  latitude?: number | null;
  longitude?: number | null;
  street?: string | null;
  cache: NeighborhoodCache;
  config: NominatimConfig;
  /** Remaining external-call budget; mutated in place. */
  budget: { remaining: number };
}

// ---------------------------------------------------------------------------
// Cache-key helpers
// ---------------------------------------------------------------------------

/** Rounds to 4 decimal places (~11 m precision) to group nearby coords. */
export function buildCoordsKey(lat: number, lng: number): string {
  return `c:${lat.toFixed(4)}:${lng.toFixed(4)}`;
}

const STREET_PREFIXES = [
  'רחוב ',
  "רח' ",
  'שדרות ',
  "שד' ",
  'דרך ',
  'סמטת ',
  'כיכר ',
];

export function normalizeStreetPrefix(street: string): string {
  const trimmed = street.trim();
  for (const prefix of STREET_PREFIXES) {
    if (trimmed.startsWith(prefix)) {
      return trimmed.slice(prefix.length).trim();
    }
  }
  return trimmed;
}

export function buildStreetKey(city: string, street: string): string {
  return `s:${city}:${normalizeStreetPrefix(street)}`;
}

// ---------------------------------------------------------------------------
// Canonical-name alignment (mirrors spike's canonical.ts logic)
// ---------------------------------------------------------------------------

/**
 * Maps a raw geocoder name to a canonical name from CITY_NEIGHBORHOODS.
 * Returns null if the name is not yet in the vocabulary — caller logs alias candidates.
 */
export function alignToCanonical(rawName: string, rawCity: string): string | null {
  const canonicalCity = normalizeCity(rawCity);
  if (!canonicalCity) return null;
  const variants = CITY_NEIGHBORHOODS[canonicalCity];
  if (!variants) return null;

  const trimmed = rawName.trim();
  if (variants[trimmed]) return variants[trimmed];

  const lower = trimmed.toLowerCase();
  if (variants[lower]) return variants[lower];

  return null;
}

// ---------------------------------------------------------------------------
// Nominatim HTTP helpers (internal)
// ---------------------------------------------------------------------------

interface NominatimAddress {
  neighbourhood?: string;
  suburb?: string;
  quarter?: string;
  city_district?: string;
}

interface NominatimReverseResult {
  address?: NominatimAddress;
}

interface NominatimSearchResult {
  address?: NominatimAddress;
}

function extractNeighbourhoodName(addr: NominatimAddress | undefined): string | null {
  if (!addr) return null;
  return addr.neighbourhood ?? addr.suburb ?? addr.quarter ?? addr.city_district ?? null;
}

async function callNominatimReverse(
  lat: number,
  lng: number,
  config: NominatimConfig,
): Promise<{ rawName: string | null; rateLimited: boolean }> {
  const baseUrl = config.baseUrl ?? 'https://nominatim.openstreetmap.org';
  const url = `${baseUrl}/reverse?format=json&lat=${lat}&lon=${lng}&zoom=16&addressdetails=1`;
  const timeoutMs = config.timeoutMs ?? 10_000;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': config.userAgent },
    }).finally(() => clearTimeout(timer));

    if (resp.status === 429) return { rawName: null, rateLimited: true };
    if (!resp.ok) return { rawName: null, rateLimited: false };

    const data = (await resp.json()) as NominatimReverseResult;
    return { rawName: extractNeighbourhoodName(data.address), rateLimited: false };
  } catch {
    return { rawName: null, rateLimited: false };
  }
}

async function callNominatimForward(
  q: string,
  config: NominatimConfig,
): Promise<{ rawName: string | null; rateLimited: boolean }> {
  const baseUrl = config.baseUrl ?? 'https://nominatim.openstreetmap.org';
  const url = `${baseUrl}/search?format=jsonv2&q=${encodeURIComponent(q)}&addressdetails=1&limit=1`;
  const timeoutMs = config.timeoutMs ?? 10_000;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': config.userAgent },
    }).finally(() => clearTimeout(timer));

    if (resp.status === 429) return { rawName: null, rateLimited: true };
    if (!resp.ok) return { rawName: null, rateLimited: false };

    const data = (await resp.json()) as NominatimSearchResult[];
    return { rawName: extractNeighbourhoodName(data[0]?.address), rateLimited: false };
  } catch {
    return { rawName: null, rateLimited: false };
  }
}

// ---------------------------------------------------------------------------
// Main exported function
// ---------------------------------------------------------------------------

/**
 * Resolves a canonical neighborhood name for a listing.
 *
 * Resolution order: coords → street. For each path:
 *   1. Cache lookup — if hit, return immediately (no budget consumed).
 *   2. Cache miss — call Nominatim if budget > 0.
 *   3. Normalize raw name to CITY_NEIGHBORHOODS canonical.
 *   4. Write result to cache (including negative results to avoid re-calling).
 *
 * Returns null if no neighborhood can be resolved.
 */
export async function resolveNeighborhood(
  opts: ResolveNeighborhoodOptions,
): Promise<ResolvedNeighborhood | null> {
  const { city, latitude, longitude, street, cache, config, budget } = opts;

  if (!city) return null;

  const PROVIDER = 'nominatim';

  // --- Coords path ---
  const validCoords =
    latitude != null &&
    longitude != null &&
    !(latitude === 0 && longitude === 0);

  if (validCoords) {
    const cacheKey = buildCoordsKey(latitude!, longitude!);
    const cached = await cache.get(cacheKey);

    if (cached !== null) {
      if (cached.canonicalName) {
        return { neighborhood: cached.canonicalName, source: 'coords_cache' };
      }
      // Negative cache entry — no name resolvable for this coord
      return null;
    }

    // Cache miss — consume budget
    if (budget.remaining <= 0) return null;

    const { rawName, rateLimited } = await callNominatimReverse(latitude!, longitude!, config);

    if (rateLimited) {
      budget.remaining = 0;
      console.log(JSON.stringify({ event: 'geocode_rate_limited_batch_stop' }));
      return null;
    }

    budget.remaining--;

    const canonicalName = rawName ? alignToCanonical(rawName, city) : null;

    if (rawName && !canonicalName) {
      console.log(JSON.stringify({
        event: 'neighborhood_alias_candidate',
        rawName,
        city,
        cacheKey,
        suggestion: 'add to CITY_NEIGHBORHOODS',
      }));
    }

    await cache.set(cacheKey, 'coords', rawName, canonicalName, PROVIDER);

    if (canonicalName) {
      return { neighborhood: canonicalName, source: 'coords_live' };
    }
    // Fall through to street path even if coords returned an unknown name
  }

  // --- Street path ---
  if (street) {
    const cacheKey = buildStreetKey(city, street);
    const cached = await cache.get(cacheKey);

    if (cached !== null) {
      if (cached.canonicalName) {
        return { neighborhood: cached.canonicalName, source: 'street_cache' };
      }
      return null;
    }

    if (budget.remaining <= 0) return null;

    const q = `${normalizeStreetPrefix(street)}, ${city}, Israel`;
    const { rawName, rateLimited } = await callNominatimForward(q, config);

    if (rateLimited) {
      budget.remaining = 0;
      console.log(JSON.stringify({ event: 'geocode_rate_limited_batch_stop' }));
      return null;
    }

    budget.remaining--;

    const canonicalName = rawName ? alignToCanonical(rawName, city) : null;

    if (rawName && !canonicalName) {
      console.log(JSON.stringify({
        event: 'neighborhood_alias_candidate',
        rawName,
        city,
        cacheKey,
        suggestion: 'add to CITY_NEIGHBORHOODS',
      }));
    }

    await cache.set(cacheKey, 'street', rawName, canonicalName, PROVIDER);

    if (canonicalName) {
      return { neighborhood: canonicalName, source: 'street_live' };
    }
  }

  return null;
}
