import type { Connector, FetchResult } from '../interface';
import type { ListingCandidate, ListingDraft } from '@rentifier/core';
import type { DB } from '@rentifier/db';
import type { Page } from 'playwright';
import type {
  FacebookConfig,
  FacebookCursorState,
  LoginFailureReason,
  LoginOutcome,
} from './types';
import {
  launchPersistentContext,
  closeContext,
  clearProfile,
  fetchGroupWithRetry,
  FacebookClientError,
} from './client';
import { getAccounts, selectAccount } from './accounts';
import { extractTitle } from './normalize';
import { FacebookNormalizer } from './normalize';
import { isAutoLoginEnabled, loadCredentials } from './credentials';
import { attemptLogin, LOGIN_EPISODE_WINDOW_MS, MAX_LOGIN_ATTEMPTS_PER_EPISODE } from './login';
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

type GateDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason: 'flag_off' | 'no_credentials' | 'already_attempted_this_run' | 'budget_exhausted';
      budgetAlertNeeded?: boolean;
    };

export class FacebookConnector implements Connector {
  sourceId = 'facebook';
  sourceName = 'Facebook Groups';

  private loginAttempted = new Set<string>();

  constructor(private config?: FacebookConfig) {}

  private canAttemptLogin(state: FacebookCursorState, accountId: string): GateDecision {
    if (!isAutoLoginEnabled()) return { allowed: false, reason: 'flag_off' };
    if (this.loginAttempted.has(accountId)) {
      return { allowed: false, reason: 'already_attempted_this_run' };
    }
    if (loadCredentials(accountId) === null) {
      return { allowed: false, reason: 'no_credentials' };
    }

    const record = state.loginAttempts?.[accountId];
    if (record) {
      const firstAt = Date.parse(record.firstAttemptAt);
      const windowElapsed =
        Number.isFinite(firstAt) && Date.now() - firstAt > LOGIN_EPISODE_WINDOW_MS;
      if (!windowElapsed && record.count >= MAX_LOGIN_ATTEMPTS_PER_EPISODE) {
        return {
          allowed: false,
          reason: 'budget_exhausted',
          budgetAlertNeeded: !record.budgetAlertSent,
        };
      }
    }
    return { allowed: true };
  }

  private recordLoginSuccess(state: FacebookCursorState, accountId: string): void {
    if (!state.loginAttempts) return;
    delete state.loginAttempts[accountId];
  }

  private recordLoginFailure(
    state: FacebookCursorState,
    accountId: string,
    reason: LoginFailureReason
  ): void {
    state.loginAttempts ??= {};
    const now = new Date().toISOString();
    const existing = state.loginAttempts[accountId];

    if (!existing) {
      state.loginAttempts[accountId] = {
        count: 1,
        firstAttemptAt: now,
        lastAttemptAt: now,
        lastReason: reason,
      };
      return;
    }

    const firstAt = Date.parse(existing.firstAttemptAt);
    const windowElapsed =
      Number.isFinite(firstAt) && Date.now() - firstAt > LOGIN_EPISODE_WINDOW_MS;

    if (windowElapsed) {
      state.loginAttempts[accountId] = {
        count: 1,
        firstAttemptAt: now,
        lastAttemptAt: now,
        lastReason: reason,
      };
      return;
    }

    state.loginAttempts[accountId] = {
      ...existing,
      count: existing.count + 1,
      lastAttemptAt: now,
      lastReason: reason,
    };
  }

  private markBudgetAlertSent(state: FacebookCursorState, accountId: string): void {
    const record = state.loginAttempts?.[accountId];
    if (record) record.budgetAlertSent = true;
  }

  private async fetchGroupWithLoginRecovery(
    page: Page,
    groupId: string,
    accountId: string,
    state: FacebookCursorState
  ): Promise<Awaited<ReturnType<typeof fetchGroupWithRetry>>> {
    try {
      return await fetchGroupWithRetry(page, groupId);
    } catch (err) {
      if (
        !(err instanceof FacebookClientError) ||
        (err.errorType !== 'auth_expired' && err.errorType !== 'banned')
      ) {
        throw err;
      }

      const gate = this.canAttemptLogin(state, accountId);
      if (!gate.allowed) {
        if (gate.reason === 'no_credentials') {
          console.log(
            JSON.stringify({
              event: 'fb_login_skip_no_credentials',
              accountId,
            })
          );
        } else {
          console.log(
            JSON.stringify({
              event: 'fb_login_skip',
              accountId,
              reason: gate.reason,
            })
          );
        }

        if (gate.reason === 'budget_exhausted') {
          if (gate.budgetAlertNeeded) {
            this.markBudgetAlertSent(state, accountId);
          }
          throw new FacebookClientError(err.message, err.errorType, err.retryable, {
            success: false,
            reason: 'budget_exhausted',
          });
        }

        throw err;
      }

      const creds = loadCredentials(accountId);
      if (!creds) {
        throw err;
      }

      this.loginAttempted.add(accountId);

      let outcome: LoginOutcome;
      try {
        outcome = await attemptLogin(page, creds);
      } catch (loginErr) {
        const message = loginErr instanceof Error ? loginErr.message : String(loginErr);
        const reason: LoginFailureReason = /timeout/i.test(message)
          ? 'timeout'
          : 'unknown_login_page';
        outcome = { success: false, reason };
      }

      if (!outcome.success) {
        this.recordLoginFailure(state, accountId, outcome.reason);
        throw new FacebookClientError(err.message, err.errorType, err.retryable, outcome);
      }

      this.recordLoginSuccess(state, accountId);

      try {
        return await fetchGroupWithRetry(page, groupId);
      } catch (retryErr) {
        if (retryErr instanceof FacebookClientError) {
          throw new FacebookClientError(retryErr.message, retryErr.errorType, retryErr.retryable, {
            success: true,
          });
        }
        throw retryErr;
      }
    }
  }

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
          })
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
        })
      );
      state.circuitOpenUntil = new Date(Date.now() + CIRCUIT_OPEN_DURATION_MS).toISOString();
      return { candidates: [], nextCursor: JSON.stringify(state) };
    }

    // Launch persistent browser context — preserves session across runs
    const { context, page } = await launchPersistentContext(
      selected.account.id,
      selected.account.cookies
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
            })
          );

          const posts = await this.fetchGroupWithLoginRecovery(
            page,
            group.groupId,
            selected.account.id,
            state
          );

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
            })
          );

          // Reset failures on success
          state.consecutiveFailures = 0;
        } catch (error) {
          state.consecutiveFailures++;

          // Disable account on auth/ban errors
          if (error instanceof FacebookClientError) {
            if (error.errorType === 'auth_expired' || error.errorType === 'banned') {
              if (!state.disabledAccounts.includes(selected.account.id)) {
                state.disabledAccounts.push(selected.account.id);
              }
              // Clear stale profile so next run re-seeds from env var cookies
              clearProfile(selected.account.id);
              const errorMessage = error.message;
              console.log(
                JSON.stringify({
                  event: 'fb_account_disabled',
                  group: group.name,
                  accountId: selected.account.id,
                  errorType: error.errorType,
                  error: errorMessage,
                })
              );
              // Auth errors affect all groups — stop iterating but return cursor
              // so the caller can detect newly-disabled accounts and alert.
              break;
            }
          }

          const errorMessage = error instanceof Error ? error.message : String(error);
          const errorType = error instanceof FacebookClientError ? error.errorType : 'unknown';

          console.log(
            JSON.stringify({
              event: 'fb_fetch_failed',
              group: group.name,
              error: errorMessage,
              errorType,
              consecutiveFailures: state.consecutiveFailures,
              accountId: selected.account.id,
            })
          );

          if (state.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            state.circuitOpenUntil = new Date(Date.now() + CIRCUIT_OPEN_DURATION_MS).toISOString();
            console.log(
              JSON.stringify({
                event: 'fb_circuit_opened',
                consecutiveFailures: state.consecutiveFailures,
                circuitOpenUntil: state.circuitOpenUntil,
              })
            );
            break;
          }
        }
      }

      // Update cursor state
      const updatedKnownIds = [...state.knownPostIds, ...allNewPostIds].slice(-MAX_KNOWN_POST_IDS);

      const updatedState: FacebookCursorState = {
        lastFetchedAt: new Date().toISOString(),
        knownPostIds: updatedKnownIds,
        consecutiveFailures: state.consecutiveFailures,
        circuitOpenUntil: state.circuitOpenUntil,
        lastGroupIndex: 0,
        lastAccountIndex: selected.nextIndex,
        disabledAccounts: state.disabledAccounts,
        loginAttempts: state.loginAttempts,
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
