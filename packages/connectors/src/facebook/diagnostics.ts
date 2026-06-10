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
  /**
   * aria-labels of every `[role="button"]` on the page (capped + truncated).
   * Catches CTA / SSO sibling buttons that confused the classifier — e.g. on
   * the 2026-06-10 incident this would have surfaced
   * `["Continue with Google","Continue with Apple",...]` and made the SSO
   * false-positive obvious without re-running the failure. UI strings only;
   * never element values, innerText, or user content.
   */
  buttonLabels: string[];
  /**
   * Static attributes (`name`, `aria-label`, `placeholder`, `type`) of every
   * `<input>` on the page (capped). Lets us spot a renamed login field or a
   * 2FA variant from logs alone. Element `.value` is deliberately excluded —
   * it can carry the typed password.
   */
  inputAttrs: Array<{
    name: string | null;
    ariaLabel: string | null;
    placeholder: string | null;
    type: string | null;
  }>;
}

const MAX_BUTTON_LABELS = 30;
const MAX_LABEL_LEN = 80;
const MAX_INPUT_ATTRS = 12;

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
    buttonLabels,
    inputAttrs,
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
    withTimeout(
      page
        .evaluate(
          `(() => {
            try {
              var els = Array.from(document.querySelectorAll('[role="button"]'));
              var labels = [];
              for (var i = 0; i < els.length; i++) {
                var al = els[i].getAttribute('aria-label');
                if (al && al.trim().length > 0) {
                  labels.push(al.trim().slice(0, ${MAX_LABEL_LEN}));
                  if (labels.length >= ${MAX_BUTTON_LABELS}) break;
                }
              }
              return labels;
            } catch (e) { return []; }
          })()`
        )
        .catch(() => [] as string[]) as Promise<string[]>,
      [] as string[]
    ),
    withTimeout(
      page
        .evaluate(
          // Static input attributes only — never `.value` (would leak the
          // typed password into logs).
          `(() => {
            try {
              var els = Array.from(document.querySelectorAll('input')).slice(0, ${MAX_INPUT_ATTRS});
              return els.map(function (i) {
                var al = i.getAttribute('aria-label') || '';
                var pl = i.getAttribute('placeholder') || '';
                return {
                  name: i.getAttribute('name'),
                  ariaLabel: al ? al.slice(0, ${MAX_LABEL_LEN}) : null,
                  placeholder: pl ? pl.slice(0, ${MAX_LABEL_LEN}) : null,
                  type: i.getAttribute('type'),
                };
              });
            } catch (e) { return []; }
          })()`
        )
        .catch(
          () =>
            [] as Array<{
              name: string | null;
              ariaLabel: string | null;
              placeholder: string | null;
              type: string | null;
            }>
        ) as Promise<
        Array<{
          name: string | null;
          ariaLabel: string | null;
          placeholder: string | null;
          type: string | null;
        }>
      >,
      [] as Array<{
        name: string | null;
        ariaLabel: string | null;
        placeholder: string | null;
        type: string | null;
      }>
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
    buttonLabels,
    inputAttrs,
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
