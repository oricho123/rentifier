import { describe, it, expect } from 'vitest';
import { parseGroupPage, parseRelativeTime, extractPostId } from '../parser';

describe('extractPostId', () => {
  it('extracts from permalink URL', () => {
    expect(extractPostId('/groups/123/permalink/456789/')).toBe('456789');
  });

  it('extracts from story.php URL', () => {
    expect(extractPostId('/story.php?story_fbid=789012&id=123')).toBe('789012');
  });

  it('returns null for unrecognized URL', () => {
    expect(extractPostId('/some/other/path')).toBeNull();
  });
});

describe('parseRelativeTime', () => {
  it('parses "Just now"', () => {
    const result = parseRelativeTime('Just now');
    expect(result).not.toBeNull();
    const diff = Date.now() - new Date(result!).getTime();
    expect(diff).toBeLessThan(5000);
  });

  it('parses "5 mins"', () => {
    const result = parseRelativeTime('5 mins');
    expect(result).not.toBeNull();
    const diff = Date.now() - new Date(result!).getTime();
    // Should be approximately 5 minutes (with some tolerance)
    expect(diff).toBeGreaterThan(4 * 60_000);
    expect(diff).toBeLessThan(6 * 60_000);
  });

  it('parses "2 hrs"', () => {
    const result = parseRelativeTime('2 hrs');
    expect(result).not.toBeNull();
    const diff = Date.now() - new Date(result!).getTime();
    expect(diff).toBeGreaterThan(1.9 * 3_600_000);
    expect(diff).toBeLessThan(2.1 * 3_600_000);
  });

  it('parses "Yesterday"', () => {
    const result = parseRelativeTime('Yesterday at 3:00 PM');
    expect(result).not.toBeNull();
    const diff = Date.now() - new Date(result!).getTime();
    expect(diff).toBeGreaterThan(20 * 3_600_000);
    expect(diff).toBeLessThan(30 * 3_600_000);
  });

  it('returns null for unparseable text', () => {
    expect(parseRelativeTime('March 1 at 2:00 PM')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseRelativeTime('')).toBeNull();
  });
});

describe('parseGroupPage', () => {
  const GROUP_ID = '123456789';

  it('parses posts from HTML with article elements', () => {
    const html = `
      <html><body>
        <div id="m_group_stories_container">
          <article>
            <a href="/user/111">John Doe</a>
            <p>דירת 3 חדרים להשכרה בתל אביב, 5000 שח לחודש</p>
            <a href="/groups/${GROUP_ID}/permalink/100001/">2 hrs</a>
            <abbr>2 hrs</abbr>
          </article>
          <article>
            <a href="/user/222">Jane Smith</a>
            <p>סטודיו בירושלים, 3500 שח</p>
            <a href="/groups/${GROUP_ID}/permalink/100002/">5 mins</a>
            <abbr>5 mins</abbr>
            <img src="https://scontent.fcdn.net/image.jpg" />
          </article>
        </div>
      </body></html>
    `;

    const result = parseGroupPage(html, GROUP_ID);
    expect(result.posts).toHaveLength(2);

    expect(result.posts[0].postId).toBe('100001');
    expect(result.posts[0].content).toContain('3 חדרים');
    expect(result.posts[0].postedAt).not.toBeNull();

    expect(result.posts[1].postId).toBe('100002');
    expect(result.posts[1].content).toContain('סטודיו');
    expect(result.posts[1].imageUrl).toBe('https://scontent.fcdn.net/image.jpg');
  });

  it('handles empty group page', () => {
    const html = '<html><body><div>No posts here</div></body></html>';
    const result = parseGroupPage(html, GROUP_ID);
    expect(result.posts).toHaveLength(0);
  });

  it('extracts pagination link', () => {
    const html = `
      <html><body>
        <article>
          <p>Some post content here that is long enough</p>
          <a href="/groups/${GROUP_ID}/permalink/100001/">1 hr</a>
          <abbr>1 hr</abbr>
        </article>
        <a href="/groups/${GROUP_ID}?bacr=123&cursor=abc">See more posts</a>
      </body></html>
    `;

    const result = parseGroupPage(html, GROUP_ID);
    expect(result.nextPageUrl).toContain('cursor=abc');
  });

  it('skips posts without permalink', () => {
    const html = `
      <html><body>
        <article>
          <p>A post without any permalink link</p>
        </article>
      </body></html>
    `;

    const result = parseGroupPage(html, GROUP_ID);
    expect(result.posts).toHaveLength(0);
  });
});
