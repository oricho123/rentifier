/** Parsed post from Facebook group feed */
export interface FacebookPost {
  postId: string;
  authorName: string;
  content: string;
  permalink: string;
  postedAt: string | null;
  imageUrl: string | null;
  groupId: string;
}

/** Facebook account for cookie-based auth */
export interface FacebookAccount {
  id: string;
  cookies: string;
}

/** Config injected by Worker; when omitted, functions fall back to process.env */
export interface FacebookConfig {
  cookies: Record<string, string>;
}

/** Outcome of an auto-login attempt — see facebook-auto-login design doc */
export type LoginOutcome =
  | { success: true }
  | {
      success: false;
      reason:
        | 'invalid_credentials'
        | 'checkpoint'
        | 'captcha'
        | 'two_factor'
        | 'unknown_login_page'
        | 'timeout'
        | 'budget_exhausted';
    };

export type LoginFailureReason = Extract<LoginOutcome, { success: false }>['reason'];

/** Per-account login-attempt budget tracking; lives inside FacebookCursorState */
export interface LoginAttemptRecord {
  count: number;
  firstAttemptAt: string;
  lastAttemptAt: string;
  lastReason?: LoginFailureReason;
  budgetAlertSent?: boolean;
}

/** Cursor state persisted in source_state.cursor */
export interface FacebookCursorState {
  lastFetchedAt: string | null;
  knownPostIds: string[];
  consecutiveFailures: number;
  circuitOpenUntil: string | null;
  lastGroupIndex: number;
  lastAccountIndex: number;
  disabledAccounts: string[];
  /**
   * Optional, additive: SHA-256 of the seed cookies captured when each account was
   * disabled. On a later run, a changed FB_COOKIES_N (operator refreshed the secret)
   * auto re-enables the account. Keyed by account id.
   */
  disabledCookieHashes?: Record<string, string>;
  /** Optional, additive: per-account login-attempt budget for auto-login. */
  loginAttempts?: Record<string, LoginAttemptRecord>;
}
