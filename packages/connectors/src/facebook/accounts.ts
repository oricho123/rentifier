import type {
  FacebookAccount,
  FacebookCursorState,
  FacebookGraphQLTokens,
} from './types';

/**
 * Read Facebook accounts from environment variables.
 * Expects: FB_ACCOUNT_COUNT, FB_COOKIES_1, FB_COOKIES_2, ...
 */
export function getAccounts(): FacebookAccount[] {
  const count = parseInt(process.env.FB_ACCOUNT_COUNT || '1', 10);
  const accounts: FacebookAccount[] = [];

  for (let i = 1; i <= count; i++) {
    const cookies = process.env[`FB_COOKIES_${i}`];
    if (cookies) {
      accounts.push({ id: String(i), cookies });
    }
  }

  return accounts;
}

/**
 * Read GraphQL tokens from environment variables.
 * These are shared across all accounts (extracted from DevTools once).
 */
export function getGraphQLTokens(): FacebookGraphQLTokens | null {
  const docId = process.env.FB_DOC_ID;
  const fbDtsg = process.env.FB_DTSG;
  const lsd = process.env.FB_LSD;

  if (!docId || !fbDtsg || !lsd) return null;

  return { docId, fbDtsg, lsd };
}

/**
 * Select next account via round-robin, skipping disabled accounts.
 * Returns null if all accounts are disabled.
 */
export function selectAccount(
  accounts: FacebookAccount[],
  state: FacebookCursorState,
): { account: FacebookAccount; nextIndex: number } | null {
  if (accounts.length === 0) return null;

  const disabledSet = new Set(state.disabledAccounts);
  const enabledAccounts = accounts.filter((a) => !disabledSet.has(a.id));

  if (enabledAccounts.length === 0) return null;

  const index = state.lastAccountIndex % enabledAccounts.length;
  return {
    account: enabledAccounts[index],
    nextIndex: index + 1,
  };
}
