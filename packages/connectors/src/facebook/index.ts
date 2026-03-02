import type { Connector, FetchResult } from '../interface';
import type { ListingCandidate, ListingDraft } from '@rentifier/core';
import type { DB } from '@rentifier/db';
import type { FacebookCursorState, FacebookGraphQLTokens } from './types';
import { fetchWithRetry, setSortingChronological, extractTokensFromHomepage, FacebookClientError } from './client';
import { parseGraphQLResponse } from './parser';
import { getAccounts, getDocId, getGraphQLTokens, selectAccount } from './accounts';
import { extractAll } from '@rentifier/extraction';
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

  async fetchNew(cursor: string | null, _db: DB): Promise<FetchResult> {
    const state = parseCursorState(cursor);

    const groups = MONITORED_GROUPS;
    if (groups.length === 0) {
      console.warn('No monitored Facebook groups configured, skipping fetch');
      return { candidates: [], nextCursor: JSON.stringify(state) };
    }

    // doc_id check (required, stable)
    const docId = getDocId();
    if (!docId) {
      console.log(
        JSON.stringify({
          event: 'fb_missing_doc_id',
          message: 'Missing FB_DOC_ID env var — cannot make GraphQL requests',
        }),
      );
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

    // Round-robin group selection
    const groupIndex = state.lastGroupIndex % groups.length;
    const group = groups[groupIndex];

    // Account selection
    const accounts = getAccounts();
    const selected = selectAccount(accounts, state);

    if (!selected) {
      console.log(
        JSON.stringify({
          event: 'fb_all_accounts_disabled',
          disabledAccounts: state.disabledAccounts,
        }),
      );
      // Open circuit breaker
      state.circuitOpenUntil = new Date(
        Date.now() + CIRCUIT_OPEN_DURATION_MS,
      ).toISOString();
      return { candidates: [], nextCursor: JSON.stringify(state) };
    }

    try {
      console.log(
        JSON.stringify({
          event: 'fb_fetch_start',
          group: group.name,
          groupId: group.groupId,
          accountId: selected.account.id,
        }),
      );

      // Extract fresh tokens from homepage, fall back to env vars
      let tokens: FacebookGraphQLTokens;
      try {
        const { fbDtsg, lsd } = await extractTokensFromHomepage(
          selected.account.cookies,
        );
        tokens = { docId, fbDtsg, lsd };
      } catch (extractionError) {
        // Handle auth/ban errors from extraction the same as from GraphQL
        if (extractionError instanceof FacebookClientError) {
          if (
            extractionError.errorType === 'auth_expired' ||
            extractionError.errorType === 'banned'
          ) {
            throw extractionError;
          }
        }

        console.log(
          JSON.stringify({
            event: 'fb_token_extraction_failed',
            error:
              extractionError instanceof Error
                ? extractionError.message
                : String(extractionError),
          }),
        );

        // Fall back to env var tokens
        const envTokens = getGraphQLTokens();
        if (envTokens) {
          tokens = envTokens;
          console.log(
            JSON.stringify({
              event: 'fb_using_env_fallback_tokens',
            }),
          );
        } else {
          console.log(
            JSON.stringify({
              event: 'fb_no_tokens_available',
              message:
                'Token extraction failed and no FB_DTSG/FB_LSD env vars set',
            }),
          );
          return { candidates: [], nextCursor: JSON.stringify(state) };
        }
      }

      // Switch sorting to chronological before fetching
      await setSortingChronological(
        group.groupId,
        selected.account.cookies,
        tokens,
      );

      const responseText = await fetchWithRetry(
        group.groupId,
        selected.account.cookies,
        tokens,
      );
      const posts = parseGraphQLResponse(responseText, group.groupId);

      // Filter out known post IDs
      const knownSet = new Set(state.knownPostIds);
      const newPosts = posts.filter((p) => !knownSet.has(p.postId));

      // Map to ListingCandidate
      const candidates: ListingCandidate[] = newPosts.map((post) => ({
        source: 'facebook',
        sourceItemId: post.postId,
        rawTitle: post.content,
        rawDescription: post.content,
        rawUrl: post.permalink,
        rawPostedAt: post.postedAt,
        sourceData: post as unknown as Record<string, unknown>,
      }));

      // Update cursor state
      const newPostIds = newPosts.map((p) => p.postId);
      const updatedKnownIds = [...state.knownPostIds, ...newPostIds].slice(
        -MAX_KNOWN_POST_IDS,
      );

      const updatedState: FacebookCursorState = {
        lastFetchedAt: new Date().toISOString(),
        knownPostIds: updatedKnownIds,
        consecutiveFailures: 0,
        circuitOpenUntil: null,
        lastGroupIndex: groupIndex + 1,
        lastAccountIndex: selected.nextIndex,
        disabledAccounts: state.disabledAccounts,
      };

      console.log(
        JSON.stringify({
          event: 'fb_fetch_complete',
          group: group.name,
          totalPosts: posts.length,
          newPosts: newPosts.length,
        }),
      );

      return {
        candidates,
        nextCursor: JSON.stringify(updatedState),
      };
    } catch (error) {
      state.consecutiveFailures++;
      state.lastGroupIndex = groupIndex + 1;
      state.lastAccountIndex = selected.nextIndex;

      // Disable account on auth/ban errors
      if (error instanceof FacebookClientError) {
        if (
          error.errorType === 'auth_expired' ||
          error.errorType === 'banned'
        ) {
          if (!state.disabledAccounts.includes(selected.account.id)) {
            state.disabledAccounts.push(selected.account.id);
          }
        }
      }

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

      // Re-throw non-retryable auth/ban errors so the workflow fails
      // and triggers admin notifications. These require human action.
      if (
        error instanceof FacebookClientError &&
        (error.errorType === 'auth_expired' || error.errorType === 'banned')
      ) {
        throw error;
      }

      return {
        candidates: [],
        nextCursor: JSON.stringify(state),
      };
    }
  }

  normalize(candidate: ListingCandidate): ListingDraft {
    const extraction = extractAll(candidate.rawTitle, candidate.rawDescription);

    return {
      sourceId: this.sourceId,
      sourceItemId: candidate.sourceItemId,
      title: candidate.rawTitle,
      description: candidate.rawDescription,
      price: extraction.price?.amount ?? null,
      currency: (extraction.price?.currency as 'ILS' | 'USD' | 'EUR') ?? null,
      pricePeriod: extraction.price?.period ?? null,
      bedrooms: extraction.bedrooms,
      city: extraction.location?.city ?? null,
      neighborhood: extraction.location?.neighborhood ?? null,
      street: null,
      houseNumber: null,
      tags: extraction.tags,
      url: candidate.rawUrl,
      postedAt: candidate.rawPostedAt ? new Date(candidate.rawPostedAt) : null,
      floor: null,
      squareMeters: null,
      propertyType: null,
      latitude: null,
      longitude: null,
      imageUrl:
        (candidate.sourceData as Record<string, unknown>)?.imageUrl as
          | string
          | null ?? null,
    };
  }
}
