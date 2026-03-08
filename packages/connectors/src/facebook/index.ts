import type { Connector, FetchResult } from '../interface';
import type { ListingCandidate, ListingDraft } from '@rentifier/core';
import type { DB } from '@rentifier/db';
import type { FacebookConfig, FacebookCursorState } from './types';
import {
  launchPersistentContext,
  closeContext,
  fetchGroupWithRetry,
  FacebookClientError,
} from './client';
import { getAccounts, selectAccount } from './accounts';
import { extractTitle } from './normalize';
import { FacebookNormalizer } from './normalize';
import {
  MONITORED_GROUPS,
  MAX_CONSECUTIVE_FAILURES,
  CIRCUIT_OPEN_DURATION_MS,
  MAX_KNOWN_POST_IDS,
} from './constants';

function createDefaultCursorState(): FacebookCursorState {
  return {
    lastFetchedAt: null,
    knownPostIds: [],
    consecutiveFailures: 0,
    circuitOpenUntil: null,
    lastGroupIndex: 0,
    lastAccountIndex: 0,
    disabledAccounts: [],
  };
}

function parseCursorState(cursor: string | null): FacebookCursorState {
  if (!cursor) return createDefaultCursorState();
  try {
    return JSON.parse(cursor) as FacebookCursorState;
  } catch {
    return createDefaultCursorState();
  }
}

export class FacebookConnector implements Connector {
  sourceId = 'facebook';
  sourceName = 'Facebook Groups';

  constructor(private config?: FacebookConfig) {}

  async fetchNew(cursor: string | null, _db: DB): Promise<FetchResult> {
    const state = parseCursorState(cursor);

    const groups = MONITORED_GROUPS;
    if (groups.length === 0) {
      console.warn('No monitored Facebook groups configured, skipping fetch');
      return { candidates: [], nextCursor: JSON.stringify(state) };
    }

    // Circuit breaker check
    if (state.circuitOpenUntil) {
      const openUntil = new Date(state.circuitOpenUntil).getTime();
      if (Date.now() < openUntil) {
        console.log(
          JSON.stringify({
            event: 'fb_circuit_open',
            circuitOpenUntil: state.circuitOpenUntil,
            consecutiveFailures: state.consecutiveFailures,
          }),
        );
        return { candidates: [], nextCursor: JSON.stringify(state) };
      }
      state.consecutiveFailures = 0;
      state.circuitOpenUntil = null;
    }

    // Account selection
    const accounts = getAccounts(this.config);
    const selected = selectAccount(accounts, state);

    if (!selected) {
      console.log(
        JSON.stringify({
          event: 'fb_all_accounts_disabled',
          disabledAccounts: state.disabledAccounts,
        }),
      );
      state.circuitOpenUntil = new Date(
        Date.now() + CIRCUIT_OPEN_DURATION_MS,
      ).toISOString();
      return { candidates: [], nextCursor: JSON.stringify(state) };
    }

    // Launch persistent browser context — preserves session across runs
    const { context, page } = await launchPersistentContext(
      selected.account.id,
      selected.account.cookies,
    );

    try {

      // Fetch from all groups
      const allCandidates: ListingCandidate[] = [];
      const knownSet = new Set(state.knownPostIds);
      const allNewPostIds: string[] = [];

      for (const group of groups) {
        try {
          console.log(
            JSON.stringify({
              event: 'fb_fetch_start',
              group: group.name,
              groupId: group.groupId,
              accountId: selected.account.id,
            }),
          );

          const posts = await fetchGroupWithRetry(page, group.groupId);

          const newPosts = posts.filter((p) => !knownSet.has(p.postId));

          for (const post of newPosts) {
            knownSet.add(post.postId);
            allNewPostIds.push(post.postId);
            allCandidates.push({
              source: 'facebook',
              sourceItemId: post.postId,
              rawTitle: extractTitle(post.content),
              rawDescription: post.content,
              rawUrl: post.permalink,
              rawPostedAt: post.postedAt,
              sourceData: post as unknown as Record<string, unknown>,
            });
          }

          console.log(
            JSON.stringify({
              event: 'fb_fetch_complete',
              group: group.name,
              totalPosts: posts.length,
              newPosts: newPosts.length,
            }),
          );

          // Reset failures on success
          state.consecutiveFailures = 0;
        } catch (error) {
          state.consecutiveFailures++;

          // Disable account on auth/ban errors
          if (error instanceof FacebookClientError) {
            if (
              error.errorType === 'auth_expired' ||
              error.errorType === 'banned'
            ) {
              if (!state.disabledAccounts.includes(selected.account.id)) {
                state.disabledAccounts.push(selected.account.id);
              }
              // Auth errors affect all groups — stop and re-throw
              throw error;
            }
          }

          const errorMessage =
            error instanceof Error ? error.message : String(error);
          const errorType =
            error instanceof FacebookClientError ? error.errorType : 'unknown';

          console.log(
            JSON.stringify({
              event: 'fb_fetch_failed',
              group: group.name,
              error: errorMessage,
              errorType,
              consecutiveFailures: state.consecutiveFailures,
              accountId: selected.account.id,
            }),
          );

          if (state.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            state.circuitOpenUntil = new Date(
              Date.now() + CIRCUIT_OPEN_DURATION_MS,
            ).toISOString();
            console.log(
              JSON.stringify({
                event: 'fb_circuit_opened',
                consecutiveFailures: state.consecutiveFailures,
                circuitOpenUntil: state.circuitOpenUntil,
              }),
            );
            break;
          }
        }
      }

      // Update cursor state
      const updatedKnownIds = [...state.knownPostIds, ...allNewPostIds].slice(
        -MAX_KNOWN_POST_IDS,
      );

      const updatedState: FacebookCursorState = {
        lastFetchedAt: new Date().toISOString(),
        knownPostIds: updatedKnownIds,
        consecutiveFailures: state.consecutiveFailures,
        circuitOpenUntil: state.circuitOpenUntil,
        lastGroupIndex: 0,
        lastAccountIndex: selected.nextIndex,
        disabledAccounts: state.disabledAccounts,
      };

      return {
        candidates: allCandidates,
        nextCursor: JSON.stringify(updatedState),
      };
    } finally {
      await closeContext(context);
    }
  }

  private normalizer = new FacebookNormalizer();

  normalize(candidate: ListingCandidate): ListingDraft {
    return this.normalizer.normalize(candidate);
  }
}
