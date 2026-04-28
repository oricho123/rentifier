/**
 * Strategy A — offline OSM neighborhood polygons + point-in-polygon.
 *
 * Downloads neighborhood polygons once via Overpass for the top 10 M3 cities,
 * caches them to `out/osm-polygons-cache.json`, and runs in-process PIP.
 *
 * Queries: relations tagged `boundary=administrative, admin_level=10` AND
 * areas tagged `place=neighbourhood` or `place=suburb`, clipped to Israel.
 * Admin level 10 and place=* have different completeness per city, so we
 * union both; the first containing polygon wins.
 *
 * If the cache file exists we skip the Overpass call entirely.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { alignToCanonical } from '../canonical';
import { findContainingFeature, type NamedFeature } from '../pip';
import type { ResolveAttempt, SampleListing } from '../types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = join(__dirname, '..', 'out', 'osm-polygons-cache.json');

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const USER_AGENT =
  process.env.SPIKE_USER_AGENT ??
  'rentifier-spike/0.1 (github.com/oricho123/rentifier)';

/**
 * Overpass QL: fetch neighborhood relations (admin_level 10) and place
 * nodes/ways/relations tagged suburb/neighbourhood within Israel's bbox.
 * Bbox is Israel-wide; we filter by name downstream when we match against
 * a listing's city.
 */
const OVERPASS_QUERY = `
[out:json][timeout:90];
(
  relation["boundary"="administrative"]["admin_level"="10"](29.3,34.0,33.5,36.0);
  way["place"~"^(neighbourhood|suburb|quarter)$"](29.3,34.0,33.5,36.0);
  relation["place"~"^(neighbourhood|suburb|quarter)$"](29.3,34.0,33.5,36.0);
);
out geom;
`.trim();

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[]; /** closed rings for ways */
  members?: {
    type: string;
    role?: string;
    geometry?: { lat: number; lon: number }[];
  }[];
}

interface OverpassResponse {
  elements: OverpassElement[];
}

/** Convert a closed way or relation into a NamedFeature for PIP. */
function toFeatures(elem: OverpassElement): NamedFeature | null {
  const name =
    elem.tags?.['name:he'] ??
    elem.tags?.name ??
    elem.tags?.['name:en'] ??
    null;
  if (!name) return null;

  if (elem.type === 'way' && elem.geometry && elem.geometry.length >= 4) {
    const ring = elem.geometry.map((p) => [p.lon, p.lat] as [number, number]);
    if (ring.length > 0 && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) {
      ring.push(ring[0]);
    }
    return { name, type: 'Polygon', coordinates: [ring] };
  }

  if (elem.type === 'relation' && elem.members) {
    const outerRings: [number, number][][] = [];
    for (const m of elem.members) {
      if (m.type === 'way' && (m.role === 'outer' || !m.role) && m.geometry && m.geometry.length >= 4) {
        const ring = m.geometry.map((p) => [p.lon, p.lat] as [number, number]);
        if (ring.length > 0 && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) {
          ring.push(ring[0]);
        }
        outerRings.push(ring);
      }
    }
    if (outerRings.length === 0) return null;
    if (outerRings.length === 1) {
      return { name, type: 'Polygon', coordinates: [outerRings[0]] };
    }
    return { name, type: 'MultiPolygon', coordinates: outerRings.map((r) => [r]) };
  }

  return null;
}

let featuresCache: NamedFeature[] | null = null;

async function loadFeatures(): Promise<NamedFeature[]> {
  if (featuresCache) return featuresCache;

  if (existsSync(CACHE_PATH)) {
    const raw = await readFile(CACHE_PATH, 'utf8');
    featuresCache = JSON.parse(raw) as NamedFeature[];
    console.log(`[osm-polygons] loaded ${featuresCache.length} cached features from ${CACHE_PATH}`);
    return featuresCache;
  }

  console.log('[osm-polygons] cache miss — fetching from Overpass (one-time, ~30-60s)...');
  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body: new URLSearchParams({ data: OVERPASS_QUERY }).toString(),
  });
  if (!res.ok) {
    throw new Error(`Overpass returned HTTP ${res.status}`);
  }
  const body = (await res.json()) as OverpassResponse;
  const features: NamedFeature[] = [];
  for (const el of body.elements) {
    const f = toFeatures(el);
    if (f) features.push(f);
  }

  await mkdir(dirname(CACHE_PATH), { recursive: true });
  await writeFile(CACHE_PATH, JSON.stringify(features), 'utf8');
  console.log(`[osm-polygons] cached ${features.length} features → ${CACHE_PATH}`);

  featuresCache = features;
  return features;
}

export async function resolveOsmPolygon(listing: SampleListing): Promise<ResolveAttempt> {
  const startedAt = performance.now();
  const base = {
    resolver: 'osm_polygon' as const,
    listingId: listing.id,
    rawName: null as string | null,
    canonicalName: null as string | null,
  };

  const hasCoords =
    listing.latitude != null &&
    listing.longitude != null &&
    listing.latitude !== 0 &&
    listing.longitude !== 0;
  if (!hasCoords) {
    return {
      ...base,
      status: 'miss_no_input',
      rawName: null,
      canonicalName: null,
      latencyMs: Math.round(performance.now() - startedAt),
    };
  }

  const features = await loadFeatures();
  const found = findContainingFeature(listing.longitude!, listing.latitude!, features);
  const latencyMs = Math.round(performance.now() - startedAt);

  if (!found) {
    return { ...base, status: 'miss_out_of_coverage', rawName: null, canonicalName: null, latencyMs };
  }

  const canonical = alignToCanonical(found.name, listing.city);
  return {
    ...base,
    status: canonical ? 'hit_canonical' : 'hit_unknown',
    rawName: found.name,
    canonicalName: canonical,
    latencyMs,
  };
}
