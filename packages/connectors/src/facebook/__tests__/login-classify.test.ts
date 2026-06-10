import { describe, expect, it, vi } from 'vitest';
import type { Page } from 'playwright';
import { classifyLoginScreen, SELECTORS } from '../login';

interface SelectorMap {
  [selector: string]: number;
}

function makePage(opts: {
  url: string;
  selectors?: SelectorMap;
  continueButtonHits?: number;
}): Page {
  const sel = opts.selectors ?? {};
  const continueHits = opts.continueButtonHits ?? 0;

  // Tracks how many .getByRole / continue-style locator chains we've returned.
  // The classifier only consults continue locators when prior priorities miss.
  const continueLocator = {
    count: vi.fn().mockResolvedValue(continueHits),
    first: vi.fn().mockReturnThis(),
  };

  const filterableLocator = {
    count: vi.fn().mockResolvedValue(continueHits),
    first: vi.fn().mockReturnThis(),
    filter: vi.fn().mockReturnValue({
      count: vi.fn().mockResolvedValue(continueHits),
      first: vi.fn().mockReturnThis(),
    }),
  };

  const page = {
    url: () => opts.url,
    locator: vi.fn((selector: string) => {
      if (selector === 'div[role="button"]' || selector === 'span') {
        return filterableLocator;
      }
      if (selector === SELECTORS.continueAsButton || selector === SELECTORS.savedSessionShortcut) {
        return continueLocator;
      }
      return {
        count: vi.fn().mockResolvedValue(sel[selector] ?? 0),
        first: vi.fn().mockReturnThis(),
      };
    }),
    getByRole: vi.fn(() => ({
      count: vi.fn().mockResolvedValue(0),
      first: vi.fn().mockReturnThis(),
    })),
  } as unknown as Page;

  return page;
}

describe('classifyLoginScreen', () => {
  const FEED = SELECTORS.feedRoot;
  const CHROME = SELECTORS.loggedInChrome;
  const EMAIL = 'input[name="email"]';
  const PASSWORD = 'input[name="pass"]';
  const CHECKPOINT_URL = 'https://www.facebook.com/checkpoint/123/';
  const TWO_FACTOR_URL = 'https://www.facebook.com/two_step_verification/';
  const LOGIN_URL = 'https://www.facebook.com/login/';
  const HOME_URL = 'https://www.facebook.com/';
  const CAPTCHA = SELECTORS.captcha;
  const TWO_FACTOR = SELECTORS.twoFactor;
  const SAVE_LOGIN = SELECTORS.saveLoginNotNow;
  const COOKIE = SELECTORS.cookieConsentAccept;
  const INVALID = SELECTORS.invalidCredentialsBanner;

  it('returns home_feed when on home with feed root AND logged-in chrome', async () => {
    const page = makePage({ url: HOME_URL, selectors: { [FEED]: 1, [CHROME]: 1 } });
    expect(await classifyLoginScreen(page)).toBe('home_feed');
  });

  it('does NOT return home_feed when only feed root is present (no logged-in chrome)', async () => {
    // Smoking-gun case from production: the logged-out marketing splash has
    // [role="main"] but lacks the search bar / notifications / banner-home link.
    // Previously this falsely passed as home_feed. Now it must fall through to
    // other priorities — here `unknown`, since email/pass haven't hydrated yet.
    const page = makePage({ url: HOME_URL, selectors: { [FEED]: 1 } });
    expect(await classifyLoginScreen(page)).toBe('unknown');
  });

  it('does NOT return home_feed when feed root + chrome are present but a password input is also visible', async () => {
    // Some logged-out splashes render the marketing chrome alongside the inline
    // login form. The pass input is the giveaway that we are NOT actually authed.
    const page = makePage({
      url: HOME_URL,
      selectors: { [FEED]: 1, [CHROME]: 1, [EMAIL]: 1, [PASSWORD]: 1 },
    });
    expect(await classifyLoginScreen(page)).toBe('full_login');
  });

  it('returns checkpoint when URL contains /checkpoint/', async () => {
    const page = makePage({ url: CHECKPOINT_URL });
    expect(await classifyLoginScreen(page)).toBe('checkpoint');
  });

  it('returns redirecting for the crypted_string interstitial even with feed/main present', async () => {
    const page = makePage({
      url: 'https://www.facebook.com/?crypted_string=AYjabc%7Cdef&next=https%3A%2F%2Fwww.facebook.com%2Fgroups%2F123',
      selectors: { [FEED]: 1 },
    });
    expect(await classifyLoginScreen(page)).toBe('redirecting');
  });

  it('priority: redirecting (crypted_string) wins over home_feed', async () => {
    const page = makePage({
      url: 'https://www.facebook.com/?crypted_string=TOKEN',
      selectors: { [FEED]: 1, [EMAIL]: 0 },
    });
    expect(await classifyLoginScreen(page)).toBe('redirecting');
  });

  it('returns captcha when captcha selector matches', async () => {
    const page = makePage({ url: LOGIN_URL, selectors: { [CAPTCHA]: 1 } });
    expect(await classifyLoginScreen(page)).toBe('captcha');
  });

  it('returns two_factor when URL contains /two_step_verification', async () => {
    const page = makePage({ url: TWO_FACTOR_URL });
    expect(await classifyLoginScreen(page)).toBe('two_factor');
  });

  it('returns two_factor when 2FA input selector matches', async () => {
    const page = makePage({ url: LOGIN_URL, selectors: { [TWO_FACTOR]: 1 } });
    expect(await classifyLoginScreen(page)).toBe('two_factor');
  });

  it('returns continue_as_user when continue button visible', async () => {
    const page = makePage({ url: LOGIN_URL, continueButtonHits: 1 });
    expect(await classifyLoginScreen(page)).toBe('continue_as_user');
  });

  it('does NOT return continue_as_user on a logged-out /login page with no saved-session button', async () => {
    // Smoking-gun regression from production 2026-06-08: classifier returned
    // `continue_as_user` on `/login/?next=...` while the fingerprint showed
    // hasContinueAsUser=false and no c_user/xs cookies. Cause: the old broad
    // `getByRole('button', { name: /^Continue\b\s+\S+/ })` matcher caught the
    // SSO buttons ("Continue with Google" / "Continue with Apple") rendered
    // alongside the email+pass form. The tightened selectors require either an
    // aria-label="Continue as <Name>" prefix or an `href*="login_redirect"`
    // anchor — neither is satisfied on the logged-out splash, even when SSO
    // buttons are visible.
    const page = makePage({ url: LOGIN_URL, continueButtonHits: 0 });
    expect(await classifyLoginScreen(page)).toBe('unknown');
  });

  it('returns password_only when only password input present', async () => {
    const page = makePage({ url: LOGIN_URL, selectors: { [PASSWORD]: 1 } });
    expect(await classifyLoginScreen(page)).toBe('password_only');
  });

  it('returns full_login when email + password inputs present', async () => {
    const page = makePage({
      url: LOGIN_URL,
      selectors: { [EMAIL]: 1, [PASSWORD]: 1 },
    });
    expect(await classifyLoginScreen(page)).toBe('full_login');
  });

  it('returns invalid_credentials when banner present alongside form', async () => {
    const page = makePage({
      url: LOGIN_URL,
      selectors: { [EMAIL]: 1, [PASSWORD]: 1, [INVALID]: 1 },
    });
    expect(await classifyLoginScreen(page)).toBe('invalid_credentials');
  });

  it('returns save_login_prompt when its dismiss button present', async () => {
    const page = makePage({ url: LOGIN_URL, selectors: { [SAVE_LOGIN]: 1 } });
    expect(await classifyLoginScreen(page)).toBe('save_login_prompt');
  });

  it('returns cookie_consent when accept button present', async () => {
    const page = makePage({ url: LOGIN_URL, selectors: { [COOKIE]: 1 } });
    expect(await classifyLoginScreen(page)).toBe('cookie_consent');
  });

  it('returns unknown when nothing matches', async () => {
    const page = makePage({ url: LOGIN_URL });
    expect(await classifyLoginScreen(page)).toBe('unknown');
  });

  it('priority: home_feed wins over cookie_consent', async () => {
    const page = makePage({
      url: HOME_URL,
      selectors: { [FEED]: 1, [CHROME]: 1, [COOKIE]: 1 },
    });
    expect(await classifyLoginScreen(page)).toBe('home_feed');
  });

  it('priority: checkpoint wins over captcha', async () => {
    const page = makePage({
      url: CHECKPOINT_URL,
      selectors: { [CAPTCHA]: 1 },
    });
    expect(await classifyLoginScreen(page)).toBe('checkpoint');
  });
});
