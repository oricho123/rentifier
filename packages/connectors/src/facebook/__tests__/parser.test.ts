import { describe, it, expect } from 'vitest';
import { parseGraphQLResponse, extractPostFromStoryNode } from '../parser';

describe('extractPostFromStoryNode', () => {
  const GROUP_ID = '123456789';

  it('extracts all fields from a complete Story node', () => {
    const node = {
      __typename: 'Story',
      post_id: '100001',
      permalink_url: 'https://www.facebook.com/groups/123456789/posts/100001/',
      actors: [{ name: 'John Doe', url: 'https://www.facebook.com/john' }],
      comet_sections: {
        content: {
          story: {
            message: {
              text: 'דירת 3 חדרים להשכרה בתל אביב, 5000 שח לחודש',
            },
          },
        },
        timestamp: {
          story: {
            creation_time: 1772471819,
            url: 'https://www.facebook.com/groups/123456789/posts/100001/',
          },
        },
      },
      attachments: [
        {
          styles: {
            attachment: {
              all_subattachments: {
                nodes: [
                  {
                    media: { image: { uri: 'https://scontent.fcdn.net/img1.jpg' } },
                    url: 'https://www.facebook.com/photo.php?fbid=111',
                  },
                  {
                    media: { image: { uri: 'https://scontent.fcdn.net/img2.jpg' } },
                    url: 'https://www.facebook.com/photo.php?fbid=222',
                  },
                ],
              },
            },
          },
        },
      ],
    };

    const post = extractPostFromStoryNode(
      node as unknown as Record<string, unknown>,
      GROUP_ID,
    );

    expect(post).not.toBeNull();
    expect(post!.postId).toBe('100001');
    expect(post!.authorName).toBe('John Doe');
    expect(post!.content).toContain('3 חדרים');
    expect(post!.permalink).toContain('/posts/100001/');
    expect(post!.postedAt).not.toBeNull();
    expect(new Date(post!.postedAt!).getFullYear()).toBeGreaterThanOrEqual(2026);
    expect(post!.imageUrl).toBe('https://scontent.fcdn.net/img1.jpg');
    expect(post!.groupId).toBe(GROUP_ID);
  });

  it('returns null for node without post_id', () => {
    const node = {
      __typename: 'Story',
      comet_sections: {
        content: { story: { message: { text: 'Some text content here' } } },
      },
    };

    const post = extractPostFromStoryNode(
      node as unknown as Record<string, unknown>,
      GROUP_ID,
    );
    expect(post).toBeNull();
  });

  it('returns null for short content (< 10 chars)', () => {
    const node = {
      __typename: 'Story',
      post_id: '100003',
      comet_sections: {
        content: { story: { message: { text: 'Hi' } } },
      },
    };

    const post = extractPostFromStoryNode(
      node as unknown as Record<string, unknown>,
      GROUP_ID,
    );
    expect(post).toBeNull();
  });

  it('handles missing optional fields gracefully', () => {
    const node = {
      __typename: 'Story',
      post_id: '100004',
      comet_sections: {
        content: {
          story: {
            message: { text: 'A rental post without much metadata attached' },
          },
        },
      },
    };

    const post = extractPostFromStoryNode(
      node as unknown as Record<string, unknown>,
      GROUP_ID,
    );

    expect(post).not.toBeNull();
    expect(post!.postId).toBe('100004');
    expect(post!.authorName).toBe('Unknown');
    expect(post!.postedAt).toBeNull();
    expect(post!.imageUrl).toBeNull();
    // Should generate a default permalink
    expect(post!.permalink).toContain('100004');
  });

  it('extracts timestamp from context_layout path', () => {
    const node = {
      __typename: 'Story',
      post_id: '100005',
      comet_sections: {
        content: {
          story: { message: { text: 'Post with context_layout timestamp' } },
        },
        context_layout: {
          story: {
            comet_sections: {
              metadata: [{ story: { creation_time: 1772400000 } }],
            },
          },
        },
      },
    };

    const post = extractPostFromStoryNode(
      node as unknown as Record<string, unknown>,
      GROUP_ID,
    );

    expect(post).not.toBeNull();
    expect(post!.postedAt).not.toBeNull();
  });
});

describe('parseGraphQLResponse', () => {
  const GROUP_ID = '123456789';

  it('parses NDJSON response with streamed Story nodes', () => {
    // Line 0: section header (should be skipped)
    const line0 = JSON.stringify({
      data: {
        node: {
          __typename: 'GroupsSectionHeaderUnit',
          group_feed: {
            edges: [{ node: { __typename: 'GroupsSectionHeaderUnit' } }],
          },
        },
      },
    });

    // Line 1: actual Story node (streamed edge)
    const line1 = JSON.stringify({
      data: {
        node: {
          __typename: 'Story',
          post_id: '200001',
          permalink_url: 'https://www.facebook.com/groups/123456789/posts/200001/',
          actors: [{ name: 'Alice' }],
          comet_sections: {
            content: {
              story: {
                message: { text: 'דירת 2 חדרים ברמת גן, 4000 שח לחודש' },
              },
            },
            timestamp: { story: { creation_time: 1772471819 } },
          },
        },
      },
    });

    // Line 2: another Story node
    const line2 = JSON.stringify({
      data: {
        node: {
          __typename: 'Story',
          post_id: '200002',
          permalink_url: 'https://www.facebook.com/groups/123456789/posts/200002/',
          actors: [{ name: 'Bob' }],
          comet_sections: {
            content: {
              story: {
                message: { text: 'סטודיו בירושלים, 3500 שח, מרוהטת' },
              },
            },
            timestamp: { story: { creation_time: 1772471700 } },
          },
        },
      },
    });

    // Line 3: page_info (should be skipped)
    const line3 = JSON.stringify({
      data: { page_info: { has_next_page: true, end_cursor: 'abc123' } },
    });

    const response = [line0, line1, line2, line3].join('\n');
    const posts = parseGraphQLResponse(response, GROUP_ID);

    expect(posts).toHaveLength(2);
    expect(posts[0].postId).toBe('200001');
    expect(posts[0].authorName).toBe('Alice');
    expect(posts[0].content).toContain('2 חדרים');
    expect(posts[1].postId).toBe('200002');
    expect(posts[1].authorName).toBe('Bob');
    expect(posts[1].content).toContain('סטודיו');
  });

  it('handles empty response', () => {
    const posts = parseGraphQLResponse('', GROUP_ID);
    expect(posts).toHaveLength(0);
  });

  it('handles response with only section header and page_info', () => {
    const line0 = JSON.stringify({
      data: {
        node: {
          __typename: 'GroupsSectionHeaderUnit',
          group_feed: { edges: [] },
        },
      },
    });
    const line1 = JSON.stringify({
      data: { page_info: { has_next_page: false } },
    });

    const response = [line0, line1].join('\n');
    const posts = parseGraphQLResponse(response, GROUP_ID);
    expect(posts).toHaveLength(0);
  });

  it('skips malformed JSON lines', () => {
    const validLine = JSON.stringify({
      data: {
        node: {
          __typename: 'Story',
          post_id: '300001',
          actors: [{ name: 'Test' }],
          comet_sections: {
            content: {
              story: { message: { text: 'Valid post with enough content here' } },
            },
          },
        },
      },
    });

    const response = ['not valid json', validLine, '{ broken'].join('\n');
    const posts = parseGraphQLResponse(response, GROUP_ID);

    expect(posts).toHaveLength(1);
    expect(posts[0].postId).toBe('300001');
  });
});
