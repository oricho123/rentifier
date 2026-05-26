import { describe, expect, it } from 'vitest';
import { buildAlertMessage, getConnectorLoginOutcome } from '../lib/fb-alerts';

describe('buildAlertMessage', () => {
  it('uses default cookie-expired text when no loginOutcome', () => {
    const msg = buildAlertMessage('1', 'auth_expired');
    expect(msg).toContain('cookie expired');
    expect(msg).toContain('FB_COOKIES_1');
  });

  it('uses banned/challenged text when errorType=banned and no loginOutcome', () => {
    const msg = buildAlertMessage('2', 'banned');
    expect(msg).toContain('banned/challenged');
    expect(msg).toContain('FB_COOKIES_2');
  });

  it('invalid_credentials → mentions FB_PASSWORD_N and credentials rejected', () => {
    const msg = buildAlertMessage('1', 'auth_expired', {
      success: false,
      reason: 'invalid_credentials',
    });
    expect(msg).toContain('credentials rejected');
    expect(msg).toContain('FB_PASSWORD_1');
  });

  it('checkpoint → asks operator to resolve in browser', () => {
    const msg = buildAlertMessage('1', 'banned', {
      success: false,
      reason: 'checkpoint',
    });
    expect(msg).toContain('checkpoint');
    expect(msg).toContain('Resolve in a browser');
  });

  it('captcha → no HTML/screenshot dump, just hint', () => {
    const msg = buildAlertMessage('1', 'auth_expired', {
      success: false,
      reason: 'captcha',
    });
    expect(msg).toContain('captcha');
    expect(msg).not.toMatch(/<[a-z]+/);
  });

  it('two_factor → flags account as no longer compatible', () => {
    const msg = buildAlertMessage('1', 'auth_expired', {
      success: false,
      reason: 'two_factor',
    });
    expect(msg).toContain('2FA');
    expect(msg).toContain('no longer compatible');
  });

  it('unknown_login_page → mentions selectors did not match', () => {
    const msg = buildAlertMessage('1', 'auth_expired', {
      success: false,
      reason: 'unknown_login_page',
    });
    expect(msg).toContain('selectors did not match');
  });

  it('timeout → mentions transient + retry', () => {
    const msg = buildAlertMessage('1', 'auth_expired', {
      success: false,
      reason: 'timeout',
    });
    expect(msg).toContain('timed out');
    expect(msg).toContain('transient');
  });

  it('budget_exhausted → mentions 24h backoff', () => {
    const msg = buildAlertMessage('1', 'auth_expired', {
      success: false,
      reason: 'budget_exhausted',
    });
    expect(msg).toContain('budget exhausted');
    expect(msg).toContain('24h');
  });
});

describe('getConnectorLoginOutcome', () => {
  it('returns the loginOutcome property when present', () => {
    const err = Object.assign(new Error('x'), {
      loginOutcome: { success: false, reason: 'invalid_credentials' as const },
    });
    expect(getConnectorLoginOutcome(err)).toEqual({
      success: false,
      reason: 'invalid_credentials',
    });
  });

  it('returns undefined when loginOutcome absent', () => {
    expect(getConnectorLoginOutcome(new Error('x'))).toBeUndefined();
  });

  it('returns undefined for non-Error values', () => {
    expect(getConnectorLoginOutcome('not-an-error')).toBeUndefined();
    expect(getConnectorLoginOutcome(undefined)).toBeUndefined();
  });
});
