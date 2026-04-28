/**
 * Strategy B — live reverse/forward geocoding via public Nominatim.
 *
 * Usage policy: https://operations.osmfoundation.org/policies/nominatim/
 *   - Max 1 request per second (we enforce this per-process).
 *   - Descriptive User-Agent required with contact info.
 *   - For heavy workloads, self-host. The spike is well under policy limits.
 *
 * The resolver exposes two methods:
 *   - reverse(lat, lng): reverse-geocode a point → suburb/neighbourhood name
 *   - forward(street, houseNumber, city): forward-geocode an address → suburb
 *
 * Both return a ResolveAttempt matching the shared type in ../types.ts.
 */

import { alignToCanonical } from '../canonical';
import type { ResolveAttempt, ResolveStatus, SampleListing } from '../types';

const USER_AGENT =
  process.env.SPIKE_USER_AGENT ??
  'rentifier-spike/0.1 (github.com/oricho123/rentifier)';

const BASE = 'https://nominatim.openstreetmap.org';
const REQUEST_TIMEOUT_MS = 10_000;

let lastCallAt = 0;
const MIN_GAP_MS = 1_100; /** ~1 req/sec with headroom */

async function throttle(): Promise<void> {
  const now = Date.now();
  const gap = now - lastCallAt;
  if (gap < MIN_GAP_MS) {
    await new Promise((r) => setTimeout(r, MIN_GAP_MS - gap));
  }
  lastCallAt = Date.now();
}

interface NominatimResponse {
  address?: {
    neighbourhood?: string;
    suburb?: string;
    quarter?: string;
    city_district?: string;
  };
}

function pickName(addr: NominatimResponse['address']): string | null {
  if (!addr) return null;
  return addr.neighbourhood ?? addr.suburb ?? addr.quarter ?? addr.city_district ?? null;
}

async function callNominatim(path: string): Promise<{ json: NominatimResponse | null; status: number; errorMsg?: string }> {
  await throttle();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'he,en' },
      signal: controller.signal,
    });
    const status = res.status;
    if (status === 429 || status === 503) {
      return { json: null, status, errorMsg: `rate limited (HTTP ${status})` };
    }
    if (!res.ok) {
      return { json: null, status, errorMsg: `HTTP ${status}` };
    }
    const json = (await res.json()) as NominatimResponse;
    return { json, status };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const timedOut = msg.includes('abort') || msg.includes('timeout');
    return { json: null, status: 0, errorMsg: timedOut ? 'timeout' : msg };
  } finally {
    clearTimeout(timer);
  }
}

export async function resolveNominatim(listing: SampleListing): Promise<ResolveAttempt> {
  const startedAt = performance.now();
  const base = {
    resolver: 'nominatim' as const,
    listingId: listing.id,
    rawName: null as string | null,
    canonicalName: null as string | null,
  };

  const makeAttempt = (status: ResolveStatus, rawName: string | null, err?: string): ResolveAttempt => ({
    ...base,
    status,
    rawName,
    canonicalName: alignToCanonical(rawName, listing.city),
    latencyMs: Math.round(performance.now() - startedAt),
    ...(err ? { error: err } : {}),
  });

  const hasCoords =
    listing.latitude != null &&
    listing.longitude != null &&
    listing.latitude !== 0 &&
    listing.longitude !== 0;
  const hasStreet = !!listing.street && !!listing.city;

  let response: Awaited<ReturnType<typeof callNominatim>>;

  if (hasCoords) {
    const qs = new URLSearchParams({
      format: 'json',
      lat: String(listing.latitude),
      lon: String(listing.longitude),
      zoom: '16',
      addressdetails: '1',
    });
    response = await callNominatim(`/reverse?${qs.toString()}`);
  } else if (hasStreet) {
    const q = [listing.street, listing.house_number, listing.city, 'Israel']
      .filter(Boolean)
      .join(', ');
    const qs = new URLSearchParams({
      format: 'jsonv2',
      q,
      addressdetails: '1',
      limit: '1',
    });
    const res = await callNominatim(`/search?${qs.toString()}`);
    if (res.json && Array.isArray(res.json)) {
      const first = (res.json as unknown as NominatimResponse[])[0];
      response = { json: first ?? null, status: res.status };
    } else {
      response = res;
    }
  } else {
    return makeAttempt('miss_no_input', null);
  }

  if (response.errorMsg) {
    const status: ResolveStatus =
      response.errorMsg === 'timeout'
        ? 'error_timeout'
        : response.status === 429 || response.status === 503
          ? 'error_rate_limited'
          : 'error_provider';
    return makeAttempt(status, null, response.errorMsg);
  }

  const rawName = pickName(response.json?.address);
  if (!rawName) {
    return makeAttempt('miss_out_of_coverage', null);
  }
  const canonical = alignToCanonical(rawName, listing.city);
  return makeAttempt(canonical ? 'hit_canonical' : 'hit_unknown', rawName);
}
