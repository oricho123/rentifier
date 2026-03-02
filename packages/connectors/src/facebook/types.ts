/** Parsed post from Facebook GraphQL API */
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

/** GraphQL tokens needed for API requests */
export interface FacebookGraphQLTokens {
  docId: string;
  fbDtsg: string;
  lsd: string;
}

/** Config injected by Worker; when omitted, functions fall back to process.env */
export interface FacebookConfig {
  cookies: Record<string, string>;
  docId: string;
  fbDtsg?: string;
  lsd?: string;
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
