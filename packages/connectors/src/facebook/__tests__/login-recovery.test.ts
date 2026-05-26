import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FacebookConnector } from '../index';
import { LOGIN_EPISODE_WINDOW_MS } from '../login';

const fetchGroupMock = vi.fn();
const attemptLoginMock = vi.fn();
const loadCredentialsMock = vi.fn();
const isAutoLoginEnabledMock = vi.fn();

vi.mock('../client', () => {
  class FacebookClientErrorMock extends Error {
    constructor(
      message: string,
      public readonly errorType: string,
      public readonly retryable: boolean,
      public readonly loginOutcome?: unknown
    ) {
      super(message);
      this.name = 'FacebookClientError';
    }
  }
  return {
    launchPersistentContext: vi.fn().mockResolvedValue({
      context: { close: vi.fn().mockResolvedValue(undefined) },
      page: { url: () => 'https://www.facebook.com/' },
    }),
    closeContext: vi.fn().mockResolvedValue(undefined),
    clearProfile: vi.fn(),
    launchBrowser: vi.fn(),
    createBrowserContext: vi.fn(),
    closeBrowser: vi.fn(),
    fetchGroupWithRetry: (...args: unknown[]) => fetchGroupMock(...args),
    FacebookClientError: FacebookClientErrorMock,
  };
});

type ErrorCtor = new (
  message: string,
  errorType: string,
  retryable: boolean,
  loginOutcome?: unknown
) => Error;

let ClientErrorClass: ErrorCtor;

vi.mock('../accounts', () => ({
  getAccounts: vi.fn(() => [{ id: '1', cookies: 'cookie' }]),
  selectAccount: vi.fn(() => ({
    account: { id: '1', cookies: 'cookie' },
    nextIndex: 1,
  })),
  parseCookieString: vi.fn(() => []),
}));

vi.mock('../credentials', () => ({
  isAutoLoginEnabled: () => isAutoLoginEnabledMock(),
  loadCredentials: (id: string) => loadCredentialsMock(id),
}));

vi.mock('../login', async () => {
  const actual = await vi.importActual<typeof import('../login')>('../login');
  return {
    ...actual,
    attemptLogin: (...args: unknown[]) => attemptLoginMock(...args),
  };
});

vi.mock('../constants', async () => {
  const actual = await vi.importActual<typeof import('../constants')>('../constants');
  return {
    ...actual,
    MONITORED_GROUPS: [{ groupId: '111', name: 'Test Group', defaultCities: ['תל אביב'] }],
  };
});

const mockDb = {} as never;

function authError(): Error {
  return new ClientErrorClass('auth expired', 'auth_expired', false);
}

function makeCursor(state: Record<string, unknown>): string {
  return JSON.stringify(state);
}

describe('fetchGroupWithLoginRecovery (via FacebookConnector.fetchNew)', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let captured: string[];

  beforeAll(async () => {
    const mod = await import('../client');
    ClientErrorClass = mod.FacebookClientError as unknown as ErrorCtor;
  });

  beforeEach(() => {
    fetchGroupMock.mockReset();
    attemptLoginMock.mockReset();
    loadCredentialsMock.mockReset();
    isAutoLoginEnabledMock.mockReset();
    captured = [];
    logSpy = vi.spyOn(console, 'log').mockImplementation((line: string) => {
      captured.push(typeof line === 'string' ? line : JSON.stringify(line));
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('FF off: no attemptLogin call, account disabled as before', async () => {
    isAutoLoginEnabledMock.mockReturnValue(false);
    fetchGroupMock.mockRejectedValueOnce(authError());

    const connector = new FacebookConnector();
    const result = await connector.fetchNew(null, mockDb);

    expect(attemptLoginMock).not.toHaveBeenCalled();
    const cursor = JSON.parse(result.nextCursor!);
    expect(cursor.disabledAccounts).toContain('1');
  });

  it('no credentials → logs fb_login_skip_no_credentials, no attemptLogin', async () => {
    isAutoLoginEnabledMock.mockReturnValue(true);
    loadCredentialsMock.mockReturnValue(null);
    fetchGroupMock.mockRejectedValueOnce(authError());

    const connector = new FacebookConnector();
    await connector.fetchNew(null, mockDb);

    expect(attemptLoginMock).not.toHaveBeenCalled();
    expect(captured.some((l) => l.includes('fb_login_skip_no_credentials'))).toBe(true);
  });

  it('already attempted this run → no second attempt', async () => {
    isAutoLoginEnabledMock.mockReturnValue(true);
    loadCredentialsMock.mockReturnValue({ email: 'a@b.com', password: 'p' });
    attemptLoginMock.mockResolvedValueOnce({ success: true });
    // First call: auth error → login → retry (still auth error → throw)
    fetchGroupMock.mockRejectedValueOnce(authError()).mockRejectedValueOnce(authError());

    const connector = new FacebookConnector();
    await connector.fetchNew(null, mockDb);

    expect(attemptLoginMock).toHaveBeenCalledTimes(1);
  });

  it('budget cases: empty → allowed, counter set to 1', async () => {
    isAutoLoginEnabledMock.mockReturnValue(true);
    loadCredentialsMock.mockReturnValue({ email: 'a@b.com', password: 'p' });
    attemptLoginMock.mockResolvedValueOnce({
      success: false,
      reason: 'invalid_credentials',
    });
    fetchGroupMock.mockRejectedValueOnce(authError());

    const connector = new FacebookConnector();
    const result = await connector.fetchNew(null, mockDb);

    const cursor = JSON.parse(result.nextCursor!);
    expect(cursor.loginAttempts['1'].count).toBe(1);
    expect(cursor.loginAttempts['1'].lastReason).toBe('invalid_credentials');
  });

  it('budget cases: count=1 → counter→2', async () => {
    isAutoLoginEnabledMock.mockReturnValue(true);
    loadCredentialsMock.mockReturnValue({ email: 'a@b.com', password: 'p' });
    attemptLoginMock.mockResolvedValueOnce({
      success: false,
      reason: 'invalid_credentials',
    });
    fetchGroupMock.mockRejectedValueOnce(authError());

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const cursor = makeCursor({
      lastFetchedAt: null,
      knownPostIds: [],
      consecutiveFailures: 0,
      circuitOpenUntil: null,
      lastGroupIndex: 0,
      lastAccountIndex: 0,
      disabledAccounts: [],
      loginAttempts: {
        '1': {
          count: 1,
          firstAttemptAt: oneHourAgo,
          lastAttemptAt: oneHourAgo,
          lastReason: 'invalid_credentials',
        },
      },
    });

    const connector = new FacebookConnector();
    const result = await connector.fetchNew(cursor, mockDb);
    const next = JSON.parse(result.nextCursor!);
    expect(next.loginAttempts['1'].count).toBe(2);
  });

  it('budget cases: count=3, fresh → SKIPPED with budget_exhausted, alert needed', async () => {
    isAutoLoginEnabledMock.mockReturnValue(true);
    loadCredentialsMock.mockReturnValue({ email: 'a@b.com', password: 'p' });
    fetchGroupMock.mockRejectedValueOnce(authError());

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const cursor = makeCursor({
      lastFetchedAt: null,
      knownPostIds: [],
      consecutiveFailures: 0,
      circuitOpenUntil: null,
      lastGroupIndex: 0,
      lastAccountIndex: 0,
      disabledAccounts: [],
      loginAttempts: {
        '1': {
          count: 3,
          firstAttemptAt: twoHoursAgo,
          lastAttemptAt: twoHoursAgo,
          budgetAlertSent: false,
        },
      },
    });

    const connector = new FacebookConnector();
    const result = await connector.fetchNew(cursor, mockDb);

    expect(attemptLoginMock).not.toHaveBeenCalled();
    expect(captured.some((l) => l.includes('budget_exhausted'))).toBe(true);
    const next = JSON.parse(result.nextCursor!);
    expect(next.loginAttempts['1'].budgetAlertSent).toBe(true);
  });

  it('budget cases: count=3 alert already sent → SKIPPED, no second alert mark', async () => {
    isAutoLoginEnabledMock.mockReturnValue(true);
    loadCredentialsMock.mockReturnValue({ email: 'a@b.com', password: 'p' });
    fetchGroupMock.mockRejectedValueOnce(authError());

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const cursor = makeCursor({
      lastFetchedAt: null,
      knownPostIds: [],
      consecutiveFailures: 0,
      circuitOpenUntil: null,
      lastGroupIndex: 0,
      lastAccountIndex: 0,
      disabledAccounts: [],
      loginAttempts: {
        '1': {
          count: 3,
          firstAttemptAt: twoHoursAgo,
          lastAttemptAt: twoHoursAgo,
          budgetAlertSent: true,
        },
      },
    });

    const connector = new FacebookConnector();
    await connector.fetchNew(cursor, mockDb);

    expect(attemptLoginMock).not.toHaveBeenCalled();
  });

  it('budget cases: count=3 with window elapsed → counter resets, attempt allowed', async () => {
    isAutoLoginEnabledMock.mockReturnValue(true);
    loadCredentialsMock.mockReturnValue({ email: 'a@b.com', password: 'p' });
    attemptLoginMock.mockResolvedValueOnce({
      success: false,
      reason: 'invalid_credentials',
    });
    fetchGroupMock.mockRejectedValueOnce(authError());

    const old = new Date(Date.now() - LOGIN_EPISODE_WINDOW_MS - 60_000).toISOString();
    const cursor = makeCursor({
      lastFetchedAt: null,
      knownPostIds: [],
      consecutiveFailures: 0,
      circuitOpenUntil: null,
      lastGroupIndex: 0,
      lastAccountIndex: 0,
      disabledAccounts: [],
      loginAttempts: {
        '1': {
          count: 3,
          firstAttemptAt: old,
          lastAttemptAt: old,
          budgetAlertSent: true,
        },
      },
    });

    const connector = new FacebookConnector();
    const result = await connector.fetchNew(cursor, mockDb);

    expect(attemptLoginMock).toHaveBeenCalledTimes(1);
    const next = JSON.parse(result.nextCursor!);
    expect(next.loginAttempts['1'].count).toBe(1);
  });

  it('success path: clears loginAttempts entry and retries fetchGroupWithRetry once', async () => {
    isAutoLoginEnabledMock.mockReturnValue(true);
    loadCredentialsMock.mockReturnValue({ email: 'a@b.com', password: 'p' });
    attemptLoginMock.mockResolvedValueOnce({ success: true });
    fetchGroupMock.mockRejectedValueOnce(authError()).mockResolvedValueOnce([]);

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const cursor = makeCursor({
      lastFetchedAt: null,
      knownPostIds: [],
      consecutiveFailures: 0,
      circuitOpenUntil: null,
      lastGroupIndex: 0,
      lastAccountIndex: 0,
      disabledAccounts: [],
      loginAttempts: {
        '1': {
          count: 2,
          firstAttemptAt: oneHourAgo,
          lastAttemptAt: oneHourAgo,
        },
      },
    });

    const connector = new FacebookConnector();
    const result = await connector.fetchNew(cursor, mockDb);

    expect(fetchGroupMock).toHaveBeenCalledTimes(2);
    const next = JSON.parse(result.nextCursor!);
    expect(next.loginAttempts['1']).toBeUndefined();
  });
});
