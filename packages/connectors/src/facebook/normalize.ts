import type { ListingCandidate, ListingDraft } from '@rentifier/core';
import type { Connector, FetchResult } from '../interface';
import type { DB } from '@rentifier/db';
import { extractAll, matchNeighborhoodInCity } from '@rentifier/extraction';
import { getMonitoredGroup } from './constants';

const MAX_TITLE_LENGTH = 80;

/**
 * Extract a short title from a Facebook post's content.
 * Uses the first non-empty line, truncated to MAX_TITLE_LENGTH chars.
 */
export function extractTitle(content: string): string {
  const firstLine = content.split('\n').find((line) => line.trim().length > 0) ?? content;
  const trimmed = firstLine.trim();
  if (trimmed.length <= MAX_TITLE_LENGTH) return trimmed;
  return trimmed.slice(0, MAX_TITLE_LENGTH).trimEnd() + '…';
}

/**
 * Lightweight Facebook normalizer that can run inside Cloudflare Workers.
 * Does NOT import Playwright — safe for bundling in any environment.
 * Fetching is handled by the full FacebookConnector (Playwright, GitHub Actions only).
 */
export class FacebookNormalizer implements Connector {
  readonly sourceId = 'facebook';
  readonly sourceName = 'Facebook Groups';

  async fetchNew(_cursor: string | null, _db: DB): Promise<FetchResult> {
    throw new Error('Facebook fetching requires Playwright — use FacebookConnector from GitHub Actions');
  }

  normalize(candidate: ListingCandidate): ListingDraft {
    const extraction = extractAll(candidate.rawTitle, candidate.rawDescription);

    // If no city was extracted, fall back to the group's default city
    let city = extraction.location?.city ?? null;
    let neighborhood = extraction.location?.neighborhood ?? null;

    if (!city) {
      const sourceData = candidate.sourceData as Record<string, unknown>;
      const groupId = sourceData?.groupId as string | undefined;

      if (groupId) {
        const group = getMonitoredGroup(groupId);
        if (group && group.defaultCities.length > 0) {
          city = group.defaultCities[0];

          // Try to extract neighborhood from the text now that we have a city
          if (!neighborhood) {
            const combinedText = `${candidate.rawTitle} ${candidate.rawDescription}`;
            const neighborhoodMatch = matchNeighborhoodInCity(combinedText, city);
            if (neighborhoodMatch) {
              neighborhood = neighborhoodMatch.neighborhood;
            }
          }
        }
      }
    }

    return {
      sourceId: this.sourceId,
      sourceItemId: candidate.sourceItemId,
      title: candidate.rawTitle,
      description: candidate.rawDescription,
      price: extraction.price?.amount ?? null,
      currency: (extraction.price?.currency as 'ILS' | 'USD' | 'EUR') ?? null,
      pricePeriod: extraction.price?.period ?? null,
      bedrooms: extraction.bedrooms,
      city,
      neighborhood,
      street: extraction.street,
      houseNumber: null,
      tags: extraction.tags,
      url: candidate.rawUrl,
      postedAt: candidate.rawPostedAt ? new Date(candidate.rawPostedAt) : null,
      floor: null,
      squareMeters: null,
      propertyType: null,
      latitude: null,
      longitude: null,
      imageUrl:
        (candidate.sourceData as Record<string, unknown>)?.imageUrl as
          | string
          | null ?? null,
    };
  }
}
