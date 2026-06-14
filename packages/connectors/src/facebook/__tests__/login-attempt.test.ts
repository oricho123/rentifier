import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Page } from 'playwright';
import { attemptLogin, SELECTORS } from '../login';

interface ScriptedPage {
  page: Page;
  fillCalls: { selector: string; value: string }[];
  /** Separate from fillCalls — tracks pressSequentially specifically so P9 tests can prove human-typing. */
  typeCalls: { selector: string; value: string }[];
  clickCalls: string[];
  pressCalls: string[];
}

function makeScriptedPage(states: {
  /** Sequence of URLs / selector maps the page transitions through. Index advances on each navigation. */
  steps: Array<{ url: string; selectors?: Record<string, number>; continueHits?: number }>;
}): ScriptedPage {
  let stepIndex = 0;
  const fillCalls: { selector: string; value: string }[] = [];
  const typeCalls: { selector: string; value: string }[] = [];
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
      // Human-like keystroke entry — value lands in fillCalls (so existing
      // success-path assertions still match) AND typeCalls (so P9 tests can
      // prove pressSequentially was used instead of fill).
      pressSequentially: vi.fn().mockImplementation(async (value: string) => {
        fillCalls.push({ selector, value });
        typeCalls.push({ selector, value });
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
      if (selector === SELECTORS.continueAsButton || selector === SELECTORS.savedSessionShortcut) {
        return continueLocator;
      }
      return makeLocator(selector);
    }),
    getByRole: vi.fn(() => ({
      count: vi.fn().mockResolvedValue(0),
      first: vi.fn().mockReturnThis(),
    })),
    keyboard: {
      press: vi.fn().mockImplementation(async (key: string) => {
        pressCalls.push(key);
        advance();
      }),
    },
    waitForLoadState: vi.fn().mockResolvedValue(undefined),
    // Human-like pause between password entry and submit — no-op in tests.
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    // Resolving the login-redirect interstitial advances to the next scripted step,
    // mirroring the real page navigating away from the crypted_string URL.
    waitForURL: vi.fn().mockImplementation(async () => {
      advance();
    }),
    // A real navigation also advances steps — used by saved-session recovery
    // (force-navigate to the credential-login URL) and the redirecting fallback.
    goto: vi.fn().mockImplementation(async () => {
      advance();
    }),
  } as unknown as Page;

  return { page, fillCalls, typeCalls, clickCalls, pressCalls };
}

describe('attemptLogin', () => {
  const EMAIL_SEL = SELECTORS.emailInput;
  const PASSWORD_SEL = SELECTORS.passwordInput;
  const FEED = SELECTORS.feedRoot;
  const CHROME = SELECTORS.loggedInChrome;
  const HOME_URL = 'https://www.facebook.com/';
  const LOGIN_URL = 'https://www.facebook.com/login/';
  const REDIRECT_URL = 'https://www.facebook.com/?crypted_string=AYjTOKEN&next=x';

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
        { url: HOME_URL, selectors: { [FEED]: 1, [CHROME]: 1 } },
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
        { url: HOME_URL, selectors: { [FEED]: 1, [CHROME]: 1 } },
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
        { url: HOME_URL, selectors: { [FEED]: 1, [CHROME]: 1 } },
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

  it('continue_as_user → redirecting → full_login → home_feed self-heals with credentials', async () => {
    const scripted = makeScriptedPage({
      steps: [
        { url: LOGIN_URL, continueHits: 1 },
        { url: REDIRECT_URL, selectors: { [FEED]: 1 } },
        { url: LOGIN_URL, selectors: { [EMAIL_SEL]: 1, [PASSWORD_SEL]: 1 } },
        { url: HOME_URL, selectors: { [FEED]: 1, [CHROME]: 1 } },
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

  it('does NOT emit fb_login_success while URL still carries crypted_string', async () => {
    const scripted = makeScriptedPage({
      steps: [
        { url: REDIRECT_URL, selectors: { [FEED]: 1 } },
        { url: HOME_URL, selectors: { [FEED]: 1, [CHROME]: 1 } },
      ],
    });

    await attemptLogin(scripted.page, { email: 'a@b.com', password: 'p' });

    // The interstitial step is classified as `redirecting`, never accepted as success.
    const interstitialStep = captured.find(
      (l) => l.includes('fb_login_step') && l.includes('crypted_string')
    );
    expect(interstitialStep).toBeDefined();
    expect(interstitialStep).toContain('"state":"redirecting"');
    // Success is only emitted once we are off the interstitial (no crypted_string).
    const successLogs = captured.filter((l) => l.includes('fb_login_success'));
    expect(successLogs.length).toBeGreaterThan(0);
    for (const line of successLogs) {
      expect(line).not.toContain('crypted_string');
    }
  });

  it('redirecting that never resolves → unknown_login_page (no loop)', async () => {
    const scripted = makeScriptedPage({
      steps: [
        { url: REDIRECT_URL, selectors: { [FEED]: 1 } },
        { url: REDIRECT_URL, selectors: { [FEED]: 1 } },
      ],
    });

    const out = await attemptLogin(scripted.page, { email: 'a@b.com', password: 'p' });

    expect(out).toEqual({ success: false, reason: 'unknown_login_page' });
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

  it('saved-session fakeout: continue_as_user → unknown landing page → recovers via force-credential URL → home_feed', async () => {
    // Reproduces the production failure: "Continue as <user>" click on a dead
    // server-side session bounces through crypted_string and lands on a page
    // with feed root but no logged-in chrome (logged-out splash before email/
    // pass hydrate, or a partial-auth shell). Classifier returns `unknown` —
    // attemptLogin should force-navigate to the clean credential URL and the
    // existing full_login handler then takes over.
    const scripted = makeScriptedPage({
      steps: [
        { url: LOGIN_URL, continueHits: 1 },
        // Ambiguous landing: feed root present, no logged-in chrome, no inputs yet.
        { url: HOME_URL, selectors: { [FEED]: 1 } },
        // After force-navigate to FORCE_CREDENTIAL_LOGIN_URL, full_login is exposed.
        { url: LOGIN_URL, selectors: { [EMAIL_SEL]: 1, [PASSWORD_SEL]: 1 } },
        { url: HOME_URL, selectors: { [FEED]: 1, [CHROME]: 1 } },
      ],
    });

    const out = await attemptLogin(scripted.page, {
      email: 'user@example.com',
      password: 's3cret',
    });

    expect(out).toEqual({ success: true });
    expect(captured.some((l) => l.includes('fb_saved_session_invalidated'))).toBe(true);
    const filled = scripted.fillCalls.map((c) => c.value);
    expect(filled).toContain('user@example.com');
    expect(filled).toContain('s3cret');
  });

  it('continue_as_user no-progress (click is a no-op) → recovers via force-credential URL → home_feed', async () => {
    // Reproduces the production 2026-06-08 failure: classifier returned
    // continue_as_user on a fully logged-out /login page (the SSO buttons
    // tripped the old broad regex), the click did nothing, the page stayed on
    // the same continue_as_user classification, and the no-progress guard
    // bailed with `unknown_login_page` before any recovery could fire. The
    // P6 recovery branch force-navigates to the credential URL on the second
    // continue_as_user in a row, so the existing full_login handler runs.
    const scripted = makeScriptedPage({
      steps: [
        // Step 0: classifier sees continue_as_user; clicking the matched
        // locator advances the mock — but step 1 ALSO presents as
        // continue_as_user, so from attemptLogin's perspective the click was
        // a no-op (same state twice).
        { url: LOGIN_URL, continueHits: 1 },
        { url: LOGIN_URL, continueHits: 1 },
        // After the recovery goto(FORCE_CREDENTIAL_LOGIN_URL), the credential
        // form is exposed and the existing full_login handler types creds.
        { url: LOGIN_URL, selectors: { [EMAIL_SEL]: 1, [PASSWORD_SEL]: 1 } },
        { url: HOME_URL, selectors: { [FEED]: 1, [CHROME]: 1 } },
      ],
    });

    const out = await attemptLogin(scripted.page, {
      email: 'user@example.com',
      password: 's3cret',
    });

    expect(out).toEqual({ success: true });
    const recoveryLog = captured.find((l) => l.includes('fb_saved_session_invalidated'));
    expect(recoveryLog).toBeDefined();
    expect(recoveryLog).toContain('no_progress_on_continue_as_user');
    const filled = scripted.fillCalls.map((c) => c.value);
    expect(filled).toContain('user@example.com');
    expect(filled).toContain('s3cret');
  });

  it('continue_as_user no-progress recovery is one-shot — second failure bails as unknown_login_page', async () => {
    // If the force-credential recovery itself lands back on continue_as_user
    // (e.g. FB redirected the credential URL right back to the saved-session
    // chooser), the one-shot flag prevents a recovery loop and the normal
    // no-progress guard bails on the next iteration.
    const scripted = makeScriptedPage({
      steps: [
        { url: LOGIN_URL, continueHits: 1 },
        { url: LOGIN_URL, continueHits: 1 },
        { url: LOGIN_URL, continueHits: 1 },
        { url: LOGIN_URL, continueHits: 1 },
      ],
    });

    const out = await attemptLogin(scripted.page, {
      email: 'a@b.com',
      password: 'p',
    });

    expect(out).toEqual({ success: false, reason: 'unknown_login_page' });
  });

  it('AYMH-style chooser: first-iteration unknown on /login → force-credential recovery → full_login → home_feed', async () => {
    // Reproduces the production 2026-06-11 failure: FB served the AYMH
    // ("Are You My Human?") multi-profile chooser on /login/?next=... — every
    // form input is hidden (crypted_string, lsd, jazoest, aymh_*) and the
    // visible buttons ("Continue <Name>", "Use another profile", "Remove
    // profiles from this browser") don't match the tightened
    // `aria-label^="Continue as"` saved-session selector. Classifier
    // correctly returns `unknown` on step 0 — no false positive — but the
    // pre-P7 recovery only fired after `continue_as_user`/`redirecting`, so
    // step 0 bailed as `unknown_login_page` with no recovery attempt. P7
    // extends the recovery to fire on first-iteration `unknown` whenever the
    // URL is a /login URL.
    const scripted = makeScriptedPage({
      steps: [
        // AYMH chooser: no email/pass input, no continue_as_user button match.
        { url: LOGIN_URL },
        { url: LOGIN_URL, selectors: { [EMAIL_SEL]: 1, [PASSWORD_SEL]: 1 } },
        { url: HOME_URL, selectors: { [FEED]: 1, [CHROME]: 1 } },
      ],
    });

    const out = await attemptLogin(scripted.page, {
      email: 'user@example.com',
      password: 's3cret',
    });

    expect(out).toEqual({ success: true });
    const recoveryLog = captured.find((l) => l.includes('fb_saved_session_invalidated'));
    expect(recoveryLog).toBeDefined();
    expect(recoveryLog).toContain('unknown_on_login_url');
    const filled = scripted.fillCalls.map((c) => c.value);
    expect(filled).toContain('user@example.com');
    expect(filled).toContain('s3cret');
  });

  it('aymh_chooser → click Use another profile → full_login → home_feed', async () => {
    // Reproduces the production 2026-06-14 failure: FB served the AYMH
    // ("Are You My Human?") chooser on /login/?next=... and the P7
    // force-credential URL (login_attempt=1&lwv=110) ALSO returned AYMH
    // because the device cookies were enough to pin the profile. The only
    // reliable escape is clicking the AYMH-internal "Use another profile"
    // button to surface the standard email+password form. The new
    // aymh_chooser state and handler do exactly that.
    const scripted = makeScriptedPage({
      steps: [
        {
          url: LOGIN_URL,
          selectors: { [SELECTORS.aymhMarker]: 1, [SELECTORS.useAnotherProfile]: 1 },
        },
        { url: LOGIN_URL, selectors: { [EMAIL_SEL]: 1, [PASSWORD_SEL]: 1 } },
        { url: HOME_URL, selectors: { [FEED]: 1, [CHROME]: 1 } },
      ],
    });

    const out = await attemptLogin(scripted.page, {
      email: 'user@example.com',
      password: 's3cret',
    });

    expect(out).toEqual({ success: true });
    expect(scripted.clickCalls).toContain(SELECTORS.useAnotherProfile);
    const filled = scripted.fillCalls.map((c) => c.value);
    expect(filled).toContain('user@example.com');
    expect(filled).toContain('s3cret');
  });

  it('aymh_chooser persists (escape button missing) → no-progress bail', async () => {
    // Defense: if FB renders AYMH but the "Use another profile" button is
    // absent (or the click is a no-op), the handler skips the click, the
    // next iteration re-classifies as aymh_chooser, and the standard
    // no-progress guard bails with `unknown_login_page`. We do NOT loop.
    const scripted = makeScriptedPage({
      steps: [
        { url: LOGIN_URL, selectors: { [SELECTORS.aymhMarker]: 1 } },
        { url: LOGIN_URL, selectors: { [SELECTORS.aymhMarker]: 1 } },
      ],
    });

    const out = await attemptLogin(scripted.page, {
      email: 'a@b.com',
      password: 'p',
    });

    expect(out).toEqual({ success: false, reason: 'unknown_login_page' });
  });

  it('first-iteration unknown on a non-/login URL → bails with no recovery', async () => {
    // Defense: the P7 recovery is gated on `/login\b` so we don't blindly
    // force-navigate from random pages. An unknown classification on, e.g.,
    // facebook.com/somewhere/ with no prior saved-session state should bail
    // through the existing fall-through, not invoke recovery.
    const scripted = makeScriptedPage({
      steps: [{ url: 'https://www.facebook.com/somewhere/' }],
    });

    const out = await attemptLogin(scripted.page, {
      email: 'a@b.com',
      password: 'p',
    });

    expect(out).toEqual({ success: false, reason: 'unknown_login_page' });
    expect(captured.some((l) => l.includes('fb_saved_session_invalidated'))).toBe(false);
  });

  it('full_login uses human-like keystroke entry + pause before submit (P9)', async () => {
    // Reproduces the 2026-06-14 silent-rejection failure: P8 escaped AYMH and
    // surfaced full_login, but `fill()` typed creds instantaneously, FB
    // fingerprinted that as bot input and silently re-rendered the same form
    // without a banner. The no-progress guard then bailed. P9 replaces fill()
    // with pressSequentially() (real keystroke events) and adds a brief pause
    // before submit.
    const scripted = makeScriptedPage({
      steps: [
        { url: LOGIN_URL, selectors: { [EMAIL_SEL]: 1, [PASSWORD_SEL]: 1 } },
        { url: HOME_URL, selectors: { [FEED]: 1, [CHROME]: 1 } },
      ],
    });

    const out = await attemptLogin(scripted.page, {
      email: 'user@example.com',
      password: 's3cret',
    });

    expect(out).toEqual({ success: true });
    // Both creds went through pressSequentially, not fill().
    const typed = scripted.typeCalls.map((c) => c.value);
    expect(typed).toContain('user@example.com');
    expect(typed).toContain('s3cret');
    // Human pause between password entry and submit fired.
    expect(scripted.page.waitForTimeout).toHaveBeenCalled();
  });

  it('password_only also uses human-like keystroke entry + pause (P9)', async () => {
    const scripted = makeScriptedPage({
      steps: [
        { url: LOGIN_URL, selectors: { [PASSWORD_SEL]: 1 } },
        { url: HOME_URL, selectors: { [FEED]: 1, [CHROME]: 1 } },
      ],
    });

    const out = await attemptLogin(scripted.page, {
      email: 'user@example.com',
      password: 's3cret',
    });

    expect(out).toEqual({ success: true });
    const typed = scripted.typeCalls.map((c) => c.value);
    expect(typed).toContain('s3cret');
    expect(typed).not.toContain('user@example.com');
    expect(scripted.page.waitForTimeout).toHaveBeenCalled();
  });

  it('credential-leak guard: no console.log call contains the email or password', async () => {
    const scripted = makeScriptedPage({
      steps: [
        { url: LOGIN_URL, selectors: { [EMAIL_SEL]: 1, [PASSWORD_SEL]: 1 } },
        { url: HOME_URL, selectors: { [FEED]: 1, [CHROME]: 1 } },
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
