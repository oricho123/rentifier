/**
 * Centralized Facebook DOM selectors.
 * Validated against live Facebook DOM (2026-03-03).
 *
 * Uses `data-ad-rendering-role` attributes (Facebook's internal rendering hooks)
 * which are more stable than class names.
 */
export const FB_SELECTORS = {
  // Feed container and post children
  feed: '[role="feed"]',
  // First child of feed is always the sorting widget — skip it
  feedPost: '[role="feed"] > div',

  // Post content
  postContent: '[data-ad-rendering-role="story_message"]',
  postContentFallback:
    '[data-ad-preview="message"], [data-ad-comet-preview="message"]',

  // Author name
  postAuthor: '[data-ad-rendering-role="profile_name"] h2',
  postAuthorFallback: 'h3 a[role="link"], h4 a[role="link"]',

  // Post ID — extracted from pcb.{postId} in photo link hrefs
  postPhotoLink: 'a[href*="pcb."]',

  // Images — skip small ones (profile pics, icons)
  postImage: 'img[src*="scontent"], img[src*="fbcdn"]',

  // Auth failure detection
  loginForm: '#login_form, #loginform',
  checkpoint: '[href*="/checkpoint/"]',
} as const;
