import * as cheerio from 'cheerio';
import type { FacebookPost, FacebookGroupPageResult } from './types';

/**
 * Relative time string → approximate ISO date.
 * Handles English time strings (accounts must be set to English locale).
 */
export function parseRelativeTime(text: string): string | null {
  if (!text) return null;

  const now = Date.now();
  const t = text.trim().toLowerCase();

  // "Just now" / "1 min"
  if (t === 'just now' || t === 'now') {
    return new Date(now).toISOString();
  }

  // "X mins", "X min"
  const minMatch = t.match(/^(\d+)\s*min/);
  if (minMatch) {
    return new Date(now - parseInt(minMatch[1], 10) * 60_000).toISOString();
  }

  // "X hrs", "X hr"
  const hrMatch = t.match(/^(\d+)\s*hr/);
  if (hrMatch) {
    return new Date(now - parseInt(hrMatch[1], 10) * 3_600_000).toISOString();
  }

  // "Yesterday"
  if (t.includes('yesterday')) {
    return new Date(now - 86_400_000).toISOString();
  }

  // "X days ago" / "X d"
  const dayMatch = t.match(/^(\d+)\s*d/);
  if (dayMatch) {
    return new Date(
      now - parseInt(dayMatch[1], 10) * 86_400_000,
    ).toISOString();
  }

  return null;
}

/**
 * Extract post ID from a Facebook permalink URL.
 * Patterns:
 *   /groups/{gid}/permalink/{pid}/
 *   /story.php?story_fbid={pid}&id=...
 *   /permalink/{pid}/
 */
export function extractPostId(url: string): string | null {
  // /permalink/{pid}/
  const permalinkMatch = url.match(/\/permalink\/(\d+)/);
  if (permalinkMatch) return permalinkMatch[1];

  // /story.php?story_fbid={pid}
  const storyMatch = url.match(/story_fbid=(\d+)/);
  if (storyMatch) return storyMatch[1];

  return null;
}

/**
 * Parse mbasic.facebook.com group page HTML into structured posts.
 *
 * mbasic.facebook.com structure (simplified):
 *   <div id="m_group_stories_container">
 *     <article> or <div data-ft>
 *       <header> → author name + link
 *       <div> → post content text
 *       <footer> → permalink + timestamp
 *       <img> → optional image
 *     </article>
 *   </div>
 *   <a href="..."> → "See more posts" pagination link
 *
 * NOTE: Exact selectors may need adjustment based on real HTML.
 * The parser uses multiple fallback strategies.
 */
export function parseGroupPage(
  html: string,
  groupId: string,
): FacebookGroupPageResult {
  const $ = cheerio.load(html);
  const posts: FacebookPost[] = [];

  // Strategy 1: look for article elements (common mbasic pattern)
  // Strategy 2: look for div[data-ft] elements
  // Strategy 3: look for divs with permalink links inside
  const postElements = $('article').length > 0
    ? $('article')
    : $('div[data-ft]').length > 0
      ? $('div[data-ft]')
      : $('div[id^="u_"]');

  postElements.each((_, el) => {
    const $el = $(el);

    // Extract permalink — the most reliable anchor
    let permalink = '';
    let postId = '';

    // Look for permalink-style links
    $el.find('a[href*="permalink"], a[href*="story.php"]').each((_, link) => {
      const href = $(link).attr('href') || '';
      const id = extractPostId(href);
      if (id) {
        postId = id;
        permalink = href.startsWith('http')
          ? href
          : `https://www.facebook.com${href}`;
      }
    });

    // Skip if no post ID found — can't dedup without it
    if (!postId) return;

    // Extract author name — usually first link in the post
    const authorLink = $el.find('a[href*="profile"], a[href*="user"]').first();
    const authorName = authorLink.text().trim() ||
      $el.find('strong').first().text().trim() ||
      'Unknown';

    // Extract post content — collect text from paragraphs and divs
    // Skip author name, timestamps, and UI elements
    let content = '';
    $el.find('p, div[data-ft] > div > div').each((_, textEl) => {
      const text = $(textEl).text().trim();
      if (text && text !== authorName && text.length > 5) {
        content += (content ? '\n' : '') + text;
      }
    });

    // Fallback: get all text if no structured content found
    if (!content) {
      content = $el.text().trim();
      // Try to remove author name from the beginning
      if (content.startsWith(authorName)) {
        content = content.slice(authorName.length).trim();
      }
    }

    // Skip posts with no meaningful content
    if (!content || content.length < 10) return;

    // Extract timestamp — look for abbr or small time text
    const timeText =
      $el.find('abbr').text().trim() ||
      $el.find('span[data-utime]').text().trim() ||
      '';
    const postedAt = parseRelativeTime(timeText);

    // Extract first image
    const imgSrc =
      $el.find('img[src*="scontent"]').first().attr('src') ||
      $el.find('img[src*="fbcdn"]').first().attr('src') ||
      null;

    posts.push({
      postId,
      authorName,
      content,
      permalink,
      postedAt,
      imageUrl: imgSrc,
      groupId,
    });
  });

  // Canary check: if HTML has content but we found no posts, warn
  if (posts.length === 0 && html.length > 1000) {
    console.log(
      JSON.stringify({
        event: 'fb_parser_canary_failed',
        groupId,
        htmlLength: html.length,
        message:
          'Non-empty HTML yielded 0 posts — selectors may need updating',
      }),
    );
  }

  // Extract pagination ("See more posts" / "See More")
  let nextPageUrl: string | null = null;
  $('a').each((_, link) => {
    const text = $(link).text().trim().toLowerCase();
    const href = $(link).attr('href') || '';
    if (
      (text.includes('see more') || text.includes('more stories')) &&
      href.includes('/groups/')
    ) {
      nextPageUrl = href.startsWith('http')
        ? href
        : `${href}`;
    }
  });

  return { posts, nextPageUrl };
}
