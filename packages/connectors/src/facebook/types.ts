/** Parsed post from mbasic.facebook.com group page */
export interface FacebookPost {
  postId: string;
  authorName: string;
  content: string;
  permalink: string;
  postedAt: string | null;
  imageUrl: string | null;
  groupId: string;
}

/** Result of parsing a group page */
export interface FacebookGroupPageResult {
  posts: FacebookPost[];
  nextPageUrl: string | null;
}

/** Facebook account for cookie-based auth */
export interface FacebookAccount {
  id: string;
  cookies: string;
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
}
