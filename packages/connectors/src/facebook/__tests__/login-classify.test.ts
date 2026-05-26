import { describe, expect, it, vi } from 'vitest';
import type { Page } from 'playwright';
import { classifyLoginScreen } from '../login';

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
      if (selector === 'a[role="button"][href*="login_redirect"]') {
        return continueLocator;
      }
      return {
        count: vi.fn().mockResolvedValue(sel[selector] ?? 0),
        first: vi.fn().mockReturnThis(),
      };
    }),
    getByRole: vi.fn(() => continueLocator),
  } as unknown as Page;

  return page;
}

describe('classifyLoginScreen', () => {
  const FEED = '[role="feed"], [role="main"]';
  const EMAIL = 'input[name="email"]';
  const PASSWORD = 'input[name="pass"]';
  const CHECKPOINT_URL = 'https://www.facebook.com/checkpoint/123/';
  const TWO_FACTOR_URL = 'https://www.facebook.com/two_step_verification/';
  const LOGIN_URL = 'https://www.facebook.com/login/';
  const HOME_URL = 'https://www.facebook.com/';
  const CAPTCHA = 'iframe[src*="captcha"], iframe[title*="captcha" i], img[src*="captcha"]';
  const TWO_FACTOR = 'input[name="approvals_code"], #approvals_code, [data-testid="2fa_input"]';
  const SAVE_LOGIN =
    '[aria-label="Not Now"], [aria-label="Not now"], a[href*="/login/save-device/cancel/"]';
  const COOKIE =
    '[data-cookiebanner="accept_button"], [data-testid="cookie-policy-manage-dialog-accept-button"]';
  const INVALID =
    '[data-testid="login_error"], div[role="alert"]:has-text("incorrect"), div[role="alert"]:has-text("password you entered")';

  it('returns home_feed when on home and feed root present', async () => {
    const page = makePage({ url: HOME_URL, selectors: { [FEED]: 1 } });
    expect(await classifyLoginScreen(page)).toBe('home_feed');
  });

  it('returns checkpoint when URL contains /checkpoint/', async () => {
    const page = makePage({ url: CHECKPOINT_URL });
    expect(await classifyLoginScreen(page)).toBe('checkpoint');
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
      selectors: { [FEED]: 1, [COOKIE]: 1 },
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
