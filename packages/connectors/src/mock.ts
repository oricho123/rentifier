import { Connector, FetchResult } from './interface';
import { ListingCandidate, ListingDraft } from '@rentifier/core';
import type { DB } from '@rentifier/db';

export class MockConnector implements Connector {
  sourceId = 'mock';
  sourceName = 'Mock Source';

  async fetchNew(cursor: string | null, _db: DB): Promise<FetchResult> {
    if (cursor !== null) {
      return { candidates: [], nextCursor: null };
    }
    return {
      candidates: [
        {
          source: 'mock',
          sourceItemId: 'mock-1',
          rawTitle: 'דירת 3 חדרים בתל אביב',
          rawDescription: 'דירה מרווחת עם חניה ומרפסת, 4500 ש״ח לחודש',
          rawUrl: 'https://example.com/mock-1',
          rawPostedAt: new Date().toISOString(),
          sourceData: {},
        },
        {
          source: 'mock',
          sourceItemId: 'mock-2',
          rawTitle: 'סטודיו בהרצליה פיתוח',
          rawDescription: 'סטודיו מרוהט עם מזגן, $1200 לחודש, כניסה מיידית',
          rawUrl: 'https://example.com/mock-2',
          rawPostedAt: new Date().toISOString(),
          sourceData: {},
        },
        {
          source: 'mock',
          sourceItemId: 'mock-3',
          rawTitle: '4 חדרים בירושלים - נחלאות',
          rawDescription: 'דירה גדולה, 6000₪, חיות מותר, מרפסת גדולה',
          rawUrl: 'https://example.com/mock-3',
          rawPostedAt: new Date().toISOString(),
          sourceData: {},
        },
      ],
      nextCursor: 'mock-cursor-1',
    };
  }

  normalize(candidate: ListingCandidate): ListingDraft {
    return {
      sourceId: this.sourceId,
      sourceItemId: candidate.sourceItemId,
      title: candidate.rawTitle,
      description: candidate.rawDescription,
      price: null,
      currency: null,
      pricePeriod: null,
      bedrooms: null,
      city: null,
      neighborhood: null,
      street: null,
      houseNumber: null,
      tags: [],
      url: candidate.rawUrl,
      postedAt: candidate.rawPostedAt ? new Date(candidate.rawPostedAt) : null,
      floor: null,
      squareMeters: null,
      propertyType: null,
      latitude: null,
      longitude: null,
      imageUrl: null,
    };
  }
}
