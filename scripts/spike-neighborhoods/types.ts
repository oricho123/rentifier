/**
 * Shared types for the neighborhood-resolver spike.
 */

export type SourceName = 'yad2' | 'facebook';

export type CityTier = 'top3' | 'other_m3' | 'out_of_m3';

export type StratumBucket =
  | 'yad2_top3'
  | 'yad2_other_m3'
  | 'fb_street_city'
  | 'edge';

/** A single sample listing used to evaluate resolvers. */
export interface SampleListing {
  id: number;
  source: SourceName;
  bucket: StratumBucket;
  city: string | null;
  neighborhood: string | null;
  street: string | null;
  house_number: string | null;
  latitude: number | null;
  longitude: number | null;
  url: string;
}

export interface SampleFile {
  generatedAt: string;
  count: number;
  stratum: Record<StratumBucket, number>;
  listings: SampleListing[];
}

export type ResolverId = 'osm_polygon' | 'govmap' | 'nominatim';

export type ResolveStatus =
  | 'hit_canonical' /** provider output is already a known key in CITY_NEIGHBORHOODS */
  | 'hit_unknown' /** provider returned something, but it's not in our variant map */
  | 'miss_out_of_coverage' /** resolver ran but had no data for this point/street */
  | 'miss_ambiguous' /** street spans multiple neighborhoods and no house num disambiguated */
  | 'miss_no_input' /** listing lacks the inputs this resolver requires */
  | 'error_timeout'
  | 'error_rate_limited'
  | 'error_provider' /** non-2xx, malformed, etc. */
  | 'error_not_implemented';

export interface ResolveAttempt {
  resolver: ResolverId;
  listingId: number;
  status: ResolveStatus;
  rawName: string | null; /** exact string the provider returned, if any */
  canonicalName: string | null; /** normalized via CITY_NEIGHBORHOODS variant map, null if no alignment */
  latencyMs: number;
  error?: string;
}
