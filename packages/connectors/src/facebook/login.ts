import type { Locator, Page } from 'playwright';
import type { FacebookCredentials } from './credentials';
import type { LoginOutcome } from './types';

export const MAX_LOGIN_STEPS = 5;
export const LOGIN_TIMEOUT_MS = 60_000;
export const LOGIN_NAVIGATION_TIMEOUT_MS = 15_000;
export const MAX_LOGIN_ATTEMPTS_PER_EPISODE = 3;
export const LOGIN_EPISODE_WINDOW_MS = 24 * 60 * 60 * 1000;

// Modern facebook.com renders nearly every interactive element as a div[role="button"]
// with an aria-label, and uses generated class hashes that change frequently. data-testid
// attributes are mostly gone. Selectors here favor ARIA + name attributes (which persist
// because they are required for HTML form serialization) over class or data-testid.
export const SELECTORS = {
  emailInput: 'input[name="email"]',
  passwordInput: 'input[name="pass"]',
  loginSubmit:
    'div[role="button"][aria-label="Log In" i], div[role="button"][aria-label="Log in" i], div[role="button"][aria-label="התחבר" i], div[role="button"][aria-label="התחברות" i], button[name="login"]',
  invalidCredentialsBanner:
    'div[role="alert"]:has-text("incorrect"), div[role="alert"]:has-text("password you entered"), div[role="alert"]:has-text("הסיסמה")',
  twoFactor:
    'input[autocomplete="one-time-code"], input[name="approvals_code"], input[name="checkpoint_data"]',
  captcha: 'iframe[src*="captcha"], iframe[title*="captcha" i], img[src*="captcha"]',
  cookieConsentAccept:
    'div[role="button"][aria-label*="cookie" i], div[role="button"][aria-label*="Accept" i], div[role="button"][aria-label*="Allow" i]',
  saveLoginNotNow:
    'div[role="button"][aria-label="Not Now" i], div[role="button"][aria-label="Not now" i], div[role="button"][aria-label="לא עכשיו" i]',
  feedRoot: '[role="feed"], [role="main"]',
} as const;

export const CONTINUE_LOCALES = [
  'Continue',
  'המשך',
  'Continuar',
  'Continuer',
  'Weiter',
  'Продолжить',
  '继续',
  '繼續',
  '続ける',
  '계속',
] as const;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const CONTINUE_RE = new RegExp(
  `^(?:${CONTINUE_LOCALES.map(escapeRegex).join('|')})\\b\\s+\\S+`
);

const CONTINUE_EXACT_RE = new RegExp(`^(?:${CONTINUE_LOCALES.map(escapeRegex).join('|')})$`);

export function continueAsLocators(page: Page): Locator[] {
  return [
    page.getByRole('button', { name: CONTINUE_RE }),
    page.locator('div[role="button"]').filter({
      has: page.locator('span').filter({ hasText: CONTINUE_EXACT_RE }),
    }),
    page.locator('a[role="button"][href*="login_redirect"]'),
  ];
}

export type LoginScreenState =
  | 'home_feed'
  | 'checkpoint'
  | 'captcha'
  | 'two_factor'
  | 'continue_as_user'
  | 'password_only'
  | 'full_login'
  | 'invalid_credentials'
  | 'save_login_prompt'
  | 'cookie_consent'
  | 'unknown';

async function exists(page: Page, selector: string): Promise<boolean> {
  try {
    return (await page.locator(selector).count()) > 0;
  } catch {
    return false;
  }
}

async function continueButtonVisible(page: Page): Promise<boolean> {
  for (const loc of continueAsLocators(page)) {
    try {
      if ((await loc.count()) > 0) return true;
    } catch {
      // ignore and continue
    }
  }
  return false;
}

export async function classifyLoginScreen(page: Page): Promise<LoginScreenState> {
  const url = page.url();

  // Priority 1: home / feed
  if (
    !url.includes('/login') &&
    !url.includes('login.php') &&
    !url.includes('/checkpoint/') &&
    !url.includes('/two_step_verification') &&
    (await exists(page, SELECTORS.feedRoot))
  ) {
    const onLoginForm = await exists(page, SELECTORS.emailInput);
    if (!onLoginForm) return 'home_feed';
  }

  // Priority 2: checkpoint
  if (url.includes('/checkpoint/')) return 'checkpoint';

  // Priority 3: captcha
  if (await exists(page, SELECTORS.captcha)) return 'captcha';

  // Priority 4: two-factor
  if (url.includes('/two_step_verification') || (await exists(page, SELECTORS.twoFactor))) {
    return 'two_factor';
  }

  // Priority 5: continue-as-user (saved account)
  if (await continueButtonVisible(page)) return 'continue_as_user';

  // Priority 6: password-only re-prompt (password input but no email field)
  const hasEmail = await exists(page, SELECTORS.emailInput);
  const hasPassword = await exists(page, SELECTORS.passwordInput);
  if (!hasEmail && hasPassword) return 'password_only';

  // Priority 7: full login form (email + password)
  if (hasEmail && hasPassword) {
    if (await exists(page, SELECTORS.invalidCredentialsBanner)) {
      return 'invalid_credentials';
    }
    return 'full_login';
  }

  // Priority 8: invalid_credentials banner without inputs (rare)
  if (await exists(page, SELECTORS.invalidCredentialsBanner)) {
    return 'invalid_credentials';
  }

  // Priority 9: save-login prompt
  if (await exists(page, SELECTORS.saveLoginNotNow)) return 'save_login_prompt';

  // Priority 10: cookie consent
  if (await exists(page, SELECTORS.cookieConsentAccept)) return 'cookie_consent';

  return 'unknown';
}

function logEvent(payload: Record<string, unknown>): void {
  console.log(JSON.stringify(payload));
}

async function withNavigation<T>(page: Page, action: () => Promise<T>): Promise<T> {
  // Run the action FIRST, then wait for the page to settle. FB login is XHR-based
  // and does not always trigger a full navigation, so `domcontentloaded` resolves
  // immediately on the existing document and provides no real wait. `networkidle`
  // waits for in-flight XHRs (the login POST + any redirects) to complete.
  const result = await action();
  await page
    .waitForLoadState('networkidle', { timeout: LOGIN_NAVIGATION_TIMEOUT_MS })
    .catch(() => undefined);
  return result;
}

async function clickFirstAvailable(locators: Locator[]): Promise<boolean> {
  for (const loc of locators) {
    try {
      if ((await loc.count()) > 0) {
        await loc.first().click({ timeout: LOGIN_NAVIGATION_TIMEOUT_MS });
        return true;
      }
    } catch {
      // try next locator
    }
  }
  return false;
}

export interface AttemptLoginOptions {
  maxSteps?: number;
  timeoutMs?: number;
}

export async function attemptLogin(
  page: Page,
  creds: FacebookCredentials,
  opts: AttemptLoginOptions = {}
): Promise<LoginOutcome> {
  const maxSteps = opts.maxSteps ?? MAX_LOGIN_STEPS;
  const timeoutMs = opts.timeoutMs ?? LOGIN_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;

  logEvent({ event: 'fb_login_attempt' });

  let prevState: LoginScreenState | null = null;

  try {
    for (let step = 0; step < maxSteps; step++) {
      if (Date.now() > deadline) {
        logEvent({ event: 'fb_login_failed', reason: 'timeout', step });
        return { success: false, reason: 'timeout' };
      }

      const state = await classifyLoginScreen(page);
      const url = page.url();
      logEvent({ event: 'fb_login_step', step, state, url });

      if (state === 'home_feed') {
        logEvent({ event: 'fb_login_success', step });
        return { success: true };
      }

      if (state === 'checkpoint') {
        logEvent({ event: 'fb_login_failed', reason: 'checkpoint', step });
        return { success: false, reason: 'checkpoint' };
      }
      if (state === 'captcha') {
        logEvent({ event: 'fb_login_failed', reason: 'captcha', step });
        return { success: false, reason: 'captcha' };
      }
      if (state === 'two_factor') {
        logEvent({ event: 'fb_login_failed', reason: 'two_factor', step });
        return { success: false, reason: 'two_factor' };
      }
      if (state === 'invalid_credentials') {
        logEvent({
          event: 'fb_login_failed',
          reason: 'invalid_credentials',
          step,
        });
        return { success: false, reason: 'invalid_credentials' };
      }

      // No-progress detection: same non-terminal state twice → bail
      if (prevState === state) {
        logEvent({
          event: 'fb_login_failed',
          reason: 'unknown_login_page',
          step,
          detail: 'no_progress',
        });
        return { success: false, reason: 'unknown_login_page' };
      }
      prevState = state;

      if (state === 'continue_as_user') {
        await withNavigation(page, async () => {
          await clickFirstAvailable(continueAsLocators(page));
        });
        continue;
      }

      if (state === 'password_only') {
        await page.locator(SELECTORS.passwordInput).first().fill(creds.password);
        await withNavigation(page, async () => {
          await page.keyboard.press('Enter');
        });
        continue;
      }

      if (state === 'full_login') {
        await page.locator(SELECTORS.emailInput).first().fill(creds.email);
        await page.locator(SELECTORS.passwordInput).first().fill(creds.password);
        await withNavigation(page, async () => {
          const submit = page.locator(SELECTORS.loginSubmit).first();
          if ((await submit.count()) > 0) {
            await submit.click({ timeout: LOGIN_NAVIGATION_TIMEOUT_MS });
          } else {
            await page.keyboard.press('Enter');
          }
        });
        continue;
      }

      if (state === 'save_login_prompt') {
        await withNavigation(page, async () => {
          const dismiss = page.locator(SELECTORS.saveLoginNotNow).first();
          if ((await dismiss.count()) > 0) {
            await dismiss.click({ timeout: LOGIN_NAVIGATION_TIMEOUT_MS });
          }
        });
        continue;
      }

      if (state === 'cookie_consent') {
        await withNavigation(page, async () => {
          const accept = page.locator(SELECTORS.cookieConsentAccept).first();
          if ((await accept.count()) > 0) {
            await accept.click({ timeout: LOGIN_NAVIGATION_TIMEOUT_MS });
          }
        });
        continue;
      }

      logEvent({
        event: 'fb_login_failed',
        reason: 'unknown_login_page',
        step,
      });
      return { success: false, reason: 'unknown_login_page' };
    }

    logEvent({
      event: 'fb_login_failed',
      reason: 'unknown_login_page',
      detail: 'max_steps_exceeded',
    });
    return { success: false, reason: 'unknown_login_page' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isTimeout = /timeout/i.test(message) || /Timeout/.test(message);
    const reason: 'timeout' | 'unknown_login_page' = isTimeout ? 'timeout' : 'unknown_login_page';
    logEvent({ event: 'fb_login_failed', reason });
    return { success: false, reason };
  }
}
