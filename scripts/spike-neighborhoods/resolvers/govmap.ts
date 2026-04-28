/**
 * Strategy B primary — GovMap (Israeli government mapping service).
 *
 * STATUS: STUB. The API is undocumented.
 *
 * To finish this:
 *   1. Open https://www.govmap.gov.il in a browser, DevTools → Network tab
 *   2. Search an address (e.g. "רוטשילד 47, תל אביב") and watch which XHR/fetch
 *      call returns neighborhood data in the response.
 *   3. Fill in ENDPOINT_URL, request body/params, auth headers, and the
 *      response-parsing logic below. The response shape I've seen in the wild
 *      is a JSON envelope with a `data` array; each entry has Hebrew fields
 *      like `shchuna` / `neighborhood_name` / similar.
 *   4. Keep `throttle()` as-is even once implemented — be a good citizen.
 *   5. If GovMap ends up requiring a short-lived token, fetch once at startup
 *      and cache it on `process.env.SPIKE_GOVMAP_TOKEN` for the run.
 *
 * Until filled in, the orchestrator will record every GovMap attempt as
 * `error_not_implemented` — the spike still runs end-to-end with Nominatim
 * + OSM polygons producing real numbers.
 */

import { alignToCanonical } from '../canonical';
import type { ResolveAttempt, SampleListing } from '../types';

const ENABLED = process.env.SPIKE_GOVMAP_ENABLED === '1';

let lastCallAt = 0;
const MIN_GAP_MS = 250; /** 4 req/sec placeholder — adjust when terms are known */

async function throttle(): Promise<void> {
  const now = Date.now();
  const gap = now - lastCallAt;
  if (gap < MIN_GAP_MS) {
    await new Promise((r) => setTimeout(r, MIN_GAP_MS - gap));
  }
  lastCallAt = Date.now();
}

/** Fills in once the endpoint is known. */
async function callGovmap(_listing: SampleListing): Promise<{ rawName: string | null; errorMsg?: string }> {
  // TODO: implement.
  //
  // Example shape once filled in:
  //
  //   const res = await fetch(ENDPOINT_URL, {
  //     method: 'POST',
  //     headers: { 'Content-Type': 'application/json', ... },
  //     body: JSON.stringify({ x: listing.longitude, y: listing.latitude, ... }),
  //   });
  //   const json = await res.json();
  //   const rawName = json?.data?.[0]?.shchuna ?? null;
  //   return { rawName };
  return { rawName: null, errorMsg: 'govmap resolver not implemented' };
}

export async function resolveGovmap(listing: SampleListing): Promise<ResolveAttempt> {
  const startedAt = performance.now();
  const base = {
    resolver: 'govmap' as const,
    listingId: listing.id,
    rawName: null as string | null,
    canonicalName: null as string | null,
  };

  if (!ENABLED) {
    return {
      ...base,
      status: 'error_not_implemented',
      rawName: null,
      canonicalName: null,
      latencyMs: 0,
      error: 'set SPIKE_GOVMAP_ENABLED=1 after wiring callGovmap()',
    };
  }

  const hasCoords =
    listing.latitude != null &&
    listing.longitude != null &&
    listing.latitude !== 0 &&
    listing.longitude !== 0;
  const hasStreet = !!listing.street && !!listing.city;
  if (!hasCoords && !hasStreet) {
    return {
      ...base,
      status: 'miss_no_input',
      rawName: null,
      canonicalName: null,
      latencyMs: Math.round(performance.now() - startedAt),
    };
  }

  await throttle();
  const res = await callGovmap(listing);
  const latencyMs = Math.round(performance.now() - startedAt);

  if (res.errorMsg) {
    return {
      ...base,
      status: 'error_provider',
      rawName: null,
      canonicalName: null,
      latencyMs,
      error: res.errorMsg,
    };
  }
  if (!res.rawName) {
    return { ...base, status: 'miss_out_of_coverage', rawName: null, canonicalName: null, latencyMs };
  }
  const canonical = alignToCanonical(res.rawName, listing.city);
  return {
    ...base,
    status: canonical ? 'hit_canonical' : 'hit_unknown',
    rawName: res.rawName,
    canonicalName: canonical,
    latencyMs,
  };
}
