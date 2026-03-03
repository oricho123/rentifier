import type { Browser, BrowserContext, Page } from 'playwright';
import type { FacebookPost } from './types';
import { parseCookieString } from './accounts';
import {
  BROWSER_TIMEOUT_MS,
  FEED_WAIT_TIMEOUT_MS,
  GROUP_URL_TEMPLATE,
  MAX_RETRIES,
  INITIAL_RETRY_DELAY_MS,
} from './constants';

export type FacebookErrorType =
  | 'network'
  | 'auth_expired'
  | 'rate_limited'
  | 'banned'
  | 'parse'
  | 'timeout';

export class FacebookClientError extends Error {
  constructor(
    message: string,
    public readonly errorType: FacebookErrorType,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'FacebookClientError';
  }
}

/**
 * Launch a headless Chromium browser.
 * Uses dynamic import to avoid bundling Playwright into Cloudflare Workers.
 */
export async function launchBrowser(): Promise<Browser> {
  const { chromium } = await import('playwright');
  return chromium.launch({ headless: true });
}

/**
 * Create a browser context with injected cookies.
 * SECURITY: cookies are never logged.
 */
export async function createBrowserContext(
  browser: Browser,
  cookies: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    locale: 'en-US',
  });

  await context.addCookies(parseCookieString(cookies));
  const page = await context.newPage();
  return { context, page };
}

/**
 * Close the browser safely.
 */
export async function closeBrowser(browser: Browser): Promise<void> {
  try {
    await browser.close();
  } catch {
    // Ignore close errors
  }
}

/**
 * Detect auth failures by checking page URL and content.
 */
export async function detectAuthFailure(
  page: Page,
): Promise<FacebookErrorType | null> {
  const url = page.url();

  if (url.includes('/login') || url.includes('login.php')) {
    return 'auth_expired';
  }

  if (url.includes('/checkpoint/')) {
    return 'banned';
  }

  const hasLoginForm = await page.$('#login_form, #loginform');
  if (hasLoginForm) {
    return 'auth_expired';
  }

  return null;
}

/**
 * Navigate to a Facebook group page with chronological sorting.
 */
export async function navigateToGroup(
  page: Page,
  groupId: string,
): Promise<void> {
  const url = GROUP_URL_TEMPLATE.replace('{groupId}', groupId);

  await page.goto(url, {
    waitUntil: 'domcontentloaded',
    timeout: BROWSER_TIMEOUT_MS,
  });

  // Check for auth failure after navigation
  const authError = await detectAuthFailure(page);
  if (authError) {
    throw new FacebookClientError(
      `Auth failure after navigating to group ${groupId}: ${authError}`,
      authError,
      false,
    );
  }

  // Wait for feed to render
  try {
    await page.waitForSelector('[role="feed"]', {
      timeout: FEED_WAIT_TIMEOUT_MS,
    });
  } catch {
    throw new FacebookClientError(
      `Feed did not render within ${FEED_WAIT_TIMEOUT_MS}ms for group ${groupId}`,
      'timeout',
      true,
    );
  }

  // Scroll to trigger lazy loading
  await page.evaluate('window.scrollBy(0, 1000)');
  await page.waitForTimeout(2000);
}

/**
 * Extract posts from the rendered DOM of a Facebook group page.
 *
 * Uses string-based page.evaluate() to avoid tsx __name injection issue.
 * Selectors validated against live Facebook DOM (2026-03-03).
 */
export async function extractPostsFromDOM(
  page: Page,
  groupId: string,
): Promise<FacebookPost[]> {
  const feedExists = await page.$('[role="feed"]');
  if (!feedExists) {
    console.log(
      JSON.stringify({
        event: 'fb_no_feed',
        groupId,
        url: page.url(),
      }),
    );
    return [];
  }

  // Use string-based evaluate to avoid tsx __name injection
  const extractedPosts = await page.evaluate(`((groupId) => {
    var feed = document.querySelector('[role="feed"]');
    if (!feed) return [];
    // Skip first child (sorting widget), take up to 20 posts
    var postElements = Array.from(feed.querySelectorAll(':scope > div')).slice(1, 21);
    var results = [];

    for (var i = 0; i < postElements.length; i++) {
      var node = postElements[i];

      // --- Post text (validated: data-ad-rendering-role="story_message") ---
      var content = null;
      var storyMsg = node.querySelector('[data-ad-rendering-role="story_message"]');
      if (storyMsg && storyMsg.textContent && storyMsg.textContent.trim().length > 10) {
        content = storyMsg.textContent.trim();
      }
      // Fallback to data-ad-preview="message"
      if (!content) {
        var adPreview = node.querySelector('[data-ad-preview="message"], [data-ad-comet-preview="message"]');
        if (adPreview && adPreview.textContent && adPreview.textContent.trim().length > 10) {
          content = adPreview.textContent.trim();
        }
      }

      // --- Author (validated: data-ad-rendering-role="profile_name" > h2) ---
      var authorName = null;
      var profileEl = node.querySelector('[data-ad-rendering-role="profile_name"] h2');
      if (profileEl && profileEl.textContent) {
        authorName = profileEl.textContent.trim()
          .replace(/\\s*·\\s*Follow$/, '')
          .replace(/\\s*·\\s*עקוב$/, '');
      }
      // Fallback
      if (!authorName) {
        var h3a = node.querySelector('h3 a[role="link"], h4 a[role="link"]');
        if (h3a && h3a.textContent) authorName = h3a.textContent.trim();
      }

      // --- Post ID (validated: pcb.{postId} in photo link hrefs) ---
      var postId = null;
      var permalink = null;
      var links = Array.from(node.querySelectorAll('a[href]'));
      for (var l = 0; l < links.length; l++) {
        var href = links[l].getAttribute('href') || '';
        var pcbMatch = href.match(/pcb\\.(\\d+)/);
        if (pcbMatch) {
          postId = pcbMatch[1];
          permalink = 'https://www.facebook.com/groups/' + groupId + '/posts/' + postId + '/';
          break;
        }
        var postMatch = href.match(/\\/posts\\/(\\d+)/);
        if (postMatch) {
          postId = postMatch[1];
          permalink = 'https://www.facebook.com/groups/' + groupId + '/posts/' + postId + '/';
          break;
        }
        var plMatch = href.match(/\\/permalink\\/(\\d+)/);
        if (plMatch) {
          postId = plMatch[1];
          permalink = 'https://www.facebook.com/groups/' + groupId + '/posts/' + postId + '/';
          break;
        }
      }
      // Fallback: try story_fbid links
      if (!postId) {
        for (var l2 = 0; l2 < links.length; l2++) {
          var href2 = links[l2].getAttribute('href') || '';
          var sfbidMatch = href2.match(/story_fbid=(\\d+)/);
          if (sfbidMatch) {
            postId = sfbidMatch[1];
            permalink = 'https://www.facebook.com/groups/' + groupId + '/posts/' + postId + '/';
            break;
          }
        }
      }

      // Fallback: generate hash from content + author for text-only posts
      if (!postId && content) {
        var hash = 0;
        var str = (content || '') + '|' + (authorName || '');
        for (var c = 0; c < str.length; c++) {
          var ch = str.charCodeAt(c);
          hash = ((hash << 5) - hash) + ch;
          hash = hash & hash; // Convert to 32bit integer
        }
        postId = 'txt_' + Math.abs(hash).toString(36);
        permalink = 'https://www.facebook.com/groups/' + groupId + '/';
      }

      // --- Timestamp ---
      // Facebook does NOT render timestamps in the feed DOM.
      // Use fetch time as proxy — cron runs every 30 min.
      var timestamp = new Date().toISOString();

      // --- Image (validated: img[src*="scontent"], skip small/icons) ---
      var imageUrl = null;
      var imgs = Array.from(node.querySelectorAll('img[src*="scontent"], img[src*="fbcdn"]'));
      for (var m = 0; m < imgs.length; m++) {
        var src = imgs[m].getAttribute('src') || '';
        var width = imgs[m].getAttribute('width');
        if (width && parseInt(width) < 100) continue;
        if (src && src.indexOf('emoji') === -1 && src.indexOf('rsrc.php') === -1) {
          imageUrl = src;
          break;
        }
      }

      if (content && postId) {
        results.push({
          postId: postId,
          authorName: authorName || 'Unknown',
          content: content,
          permalink: permalink || ('https://www.facebook.com/groups/' + groupId + '/'),
          postedAt: timestamp,
          imageUrl: imageUrl,
          groupId: groupId,
        });
      }
    }
    return results;
  })("${groupId}")`);

  if (!Array.isArray(extractedPosts)) return [];
  return extractedPosts as FacebookPost[];
}

/**
 * Fetch posts from a group with retry and exponential backoff.
 * SECURITY: cookies are never logged.
 */
export async function fetchGroupWithRetry(
  page: Page,
  groupId: string,
  maxRetries: number = MAX_RETRIES,
): Promise<FacebookPost[]> {
  let lastError: FacebookClientError | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        console.log(
          JSON.stringify({
            event: 'fb_retry',
            attempt: attempt + 1,
            maxRetries,
            delayMs: delay,
            groupId,
          }),
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      await navigateToGroup(page, groupId);
      return await extractPostsFromDOM(page, groupId);
    } catch (error) {
      if (!(error instanceof FacebookClientError)) {
        // Wrap unexpected errors
        lastError = new FacebookClientError(
          error instanceof Error ? error.message : String(error),
          'network',
          true,
        );
      } else {
        lastError = error;
      }

      console.log(
        JSON.stringify({
          event: 'fb_fetch_error',
          attempt: attempt + 1,
          maxRetries,
          errorType: lastError.errorType,
          retryable: lastError.retryable,
          message: lastError.message,
          groupId,
        }),
      );

      if (!lastError.retryable) throw lastError;
    }
  }

  throw lastError!;
}
