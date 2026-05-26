import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Page } from 'playwright';
import { attemptLogin, SELECTORS } from '../login';

interface ScriptedPage {
  page: Page;
  fillCalls: { selector: string; value: string }[];
  clickCalls: string[];
  pressCalls: string[];
}

function makeScriptedPage(states: {
  /** Sequence of URLs / selector maps the page transitions through. Index advances on each navigation. */
  steps: Array<{ url: string; selectors?: Record<string, number>; continueHits?: number }>;
}): ScriptedPage {
  let stepIndex = 0;
  const fillCalls: { selector: string; value: string }[] = [];
  const clickCalls: string[] = [];
  const pressCalls: string[] = [];

  function current() {
    return states.steps[Math.min(stepIndex, states.steps.length - 1)];
  }

  function advance() {
    if (stepIndex < states.steps.length - 1) stepIndex++;
  }

  function makeLocator(selector: string) {
    return {
      count: vi.fn().mockImplementation(async () => current().selectors?.[selector] ?? 0),
      first: vi.fn().mockReturnThis(),
      fill: vi.fn().mockImplementation(async (value: string) => {
        fillCalls.push({ selector, value });
      }),
      click: vi.fn().mockImplementation(async () => {
        clickCalls.push(selector);
        advance();
      }),
      filter: vi.fn().mockImplementation(() => makeLocator(selector + ':filtered')),
    };
  }

  const continueLocator = {
    count: vi.fn().mockImplementation(async () => current().continueHits ?? 0),
    first: vi.fn().mockReturnThis(),
    click: vi.fn().mockImplementation(async () => {
      clickCalls.push('continue_as_user');
      advance();
    }),
    filter: vi.fn().mockImplementation(() => continueLocator),
  };

  const page = {
    url: () => current().url,
    locator: vi.fn((selector: string) => {
      if (
        selector === 'div[role="button"]' ||
        selector === 'span' ||
        selector === 'a[role="button"][href*="login_redirect"]'
      ) {
        return continueLocator;
      }
      return makeLocator(selector);
    }),
    getByRole: vi.fn(() => continueLocator),
    keyboard: {
      press: vi.fn().mockImplementation(async (key: string) => {
        pressCalls.push(key);
        advance();
      }),
    },
    waitForLoadState: vi.fn().mockResolvedValue(undefined),
  } as unknown as Page;

  return { page, fillCalls, clickCalls, pressCalls };
}

describe('attemptLogin', () => {
  const EMAIL_SEL = 'input[name="email"]';
  const PASSWORD_SEL = 'input[name="pass"]';
  const FEED = '[role="feed"], [role="main"]';
  const HOME_URL = 'https://www.facebook.com/';
  const LOGIN_URL = 'https://www.facebook.com/login/';

  let logSpy: ReturnType<typeof vi.spyOn>;
  let captured: string[];

  beforeEach(() => {
    captured = [];
    logSpy = vi.spyOn(console, 'log').mockImplementation((line: string) => {
      captured.push(typeof line === 'string' ? line : JSON.stringify(line));
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('full_login → home_feed succeeds and types email + password', async () => {
    const scripted = makeScriptedPage({
      steps: [
        { url: LOGIN_URL, selectors: { [EMAIL_SEL]: 1, [PASSWORD_SEL]: 1 } },
        { url: HOME_URL, selectors: { [FEED]: 1 } },
      ],
    });

    const out = await attemptLogin(scripted.page, {
      email: 'user@example.com',
      password: 's3cret',
    });

    expect(out).toEqual({ success: true });
    const filled = scripted.fillCalls.map((c) => c.value);
    expect(filled).toContain('user@example.com');
    expect(filled).toContain('s3cret');
  });

  it('continue_as_user → home_feed succeeds without typing password', async () => {
    const scripted = makeScriptedPage({
      steps: [
        { url: LOGIN_URL, continueHits: 1 },
        { url: HOME_URL, selectors: { [FEED]: 1 } },
      ],
    });

    const out = await attemptLogin(scripted.page, {
      email: 'user@example.com',
      password: 's3cret',
    });

    expect(out).toEqual({ success: true });
    const filled = scripted.fillCalls.map((c) => c.value);
    expect(filled).not.toContain('s3cret');
  });

  it('continue_as_user → password_only → home_feed succeeds', async () => {
    const scripted = makeScriptedPage({
      steps: [
        { url: LOGIN_URL, continueHits: 1 },
        { url: LOGIN_URL, selectors: { [PASSWORD_SEL]: 1 } },
        { url: HOME_URL, selectors: { [FEED]: 1 } },
      ],
    });

    const out = await attemptLogin(scripted.page, {
      email: 'user@example.com',
      password: 's3cret',
    });

    expect(out).toEqual({ success: true });
    const filled = scripted.fillCalls.map((c) => c.value);
    expect(filled).toContain('s3cret');
    expect(filled).not.toContain('user@example.com');
  });

  it('full_login → invalid_credentials returns invalid_credentials', async () => {
    const INVALID = SELECTORS.invalidCredentialsBanner;
    const scripted = makeScriptedPage({
      steps: [
        { url: LOGIN_URL, selectors: { [EMAIL_SEL]: 1, [PASSWORD_SEL]: 1 } },
        {
          url: LOGIN_URL,
          selectors: { [EMAIL_SEL]: 1, [PASSWORD_SEL]: 1, [INVALID]: 1 },
        },
      ],
    });

    const out = await attemptLogin(scripted.page, {
      email: 'user@example.com',
      password: 'wrong',
    });

    expect(out).toEqual({ success: false, reason: 'invalid_credentials' });
  });

  it('checkpoint detected first → returns checkpoint, no clicks', async () => {
    const scripted = makeScriptedPage({
      steps: [{ url: 'https://www.facebook.com/checkpoint/123/' }],
    });

    const out = await attemptLogin(scripted.page, {
      email: 'user@example.com',
      password: 's3cret',
    });

    expect(out).toEqual({ success: false, reason: 'checkpoint' });
    expect(scripted.clickCalls).toHaveLength(0);
  });

  it('captcha detected → returns captcha, no clicks', async () => {
    const CAPTCHA = SELECTORS.captcha;
    const scripted = makeScriptedPage({
      steps: [{ url: LOGIN_URL, selectors: { [CAPTCHA]: 1 } }],
    });

    const out = await attemptLogin(scripted.page, {
      email: 'a@b.com',
      password: 'p',
    });
    expect(out).toEqual({ success: false, reason: 'captcha' });
    expect(scripted.clickCalls).toHaveLength(0);
  });

  it('two_factor URL → returns two_factor, no clicks', async () => {
    const scripted = makeScriptedPage({
      steps: [{ url: 'https://www.facebook.com/two_step_verification/' }],
    });
    const out = await attemptLogin(scripted.page, {
      email: 'a@b.com',
      password: 'p',
    });
    expect(out).toEqual({ success: false, reason: 'two_factor' });
    expect(scripted.clickCalls).toHaveLength(0);
  });

  it('no-progress (same state twice) → unknown_login_page', async () => {
    const scripted = makeScriptedPage({
      steps: [
        { url: LOGIN_URL, selectors: { [EMAIL_SEL]: 1, [PASSWORD_SEL]: 1 } },
        { url: LOGIN_URL, selectors: { [EMAIL_SEL]: 1, [PASSWORD_SEL]: 1 } },
      ],
    });

    const out = await attemptLogin(scripted.page, {
      email: 'a@b.com',
      password: 'p',
    });

    expect(out).toEqual({ success: false, reason: 'unknown_login_page' });
  });

  it('step cap exceeded → unknown_login_page', async () => {
    const scripted = makeScriptedPage({
      steps: [{ url: LOGIN_URL, continueHits: 1 }],
    });
    const out = await attemptLogin(
      scripted.page,
      { email: 'a@b.com', password: 'p' },
      { maxSteps: 1 }
    );

    expect(out.success).toBe(false);
    if (!out.success) expect(out.reason).toBe('unknown_login_page');
  });

  it('credential-leak guard: no console.log call contains the email or password', async () => {
    const scripted = makeScriptedPage({
      steps: [
        { url: LOGIN_URL, selectors: { [EMAIL_SEL]: 1, [PASSWORD_SEL]: 1 } },
        { url: HOME_URL, selectors: { [FEED]: 1 } },
      ],
    });

    const email = 'leaktest+canary@example.com';
    const password = 'verysecret_canary_42';

    await attemptLogin(scripted.page, { email, password });

    for (const line of captured) {
      expect(line).not.toContain(email);
      expect(line).not.toContain(password);
    }
  });
});
