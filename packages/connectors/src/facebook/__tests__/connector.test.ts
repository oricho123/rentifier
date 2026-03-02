import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FacebookConnector } from '../index';
import type { ListingCandidate } from '@rentifier/core';

// Mock the client to avoid real HTTP requests
vi.mock('../client', () => ({
  fetchWithRetry: vi.fn(),
  FacebookClientError: class FacebookClientError extends Error {
    constructor(
      message: string,
      public readonly errorType: string,
      public readonly retryable: boolean,
    ) {
      super(message);
      this.name = 'FacebookClientError';
    }
  },
}));

// Mock accounts
vi.mock('../accounts', () => ({
  getAccounts: vi.fn(() => [{ id: '1', cookies: 'test_cookie' }]),
  selectAccount: vi.fn((_accounts: unknown[], _state: unknown) => ({
    account: { id: '1', cookies: 'test_cookie' },
    nextIndex: 1,
  })),
  getGraphQLTokens: vi.fn(() => ({
    docId: 'test_doc_id',
    fbDtsg: 'test_dtsg',
    lsd: 'test_lsd',
  })),
}));

// Mock constants with test groups
vi.mock('../constants', async () => {
  const actual = await vi.importActual('../constants');
  return {
    ...actual,
    MONITORED_GROUPS: [
      { groupId: '111', name: 'Test Group' },
    ],
  };
});

describe('FacebookConnector', () => {
  let connector: FacebookConnector;

  beforeEach(() => {
    connector = new FacebookConnector();
    vi.clearAllMocks();
  });

  describe('normalize', () => {
    it('extracts price and rooms from Hebrew post text', () => {
      const candidate: ListingCandidate = {
        source: 'facebook',
        sourceItemId: '12345',
        rawTitle: 'דירת 3 חדרים בתל אביב, 5000 שח לחודש',
        rawDescription: 'דירת 3 חדרים בתל אביב, 5000 שח לחודש',
        rawUrl: 'https://www.facebook.com/groups/111/permalink/12345/',
        rawPostedAt: '2026-03-02T10:00:00.000Z',
        sourceData: { imageUrl: 'https://scontent.fcdn.net/img.jpg' },
      };

      const draft = connector.normalize(candidate);

      expect(draft.sourceId).toBe('facebook');
      expect(draft.sourceItemId).toBe('12345');
      expect(draft.price).toBe(5000);
      expect(draft.currency).toBe('ILS');
      expect(draft.bedrooms).toBe(3);
      expect(draft.city).toBe('תל אביב');
      expect(draft.url).toBe(
        'https://www.facebook.com/groups/111/permalink/12345/',
      );
      expect(draft.postedAt).toEqual(new Date('2026-03-02T10:00:00.000Z'));
      expect(draft.imageUrl).toBe('https://scontent.fcdn.net/img.jpg');
    });

    it('handles posts with minimal data', () => {
      const candidate: ListingCandidate = {
        source: 'facebook',
        sourceItemId: '99999',
        rawTitle: 'Looking for a roommate',
        rawDescription: 'Looking for a roommate',
        rawUrl: 'https://www.facebook.com/groups/111/permalink/99999/',
        rawPostedAt: null,
        sourceData: {},
      };

      const draft = connector.normalize(candidate);

      expect(draft.sourceId).toBe('facebook');
      expect(draft.price).toBeNull();
      expect(draft.bedrooms).toBeNull();
      expect(draft.city).toBeNull();
      expect(draft.postedAt).toBeNull();
      expect(draft.imageUrl).toBeNull();
    });
  });

  describe('fetchNew', () => {
    it('returns empty when no groups configured', async () => {
      // Override MONITORED_GROUPS to empty
      const { MONITORED_GROUPS } = await import('../constants');
      const original = [...MONITORED_GROUPS];
      MONITORED_GROUPS.length = 0;

      const mockDb = {} as any;
      const result = await connector.fetchNew(null, mockDb);

      expect(result.candidates).toHaveLength(0);
      expect(result.nextCursor).not.toBeNull();

      // Restore
      MONITORED_GROUPS.push(...original);
    });

    it('returns empty when GraphQL tokens are missing', async () => {
      const { getGraphQLTokens } = await import('../accounts');
      vi.mocked(getGraphQLTokens).mockReturnValueOnce(null);

      const mockDb = {} as any;
      const result = await connector.fetchNew(null, mockDb);

      expect(result.candidates).toHaveLength(0);
    });

    it('respects circuit breaker', async () => {
      const cursor = JSON.stringify({
        lastFetchedAt: null,
        knownPostIds: [],
        consecutiveFailures: 5,
        circuitOpenUntil: new Date(
          Date.now() + 60 * 60 * 1000,
        ).toISOString(),
        lastGroupIndex: 0,
        lastAccountIndex: 0,
        disabledAccounts: [],
      });

      const mockDb = {} as any;
      const result = await connector.fetchNew(cursor, mockDb);

      expect(result.candidates).toHaveLength(0);
    });

    it('parses GraphQL response and deduplicates', async () => {
      const { fetchWithRetry } = await import('../client');
      const mockFetch = vi.mocked(fetchWithRetry);

      // Return NDJSON with two Story nodes
      const line0 = JSON.stringify({
        data: {
          node: {
            __typename: 'GroupsSectionHeaderUnit',
            group_feed: { edges: [] },
          },
        },
      });
      const line1 = JSON.stringify({
        data: {
          node: {
            __typename: 'Story',
            post_id: '100001',
            permalink_url: 'https://www.facebook.com/groups/111/posts/100001/',
            actors: [{ name: 'Alice' }],
            comet_sections: {
              content: {
                story: { message: { text: 'דירת 3 חדרים להשכרה בתל אביב 5000 שח' } },
              },
              timestamp: { story: { creation_time: 1772471819 } },
            },
          },
        },
      });
      const line2 = JSON.stringify({
        data: {
          node: {
            __typename: 'Story',
            post_id: '100002',
            permalink_url: 'https://www.facebook.com/groups/111/posts/100002/',
            actors: [{ name: 'Bob' }],
            comet_sections: {
              content: {
                story: { message: { text: 'סטודיו בירושלים 3500 שח לחודש' } },
              },
              timestamp: { story: { creation_time: 1772471700 } },
            },
          },
        },
      });

      mockFetch.mockResolvedValueOnce([line0, line1, line2].join('\n'));

      // 100001 is already known
      const cursor = JSON.stringify({
        lastFetchedAt: null,
        knownPostIds: ['100001'],
        consecutiveFailures: 0,
        circuitOpenUntil: null,
        lastGroupIndex: 0,
        lastAccountIndex: 0,
        disabledAccounts: [],
      });

      const mockDb = {} as any;
      const result = await connector.fetchNew(cursor, mockDb);

      // Only the new post should be returned
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0].sourceItemId).toBe('100002');
    });
  });
});
