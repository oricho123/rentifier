import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectAuthFailure, extractPostsFromDOM, FacebookClientError } from '../client';
import { parseCookieString } from '../accounts';

describe('parseCookieString', () => {
  it('parses basic cookie string', () => {
    const result = parseCookieString('c_user=123; xs=abc');
    expect(result).toEqual([
      { name: 'c_user', value: '123', domain: '.facebook.com', path: '/' },
      { name: 'xs', value: 'abc', domain: '.facebook.com', path: '/' },
    ]);
  });

  it('handles values with equals signs', () => {
    const result = parseCookieString('token=abc=def=ghi');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('token');
    expect(result[0].value).toBe('abc=def=ghi');
  });

  it('handles extra whitespace', () => {
    const result = parseCookieString('  c_user = 123 ;  xs = abc  ');
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('c_user');
    expect(result[0].value).toBe('123');
  });

  it('returns empty array for empty string', () => {
    const result = parseCookieString('');
    expect(result).toHaveLength(0);
  });

  it('skips entries without equals sign', () => {
    const result = parseCookieString('c_user=123; invalid; xs=abc');
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('c_user');
    expect(result[1].name).toBe('xs');
  });
});

describe('detectAuthFailure', () => {
  function mockPage(url: string, hasLoginForm = false) {
    return {
      url: () => url,
      $: vi.fn().mockResolvedValue(hasLoginForm ? {} : null),
    } as any;
  }

  it('detects login page redirect', async () => {
    const page = mockPage('https://www.facebook.com/login/?next=...');
    const result = await detectAuthFailure(page);
    expect(result).toBe('auth_expired');
  });

  it('detects login.php redirect', async () => {
    const page = mockPage('https://www.facebook.com/login.php?login_attempt=1');
    const result = await detectAuthFailure(page);
    expect(result).toBe('auth_expired');
  });

  it('detects checkpoint redirect', async () => {
    const page = mockPage('https://www.facebook.com/checkpoint/block/?id=123');
    const result = await detectAuthFailure(page);
    expect(result).toBe('banned');
  });

  it('detects login form in page content', async () => {
    const page = mockPage('https://www.facebook.com/', true);
    const result = await detectAuthFailure(page);
    expect(result).toBe('auth_expired');
  });

  it('returns null for normal page', async () => {
    const page = mockPage('https://www.facebook.com/groups/123');
    const result = await detectAuthFailure(page);
    expect(result).toBeNull();
  });
});

describe('extractPostsFromDOM', () => {
  function mockPageWithPosts(posts: any[]) {
    return {
      $: vi.fn().mockResolvedValue({}), // feed exists
      evaluate: vi.fn().mockResolvedValue(posts),
    } as any;
  }

  function mockPageWithoutFeed() {
    return {
      $: vi.fn().mockResolvedValue(null),
      url: vi.fn().mockReturnValue('https://www.facebook.com/groups/123'),
    } as any;
  }

  it('returns posts from page.evaluate result', async () => {
    const mockPosts = [
      {
        postId: '100001',
        authorName: 'Alice',
        content: 'דירת 3 חדרים להשכרה בתל אביב',
        permalink: 'https://www.facebook.com/groups/123/posts/100001/',
        postedAt: '2026-03-03T10:00:00.000Z',
        imageUrl: 'https://scontent.fcdn.net/img.jpg',
        groupId: '123',
      },
      {
        postId: '100002',
        authorName: 'Bob',
        content: 'סטודיו בירושלים 3500 שח לחודש',
        permalink: 'https://www.facebook.com/groups/123/posts/100002/',
        postedAt: '2026-03-03T10:05:00.000Z',
        imageUrl: null,
        groupId: '123',
      },
    ];

    const page = mockPageWithPosts(mockPosts);
    const result = await extractPostsFromDOM(page, '123');

    expect(result).toHaveLength(2);
    expect(result[0].postId).toBe('100001');
    expect(result[0].authorName).toBe('Alice');
    expect(result[0].content).toContain('3 חדרים');
    expect(result[1].postId).toBe('100002');
    expect(result[1].authorName).toBe('Bob');
  });

  it('returns empty array when feed is not found', async () => {
    const page = mockPageWithoutFeed();
    const result = await extractPostsFromDOM(page, '123');
    expect(result).toHaveLength(0);
  });

  it('returns empty array when evaluate returns non-array', async () => {
    const page = {
      $: vi.fn().mockResolvedValue({}),
      evaluate: vi.fn().mockResolvedValue(null),
    } as any;

    const result = await extractPostsFromDOM(page, '123');
    expect(result).toHaveLength(0);
  });
});

describe('FacebookClientError', () => {
  it('sets properties correctly', () => {
    const error = new FacebookClientError('test error', 'auth_expired', false);
    expect(error.message).toBe('test error');
    expect(error.errorType).toBe('auth_expired');
    expect(error.retryable).toBe(false);
    expect(error.name).toBe('FacebookClientError');
  });

  it('is an instance of Error', () => {
    const error = new FacebookClientError('test', 'network', true);
    expect(error).toBeInstanceOf(Error);
  });
});
