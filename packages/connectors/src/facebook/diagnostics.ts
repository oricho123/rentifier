import type { Page } from 'playwright';

/**
 * A snapshot of observable signals from the current Facebook page. Used to make
 * post-mortem of "login_success but next nav was auth_expired" failures readable
 * in production logs without leaking content.
 *
 * Cookie *names* only — never values. Values would be a credential leak.
 */
export interface FacebookPageFingerprint {
  url: string;
  title: string | null;
  hasFeed: boolean;
  hasMain: boolean;
  hasBanner: boolean;
  hasEmailInput: boolean;
  hasPasswordInput: boolean;
  hasSearchBar: boolean;
  hasNotifications: boolean;
  hasContinueAsUser: boolean;
  hasLoginAnotherAccountLink: boolean;
  htmlLen: number;
  cookieNames: string[];
  hasCUserCookie: boolean;
  hasXsCookie: boolean;
}

const FINGERPRINT_TIMEOUT_MS = 1500;

async function safeCount(page: Page, selector: string): Promise<number> {
  try {
    return await page.locator(selector).count();
  } catch {
    return 0;
  }
}

async function withTimeout<T>(p: Promise<T>, fallback: T): Promise<T> {
  return Promise.race<T>([
    p,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), FINGERPRINT_TIMEOUT_MS)),
  ]);
}

/**
 * Capture a structured fingerprint of the current page. All selector probes are
 * wrapped so a stalled page cannot block the caller; missing data falls back to
 * `false`/`null`.
 */
export async function pageFingerprint(page: Page): Promise<FacebookPageFingerprint> {
  const url = page.url();

  const [
    title,
    feedCount,
    mainCount,
    bannerCount,
    emailCount,
    passwordCount,
    searchCount,
    notifCount,
    continueAsCount,
    loginAnotherCount,
    htmlLen,
    cookies,
  ] = await Promise.all([
    withTimeout(
      page.title().catch(() => ''),
      ''
    ) as Promise<string>,
    withTimeout(safeCount(page, '[role="feed"]'), 0),
    withTimeout(safeCount(page, '[role="main"]'), 0),
    withTimeout(safeCount(page, '[role="banner"]'), 0),
    withTimeout(safeCount(page, 'input[name="email"]'), 0),
    withTimeout(safeCount(page, 'input[name="pass"]'), 0),
    withTimeout(
      safeCount(
        page,
        'input[aria-label*="Search Facebook" i], input[placeholder*="Search Facebook" i], input[aria-label*="חיפוש בפייסבוק" i], input[placeholder*="חיפוש בפייסבוק" i]'
      ),
      0
    ),
    withTimeout(
      safeCount(
        page,
        'div[role="button"][aria-label*="Notifications" i], div[role="button"][aria-label*="התראות" i]'
      ),
      0
    ),
    withTimeout(
      safeCount(page, 'a[role="button"][href*="login_redirect"], a[href*="login_redirect"]'),
      0
    ),
    withTimeout(
      safeCount(
        page,
        'a[href*="recover/initiate"], a[href*="login.php"][role="link"], a[aria-label*="another account" i]'
      ),
      0
    ),
    withTimeout(
      page
        .evaluate('document.documentElement?.outerHTML?.length || 0')
        .catch(() => 0) as Promise<number>,
      0
    ),
    withTimeout(
      page
        .context()
        .cookies()
        .catch(() => []),
      [] as Array<{ name: string }>
    ),
  ]);

  const cookieNames = cookies.map((c) => c.name).sort();

  return {
    url,
    title: title || null,
    hasFeed: feedCount > 0,
    hasMain: mainCount > 0,
    hasBanner: bannerCount > 0,
    hasEmailInput: emailCount > 0,
    hasPasswordInput: passwordCount > 0,
    hasSearchBar: searchCount > 0,
    hasNotifications: notifCount > 0,
    hasContinueAsUser: continueAsCount > 0,
    hasLoginAnotherAccountLink: loginAnotherCount > 0,
    htmlLen: typeof htmlLen === 'number' ? htmlLen : 0,
    cookieNames,
    hasCUserCookie: cookieNames.includes('c_user'),
    hasXsCookie: cookieNames.includes('xs'),
  };
}

/**
 * Emit the fingerprint as a single JSON log line under the given event name.
 * Failures during capture are swallowed — diagnostics must never break a run.
 */
export async function logPageFingerprint(
  page: Page,
  event: string,
  extra?: Record<string, unknown>
): Promise<void> {
  try {
    const fp = await pageFingerprint(page);
    console.log(JSON.stringify({ event, ...extra, fingerprint: fp }));
  } catch {
    // Diagnostics are best-effort.
  }
}
