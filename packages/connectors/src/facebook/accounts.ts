import type {
  FacebookAccount,
  FacebookConfig,
  FacebookCursorState,
  FacebookGraphQLTokens,
} from './types';

declare const process: { env: Record<string, string | undefined> };

/**
 * Read Facebook accounts.
 * When config is provided (Worker), build from config.cookies.
 * Otherwise read FB_ACCOUNT_COUNT / FB_COOKIES_* from process.env.
 */
export function getAccounts(config?: FacebookConfig): FacebookAccount[] {
  if (config) {
    return Object.entries(config.cookies).map(([id, cookies]) => ({
      id,
      cookies,
    }));
  }

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
 * Read doc_id.
 * When config is provided, return config.docId; otherwise process.env.FB_DOC_ID.
 */
export function getDocId(config?: FacebookConfig): string | null {
  if (config) return config.docId;
  return process.env.FB_DOC_ID ?? null;
}

/**
 * Read GraphQL tokens (optional fallback).
 * fb_dtsg/lsd are normally auto-extracted from the homepage.
 */
export function getGraphQLTokens(config?: FacebookConfig): FacebookGraphQLTokens | null {
  const docId = config?.docId ?? process.env.FB_DOC_ID;
  const fbDtsg = config?.fbDtsg ?? process.env.FB_DTSG;
  const lsd = config?.lsd ?? process.env.FB_LSD;

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
