import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FacebookConnector } from '../index';
import type { ListingCandidate } from '@rentifier/core';

// Mock the client to avoid real browser launches
vi.mock('../client', () => {
  const FacebookClientError = class FacebookClientError extends Error {
    constructor(
      message: string,
      public readonly errorType: string,
      public readonly retryable: boolean,
    ) {
      super(message);
      this.name = 'FacebookClientError';
    }
  };

  return {
    launchBrowser: vi.fn().mockResolvedValue({
      close: vi.fn().mockResolvedValue(undefined),
    }),
    createBrowserContext: vi.fn().mockResolvedValue({
      context: {},
      page: {},
    }),
    closeBrowser: vi.fn().mockResolvedValue(undefined),
    fetchGroupWithRetry: vi.fn().mockResolvedValue([]),
    FacebookClientError,
  };
});

// Mock accounts
vi.mock('../accounts', () => ({
  getAccounts: vi.fn(() => [{ id: '1', cookies: 'test_cookie' }]),
  selectAccount: vi.fn(() => ({
    account: { id: '1', cookies: 'test_cookie' },
    nextIndex: 1,
  })),
  parseCookieString: vi.fn(() => [
    { name: 'c_user', value: '123', domain: '.facebook.com', path: '/' },
  ]),
}));

// Mock constants with test groups
vi.mock('../constants', async () => {
  const actual = await vi.importActual('../constants');
  return {
    ...actual,
    MONITORED_GROUPS: [
      { groupId: '111', name: 'Test Group', defaultCities: ['תל אביב'] },
    ],
    getMonitoredGroup: (groupId: string) => {
      if (groupId === '111') {
        return { groupId: '111', name: 'Test Group', defaultCities: ['תל אביב'] };
      }
      return undefined;
    },
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
        sourceData: { imageUrl: 'https://scontent.fcdn.net/img.jpg', groupId: '111' },
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

    it('applies default city from group when no city extracted', () => {
      const candidate: ListingCandidate = {
        source: 'facebook',
        sourceItemId: '55555',
        rawTitle: 'דירת 2 חדרים 4000 שח',
        rawDescription: 'דירת 2 חדרים 4000 שח',
        rawUrl: 'https://www.facebook.com/groups/111/permalink/55555/',
        rawPostedAt: '2026-03-02T12:00:00.000Z',
        sourceData: { groupId: '111' },
      };

      const draft = connector.normalize(candidate);

      expect(draft.city).toBe('תל אביב');
      expect(draft.price).toBe(4000);
      expect(draft.bedrooms).toBe(2);
    });

    it('extracts neighborhood after applying default city', () => {
      const candidate: ListingCandidate = {
        source: 'facebook',
        sourceItemId: '66666',
        rawTitle: 'דירה בפלורנטין 5000 שח',
        rawDescription: 'דירה יפה בפלורנטין',
        rawUrl: 'https://www.facebook.com/groups/111/permalink/66666/',
        rawPostedAt: '2026-03-02T13:00:00.000Z',
        sourceData: { groupId: '111' },
      };

      const draft = connector.normalize(candidate);

      expect(draft.city).toBe('תל אביב');
      expect(draft.neighborhood).toBe('פלורנטין');
    });
  });

  describe('fetchNew', () => {
    it('returns empty when no groups configured', async () => {
      const { MONITORED_GROUPS } = await import('../constants');
      const original = [...MONITORED_GROUPS];
      MONITORED_GROUPS.length = 0;

      const mockDb = {} as any;
      const result = await connector.fetchNew(null, mockDb);

      expect(result.candidates).toHaveLength(0);
      expect(result.nextCursor).not.toBeNull();

      MONITORED_GROUPS.push(...original);
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

    it('returns empty when all accounts disabled', async () => {
      const { selectAccount } = await import('../accounts');
      vi.mocked(selectAccount).mockReturnValueOnce(null);

      const mockDb = {} as any;
      const result = await connector.fetchNew(null, mockDb);

      expect(result.candidates).toHaveLength(0);
    });

    it('extracts posts and deduplicates', async () => {
      const { fetchGroupWithRetry } = await import('../client');
      vi.mocked(fetchGroupWithRetry).mockResolvedValueOnce([
        {
          postId: '100001',
          authorName: 'Alice',
          content: 'דירת 3 חדרים להשכרה בתל אביב 5000 שח',
          permalink: 'https://www.facebook.com/groups/111/posts/100001/',
          postedAt: '2026-03-03T10:00:00.000Z',
          imageUrl: null,
          groupId: '111',
        },
        {
          postId: '100002',
          authorName: 'Bob',
          content: 'סטודיו בירושלים 3500 שח לחודש',
          permalink: 'https://www.facebook.com/groups/111/posts/100002/',
          postedAt: '2026-03-03T10:05:00.000Z',
          imageUrl: 'https://scontent.fcdn.net/img.jpg',
          groupId: '111',
        },
      ]);

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
      expect(result.candidates[0].rawTitle).toBe('סטודיו בירושלים 3500 שח לחודש');
      expect(result.candidates[0].rawDescription).toBe('סטודיו בירושלים 3500 שח לחודש');
    });

    it('truncates long titles and keeps full description', async () => {
      const { fetchGroupWithRetry } = await import('../client');

      const longFirstLine = 'דירת 3 חדרים להשכרה בתל אביב עם מרפסת שמש גדולה ונוף פתוח לים במיקום מושלם ליד הים';
      const fullContent = `${longFirstLine}\n\nפרטים נוספים:\n5000 שח לחודש`;

      vi.mocked(fetchGroupWithRetry).mockResolvedValueOnce([
        {
          postId: '200001',
          authorName: 'Test',
          content: fullContent,
          permalink: 'https://www.facebook.com/groups/111/posts/200001/',
          postedAt: '2026-03-03T10:00:00.000Z',
          imageUrl: null,
          groupId: '111',
        },
      ]);

      const mockDb = {} as any;
      const result = await connector.fetchNew(null, mockDb);

      expect(result.candidates).toHaveLength(1);
      // Title should be truncated to 80 chars with ellipsis
      expect(result.candidates[0].rawTitle.length).toBeLessThanOrEqual(81);
      expect(result.candidates[0].rawTitle).toContain('דירת 3 חדרים להשכרה');
      // Description should be the full content
      expect(result.candidates[0].rawDescription).toBe(fullContent);
    });

    it('launches and closes browser', async () => {
      const { launchBrowser, closeBrowser, fetchGroupWithRetry } = await import('../client');
      vi.mocked(fetchGroupWithRetry).mockResolvedValueOnce([]);

      const mockDb = {} as any;
      await connector.fetchNew(null, mockDb);

      expect(launchBrowser).toHaveBeenCalledOnce();
      expect(closeBrowser).toHaveBeenCalledOnce();
    });

    it('closes browser even on error', async () => {
      const { launchBrowser, closeBrowser, fetchGroupWithRetry, FacebookClientError } = await import('../client');
      vi.mocked(fetchGroupWithRetry).mockRejectedValueOnce(
        new FacebookClientError('Auth expired', 'auth_expired', false),
      );

      const mockDb = {} as any;
      await expect(connector.fetchNew(null, mockDb)).rejects.toThrow();

      expect(launchBrowser).toHaveBeenCalledOnce();
      expect(closeBrowser).toHaveBeenCalledOnce();
    });
  });
});
