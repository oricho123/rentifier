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

/** Cursor state persisted in source_state.cursor */
export interface FacebookCursorState {
  lastFetchedAt: string | null;
  knownPostIds: string[];
  consecutiveFailures: number;
  circuitOpenUntil: string | null;
  lastGroupIndex: number;
  lastAccountIndex: number;
  disabledAccounts: string[];
  /** Refreshed cookies per account, captured after successful scrape.
   *  Keyed by account ID. Used on next run to avoid session token rotation. */
  refreshedCookies?: Record<string, string>;
}
