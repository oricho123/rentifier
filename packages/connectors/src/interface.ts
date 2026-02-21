import { ListingCandidate, ListingDraft } from '@rentifier/core';

export interface FetchResult {
  candidates: ListingCandidate[];
  nextCursor: string | null;
}

export interface Connector {
  sourceId: string;
  sourceName: string;
  fetchNew(cursor: string | null): Promise<FetchResult>;
  normalize(candidate: ListingCandidate): ListingDraft;
}
