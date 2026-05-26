import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isAutoLoginEnabled, loadCredentials } from '../credentials';

const ENV_KEYS = [
  'FB_AUTO_LOGIN_ENABLED',
  'FB_EMAIL',
  'FB_PASSWORD',
  'FB_EMAIL_1',
  'FB_PASSWORD_1',
  'FB_EMAIL_2',
  'FB_PASSWORD_2',
  'FB_ACCOUNT_COUNT',
];

describe('isAutoLoginEnabled', () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('returns false when unset', () => {
    expect(isAutoLoginEnabled()).toBe(false);
  });

  it('returns false when empty', () => {
    process.env.FB_AUTO_LOGIN_ENABLED = '';
    expect(isAutoLoginEnabled()).toBe(false);
  });

  it('returns false for "false"', () => {
    process.env.FB_AUTO_LOGIN_ENABLED = 'false';
    expect(isAutoLoginEnabled()).toBe(false);
  });

  it('returns false for "True" (case-sensitive)', () => {
    process.env.FB_AUTO_LOGIN_ENABLED = 'True';
    expect(isAutoLoginEnabled()).toBe(false);
  });

  it('returns true for "true"', () => {
    process.env.FB_AUTO_LOGIN_ENABLED = 'true';
    expect(isAutoLoginEnabled()).toBe(true);
  });
});

describe('loadCredentials', () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('returns scoped credentials when both set', () => {
    process.env.FB_EMAIL_1 = 'a@b.com';
    process.env.FB_PASSWORD_1 = 'pw';
    expect(loadCredentials('1')).toEqual({ email: 'a@b.com', password: 'pw' });
  });

  it('returns null when only scoped email set', () => {
    process.env.FB_EMAIL_1 = 'a@b.com';
    expect(loadCredentials('1')).toBeNull();
  });

  it('returns null when only scoped password set', () => {
    process.env.FB_PASSWORD_1 = 'pw';
    expect(loadCredentials('1')).toBeNull();
  });

  it('falls back to shared when scoped unset and FB_ACCOUNT_COUNT=1', () => {
    process.env.FB_EMAIL = 'shared@b.com';
    process.env.FB_PASSWORD = 'sharedpw';
    process.env.FB_ACCOUNT_COUNT = '1';
    expect(loadCredentials('1')).toEqual({
      email: 'shared@b.com',
      password: 'sharedpw',
    });
  });

  it('does not fall back to shared when FB_ACCOUNT_COUNT=2', () => {
    process.env.FB_EMAIL = 'shared@b.com';
    process.env.FB_PASSWORD = 'sharedpw';
    process.env.FB_ACCOUNT_COUNT = '2';
    expect(loadCredentials('1')).toBeNull();
  });

  it('returns null when nothing set', () => {
    expect(loadCredentials('1')).toBeNull();
  });

  it('scoped wins over shared', () => {
    process.env.FB_EMAIL = 'shared@b.com';
    process.env.FB_PASSWORD = 'sharedpw';
    process.env.FB_EMAIL_1 = 'scoped@b.com';
    process.env.FB_PASSWORD_1 = 'scopedpw';
    process.env.FB_ACCOUNT_COUNT = '1';
    expect(loadCredentials('1')).toEqual({
      email: 'scoped@b.com',
      password: 'scopedpw',
    });
  });

  it('returns scoped for accountId=2 when both set', () => {
    process.env.FB_EMAIL_2 = 'two@b.com';
    process.env.FB_PASSWORD_2 = 'pw2';
    expect(loadCredentials('2')).toEqual({
      email: 'two@b.com',
      password: 'pw2',
    });
  });
});
