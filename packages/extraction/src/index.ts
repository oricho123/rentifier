export * from './types';
export * from './extractors';
export * from './patterns';
export { normalizeCity, CANONICAL_CITY_NAMES } from './cities';
export * from './ai-extractor';
export { matchScore, normalizeStreet, distanceMeters, DEDUP_THRESHOLD, type DedupFields } from './dedup';
export {
  resolveNeighborhood,
  buildCoordsKey,
  buildStreetKey,
  normalizeStreetPrefix,
  alignToCanonical,
  type ResolvedNeighborhood,
  type NeighborhoodSource,
  type NeighborhoodCache,
  type NominatimConfig,
  type ResolveNeighborhoodOptions,
} from './nominatim-resolver';
