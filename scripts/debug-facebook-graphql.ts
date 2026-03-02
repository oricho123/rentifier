/**
 * Debug: end-to-end test of the Facebook GraphQL pipeline.
 * Exercises the real code path: token extraction → sorting mutation → feed query → parse.
 *
 * Usage: npx tsx --env-file=.env scripts/debug-facebook-graphql.ts
 */
import {
  extractTokensFromHomepage,
  computeJazoest,
  setSortingChronological,
  fetchGroupGraphQL,
  FacebookClientError,
} from '../packages/connectors/src/facebook/client';
import { parseGraphQLResponse } from '../packages/connectors/src/facebook/parser';

const GROUP_ID = '305724686290054';

const cookies = process.env.FB_COOKIES_1;
const docId = process.env.FB_DOC_ID;

if (!cookies) {
  console.error('Missing FB_COOKIES_1');
  process.exit(1);
}
if (!docId) {
  console.error('Missing FB_DOC_ID');
  process.exit(1);
}

async function main() {
  // Step 1: Extract tokens from homepage
  console.log('--- Step 1: Extract tokens from homepage ---');
  let fbDtsg: string;
  let lsd: string;
  try {
    ({ fbDtsg, lsd } = await extractTokensFromHomepage(cookies!));
    console.log(`fb_dtsg: ${fbDtsg.substring(0, 20)}...`);
    console.log(`lsd: ${lsd || '(empty)'}`);
    console.log(`jazoest: ${computeJazoest(fbDtsg)}`);
  } catch (err) {
    if (err instanceof FacebookClientError) {
      console.error(`Token extraction failed: [${err.errorType}] ${err.message}`);
    } else {
      console.error('Token extraction failed:', err);
    }
    process.exit(1);
  }

  const tokens = { docId: docId!, fbDtsg, lsd };

  // Step 2: Set chronological sorting
  console.log('\n--- Step 2: Set chronological sorting ---');
  await setSortingChronological(GROUP_ID, cookies!, tokens);

  // Step 3: Fetch group feed
  console.log('\n--- Step 3: Fetch group feed ---');
  let rawText: string;
  try {
    rawText = await fetchGroupGraphQL(GROUP_ID, cookies!, tokens);
    console.log(`Response length: ${rawText.length}`);
    console.log(`Lines: ${rawText.split('\n').length}`);
  } catch (err) {
    if (err instanceof FacebookClientError) {
      console.error(`Feed fetch failed: [${err.errorType}] ${err.message}`);
    } else {
      console.error('Feed fetch failed:', err);
    }
    process.exit(1);
  }

  // Step 4: Parse posts
  console.log('\n--- Step 4: Parse posts ---');
  const posts = parseGraphQLResponse(rawText, GROUP_ID);
  console.log(`Parsed ${posts.length} posts:`);
  for (const post of posts) {
    console.log(`  [${post.postedAt}] ${post.authorName}: ${(post.content || '').substring(0, 80)}...`);
    console.log(`    ID: ${post.postId} | URL: ${post.permalink}`);
    if (post.imageUrl) console.log(`    Image: ${post.imageUrl.substring(0, 80)}...`);
  }

  console.log(`\nDone — ${posts.length} posts fetched successfully.`);
}

main().catch((err) => {
  console.error('Fatal:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
