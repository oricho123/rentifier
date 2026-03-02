import type { FacebookPost } from './types';

/**
 * Parse Facebook GraphQL NDJSON response into structured posts.
 *
 * Facebook returns NDJSON (newline-delimited JSON) using Relay incremental delivery:
 *   Line 0: Initial skeleton (contains section header, not actual posts)
 *   Lines 1..N-1: Streamed Story nodes at path ['node', 'group_feed', 'edges', i]
 *   Last line: page_info for pagination
 *
 * Each Story node contains:
 *   - post_id
 *   - comet_sections.content.story.message.text  (post text)
 *   - comet_sections.timestamp.story.creation_time  (unix timestamp)
 *   - permalink_url
 *   - actors[0].name  (author)
 *   - attachments[0].styles.attachment.all_subattachments.nodes[0].url  (image)
 */
export function parseGraphQLResponse(
  responseText: string,
  groupId: string,
): FacebookPost[] {
  const lines = responseText.split('\n').filter((l) => l.trim());
  const posts: FacebookPost[] = [];

  for (const line of lines) {
    try {
      const json = JSON.parse(line);

      // Skip non-story entries (page_info, errors, etc.)
      const node = json?.data?.node;
      if (!node || node.__typename !== 'Story') continue;

      const post = extractPostFromStoryNode(node, groupId);
      if (post) posts.push(post);
    } catch {
      // Skip unparseable lines
    }
  }

  // Canary: if response was large but yielded no posts, warn
  if (posts.length === 0 && responseText.length > 1000) {
    console.log(
      JSON.stringify({
        event: 'fb_parser_canary_failed',
        groupId,
        responseLength: responseText.length,
        lineCount: lines.length,
        message:
          'Non-empty GraphQL response yielded 0 posts — response format may have changed',
      }),
    );
  }

  return posts;
}

/**
 * Extract a FacebookPost from a GraphQL Story node.
 * Returns null if the node lacks required data (post_id or content).
 */
export function extractPostFromStoryNode(
  node: Record<string, unknown>,
  groupId: string,
): FacebookPost | null {
  const postId = getNestedString(node, 'post_id');
  if (!postId) return null;

  // Extract message text — try multiple paths
  const content =
    getNestedString(node, 'comet_sections', 'content', 'story', 'message', 'text') || '';

  // Skip posts with no meaningful content
  if (content.length < 10) return null;

  // Extract author name
  const actors = getNestedArray(node, 'actors');
  const authorName =
    actors.length > 0 ? getNestedString(actors[0] as Record<string, unknown>, 'name') || 'Unknown' : 'Unknown';

  // Extract permalink
  const permalink =
    getNestedString(node, 'permalink_url') ||
    getNestedString(node, 'comet_sections', 'timestamp', 'story', 'url') ||
    `https://www.facebook.com/groups/${groupId}/posts/${postId}/`;

  // Extract creation time (unix timestamp → ISO string)
  let postedAt: string | null = null;
  const creationTime =
    getNestedNumber(node, 'comet_sections', 'timestamp', 'story', 'creation_time') ??
    getNestedNumber(node, 'comet_sections', 'context_layout', 'story', 'comet_sections', 'metadata', 0, 'story', 'creation_time');
  if (creationTime) {
    postedAt = new Date(creationTime * 1000).toISOString();
  }

  // Extract first image URL from attachments
  const imageUrl = extractFirstImageUrl(node);

  return {
    postId,
    authorName,
    content,
    permalink,
    postedAt,
    imageUrl,
    groupId,
  };
}

/**
 * Extract first image URL from a Story node's attachments.
 * Tries subattachments first, then falls back to the main attachment media.
 */
function extractFirstImageUrl(node: Record<string, unknown>): string | null {
  // Path: attachments[0].styles.attachment.all_subattachments.nodes[0]
  const attachments = getNestedArray(node, 'attachments');
  if (attachments.length === 0) return null;

  const attachment = attachments[0] as Record<string, unknown>;
  const subNodes = getNestedArray(
    attachment,
    'styles',
    'attachment',
    'all_subattachments',
    'nodes',
  );

  if (subNodes.length > 0) {
    const firstSub = subNodes[0] as Record<string, unknown>;
    // Try media.image.uri first (actual image URL), then url (page URL)
    const mediaUri = getNestedString(firstSub, 'media', 'image', 'uri');
    if (mediaUri) return mediaUri;
  }

  // Fallback: try media.image.uri on the main attachment
  const mainMediaUri = getNestedString(
    attachment,
    'styles',
    'attachment',
    'media',
    'image',
    'uri',
  );
  if (mainMediaUri) return mainMediaUri;

  return null;
}

// --- Utility helpers for safe nested access ---

function getNestedValue(
  obj: unknown,
  ...path: (string | number)[]
): unknown {
  let current: unknown = obj;
  for (const key of path) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string | number, unknown>)[key];
  }
  return current;
}

function getNestedString(
  obj: Record<string, unknown>,
  ...path: (string | number)[]
): string | null {
  const val = getNestedValue(obj, ...path);
  return typeof val === 'string' ? val : null;
}

function getNestedNumber(
  obj: Record<string, unknown>,
  ...path: (string | number)[]
): number | null {
  const val = getNestedValue(obj, ...path);
  return typeof val === 'number' ? val : null;
}

function getNestedArray(
  obj: Record<string, unknown>,
  ...path: (string | number)[]
): unknown[] {
  const val = getNestedValue(obj, ...path);
  return Array.isArray(val) ? val : [];
}
