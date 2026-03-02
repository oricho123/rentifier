import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { extractTokensFromHomepage, FacebookClientError } from '../client';

describe('extractTokensFromHomepage', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockHomepage(html: string) {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(html),
    });
  }

  it('extracts tokens from DTSGInitData pattern', async () => {
    mockHomepage(
      '...{"DTSGInitData":[],"token":"abc123_dtsg"}...' +
        '..."LSD",[],{"token":"lsd_token_1"},"lsd_val_1"]...',
    );

    const result = await extractTokensFromHomepage('c_user=123; xs=abc');

    expect(result.fbDtsg).toBe('abc123_dtsg');
    expect(result.lsd).toBe('lsd_val_1');
  });

  it('extracts tokens from form input pattern', async () => {
    mockHomepage(
      '<input type="hidden" name="fb_dtsg" value="form_dtsg_value" />' +
        '<input type="hidden" name="lsd" value="form_lsd_value" />',
    );

    const result = await extractTokensFromHomepage('c_user=123; xs=abc');

    expect(result.fbDtsg).toBe('form_dtsg_value');
    expect(result.lsd).toBe('form_lsd_value');
  });

  it('extracts tokens from dtsg.token pattern', async () => {
    mockHomepage(
      '..."dtsg":{"token":"nested_dtsg_tok"}...' +
        '<input type="hidden" name="lsd" value="nested_lsd" />',
    );

    const result = await extractTokensFromHomepage('c_user=123; xs=abc');

    expect(result.fbDtsg).toBe('nested_dtsg_tok');
    expect(result.lsd).toBe('nested_lsd');
  });

  it('returns empty lsd when lsd not found', async () => {
    mockHomepage('...{"DTSGInitData":[],"token":"dtsg_only"}...');

    const result = await extractTokensFromHomepage('c_user=123; xs=abc');

    expect(result.fbDtsg).toBe('dtsg_only');
    expect(result.lsd).toBe('');
  });

  it('throws auth_expired on login page', async () => {
    mockHomepage('<form id="login_form"><input name="email" /></form>');

    try {
      await extractTokensFromHomepage('c_user=123; xs=abc');
      expect.fail('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(FacebookClientError);
      expect((e as FacebookClientError).errorType).toBe('auth_expired');
    }
  });

  it('throws banned on checkpoint page', async () => {
    mockHomepage(
      '<div>Your account has been locked.</div><a href="/checkpoint/block/">Verify</a>',
    );

    try {
      await extractTokensFromHomepage('c_user=123; xs=abc');
      expect.fail('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(FacebookClientError);
      expect((e as FacebookClientError).errorType).toBe('banned');
    }
  });

  it('throws parse error when no patterns match', async () => {
    mockHomepage('<html><body>Some page with no tokens</body></html>');

    try {
      await extractTokensFromHomepage('c_user=123; xs=abc');
      expect.fail('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(FacebookClientError);
      expect((e as FacebookClientError).errorType).toBe('parse');
    }
  });

  it('throws network error on HTTP failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    try {
      await extractTokensFromHomepage('c_user=123; xs=abc');
      expect.fail('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(FacebookClientError);
      expect((e as FacebookClientError).errorType).toBe('network');
    }
  });
});
