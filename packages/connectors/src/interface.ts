import { ListingCandidate, ListingDraft } from '@rentifier/core';
import type { DB } from '@rentifier/db';

export interface FetchResult {
  candidates: ListingCandidate[];
  nextCursor: string | null;
}

/**
 * Connector interface for fetching listings from external sources
 *
 * BREAKING CHANGE (M2): fetchNew now requires DB parameter for dynamic configuration
 */
export interface Connector {
  sourceId: string;
  sourceName: string;
  fetchNew(cursor: string | null, db: DB): Promise<FetchResult>;
  normalize(candidate: ListingCandidate): ListingDraft;
}
