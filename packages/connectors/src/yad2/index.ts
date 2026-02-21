import type { Connector, FetchResult } from '../interface';
import type { ListingCandidate, ListingDraft } from '@rentifier/core';
import type { Yad2Marker, Yad2CursorState } from './types';
import { fetchWithRetry, Yad2ApiError } from './client';
import {
  YAD2_CITY_CODES,
  MAX_CONSECUTIVE_FAILURES,
  CIRCUIT_OPEN_DURATION_MS,
  MAX_KNOWN_ORDER_IDS,
} from './constants';

function createDefaultCursorState(): Yad2CursorState {
  return {
    lastFetchedAt: null,
    knownOrderIds: [],
    consecutiveFailures: 0,
    circuitOpenUntil: null,
    lastCityIndex: 0,
  };
}

function parseCursorState(cursor: string | null): Yad2CursorState {
  if (!cursor) return createDefaultCursorState();
  try {
    return JSON.parse(cursor) as Yad2CursorState;
  } catch {
    return createDefaultCursorState();
  }
}

export class Yad2Connector implements Connector {
  sourceId = 'yad2';
  sourceName = 'Yad2';

  async fetchNew(cursor: string | null): Promise<FetchResult> {
    const state = parseCursorState(cursor);
    const cityCodes = Object.values(YAD2_CITY_CODES);

    // Circuit breaker check
    if (state.circuitOpenUntil) {
      const openUntil = new Date(state.circuitOpenUntil).getTime();
      if (Date.now() < openUntil) {
        console.log(JSON.stringify({
          event: 'yad2_circuit_open',
          circuitOpenUntil: state.circuitOpenUntil,
          consecutiveFailures: state.consecutiveFailures,
        }));
        return { candidates: [], nextCursor: JSON.stringify(state) };
      }
      // Cooldown expired — reset
      state.consecutiveFailures = 0;
      state.circuitOpenUntil = null;
    }

    // Round-robin city selection
    const cityIndex = state.lastCityIndex % cityCodes.length;
    const cityCode = cityCodes[cityIndex];
    const cityName = Object.keys(YAD2_CITY_CODES)[cityIndex];

    try {
      console.log(JSON.stringify({
        event: 'yad2_fetch_start',
        city: cityName,
        cityCode,
        cityIndex,
      }));

      const response = await fetchWithRetry(cityCode);
      const markers = response.data.markers;

      // Filter out already-known orderIds
      const knownSet = new Set(state.knownOrderIds);
      const newMarkers = markers.filter(m => !knownSet.has(m.orderId));

      // Map to ListingCandidate
      const candidates: ListingCandidate[] = newMarkers.map(marker =>
        this.markerToCandidate(marker, cityName)
      );

      // Update cursor state
      const newOrderIds = newMarkers.map(m => m.orderId);
      const updatedKnownIds = [...state.knownOrderIds, ...newOrderIds]
        .slice(-MAX_KNOWN_ORDER_IDS); // Keep last N (FIFO)

      const updatedState: Yad2CursorState = {
        lastFetchedAt: new Date().toISOString(),
        knownOrderIds: updatedKnownIds,
        consecutiveFailures: 0,
        circuitOpenUntil: null,
        lastCityIndex: cityIndex + 1,
      };

      console.log(JSON.stringify({
        event: 'yad2_fetch_complete',
        city: cityName,
        totalMarkers: markers.length,
        newMarkers: newMarkers.length,
      }));

      return {
        candidates,
        nextCursor: JSON.stringify(updatedState),
      };
    } catch (error) {
      // Increment failure counter
      state.consecutiveFailures++;
      state.lastCityIndex = cityIndex + 1; // Move to next city on failure too

      if (state.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        state.circuitOpenUntil = new Date(
          Date.now() + CIRCUIT_OPEN_DURATION_MS
        ).toISOString();

        console.log(JSON.stringify({
          event: 'yad2_circuit_opened',
          consecutiveFailures: state.consecutiveFailures,
          circuitOpenUntil: state.circuitOpenUntil,
        }));
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorType = error instanceof Yad2ApiError ? error.errorType : 'unknown';

      console.log(JSON.stringify({
        event: 'yad2_fetch_failed',
        city: cityName,
        error: errorMessage,
        errorType,
        consecutiveFailures: state.consecutiveFailures,
      }));

      return {
        candidates: [],
        nextCursor: JSON.stringify(state),
      };
    }
  }

  normalize(candidate: ListingCandidate): ListingDraft {
    const sd = candidate.sourceData as Partial<Yad2Marker>;

    return {
      sourceId: this.sourceId,
      sourceItemId: candidate.sourceItemId,
      title: candidate.rawTitle,
      description: candidate.rawDescription,
      price: sd.price ?? null,
      currency: 'ILS',
      pricePeriod: 'month',
      bedrooms: sd.additionalDetails?.roomsCount ?? null,
      city: sd.address?.city?.text ?? null,
      neighborhood: sd.address?.neighborhood?.text ?? null,
      tags: this.extractTags(sd),
      url: candidate.rawUrl,
      postedAt: candidate.rawPostedAt ? new Date(candidate.rawPostedAt) : null,
      floor: sd.address?.house?.floor ?? null,
      squareMeters: sd.additionalDetails?.squareMeter ?? null,
      propertyType: sd.additionalDetails?.property?.text ?? null,
      latitude: sd.address?.coords?.lat ?? null,
      longitude: sd.address?.coords?.lon ?? null,
      imageUrl: sd.metaData?.coverImage ?? null,
    };
  }

  private markerToCandidate(marker: Yad2Marker, cityName: string): ListingCandidate {
    const rooms = marker.additionalDetails?.roomsCount;
    const price = marker.price;
    const street = marker.address?.street?.text;
    const neighborhood = marker.address?.neighborhood?.text;
    const sqm = marker.additionalDetails?.squareMeter;

    // Construct a readable title from structured fields
    const titleParts: string[] = [];
    if (rooms) titleParts.push(`${rooms} חדרים`);
    titleParts.push(`ב${cityName}`);
    if (price) titleParts.push(`- ${price.toLocaleString()} ₪`);
    const rawTitle = titleParts.join(' ');

    // Construct description from address + details
    const descParts: string[] = [];
    if (street) descParts.push(street);
    if (neighborhood) descParts.push(neighborhood);
    if (sqm) descParts.push(`${sqm} מ״ר`);
    const rawDescription = descParts.join(', ');

    return {
      source: 'yad2',
      sourceItemId: marker.orderId,
      rawTitle,
      rawDescription,
      rawUrl: marker.token
        ? `https://www.yad2.co.il/realestate/item/${marker.token}`
        : `https://www.yad2.co.il/realestate/rent`,
      rawPostedAt: null,
      sourceData: marker as unknown as Record<string, unknown>,
    };
  }

  private extractTags(marker: Partial<Yad2Marker>): string[] {
    const tags: string[] = [];

    // Property type
    const propText = marker.additionalDetails?.property?.text;
    if (propText) {
      const propMap: Record<string, string> = {
        'דירה': 'apartment',
        'דירת גן': 'garden-apartment',
        'פנטהאוז': 'penthouse',
        'דופלקס': 'duplex',
        'סטודיו': 'studio',
        'בית פרטי': 'house',
        'קוטג\'': 'cottage',
        'מיני פנטהאוז': 'mini-penthouse',
      };
      const mapped = propMap[propText];
      if (mapped) tags.push(mapped);
    }

    // Property condition
    const condId = marker.additionalDetails?.propertyCondition?.id;
    if (condId !== null && condId !== undefined) {
      const condMap: Record<number, string> = {
        1: 'new',
        2: 'renovated',
        3: 'good-condition',
        4: 'needs-renovation',
        5: 'needs-major-renovation',
      };
      const condTag = condMap[condId];
      if (condTag) tags.push(condTag);
    }

    // Floor-based tags
    const floor = marker.address?.house?.floor;
    if (floor !== null && floor !== undefined) {
      if (floor === 0) tags.push('ground-floor');
      else if (floor >= 6) tags.push('high-floor');
    }

    // Images
    if (marker.metaData?.images && marker.metaData.images.length > 0) {
      tags.push('has-images');
    }

    return tags;
  }
}
