import type {
  FacebookAccount,
  FacebookConfig,
  FacebookCursorState,
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
 * Convert raw cookie string (e.g. "c_user=123; xs=abc") to Playwright Cookie[] format.
 */
export function parseCookieString(
  cookieStr: string,
): { name: string; value: string; domain: string; path: string }[] {
  return cookieStr
    .split(';')
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const eqIndex = pair.indexOf('=');
      if (eqIndex === -1) return null;
      const name = pair.slice(0, eqIndex).trim();
      const value = pair.slice(eqIndex + 1).trim();
      return {
        name,
        value,
        domain: '.facebook.com',
        path: '/',
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);
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
