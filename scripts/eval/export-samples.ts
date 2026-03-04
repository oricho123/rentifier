/**
 * Export Facebook posts from D1 for AI extraction evaluation.
 *
 * Fetches recent posts and caches them locally as JSON files.
 * With --golden-template, outputs starter templates for manual labeling
 * in the golden dataset format (camelCase, matching AiExtractionResult).
 *
 * Usage:
 *   pnpm tsx --env-file=.env scripts/eval/export-samples.ts [--limit N] [--local] [--golden-template]
 *
 * Required env vars:
 *   CF_ACCOUNT_ID, CF_API_TOKEN
 *   CF_D1_DATABASE_ID (remote mode only)
 */

const isLocal = process.argv.includes('--local');
const isGoldenTemplate = process.argv.includes('--golden-template');
const limitArg = process.argv.find((_, i, arr) => arr[i - 1] === '--limit');
const SAMPLE_SIZE = limitArg ? parseInt(limitArg, 10) : 30;

interface PostSample {
  id: number;
  source_item_id: string;
  raw_json: string;
}

async function fetchFacebookPosts(limit: number): Promise<PostSample[]> {
  if (isLocal) {
    const { getPlatformProxy } = await import('wrangler');
    const proxy = await getPlatformProxy({
      configPath: 'apps/collector/wrangler.json',
      persist: { path: '.wrangler/v3' },
    });
    const d1 = proxy.env.DB as any;
    const result = await d1
      .prepare(
        `SELECT id, source_item_id, raw_json FROM listings_raw
         WHERE source_id = (SELECT id FROM sources WHERE name = 'facebook')
         ORDER BY fetched_at DESC LIMIT ?`
      )
      .bind(limit)
      .all();
    await proxy.dispose();
    return result.results as PostSample[];
  }

  // Remote D1 REST
  const accountId = process.env.CF_ACCOUNT_ID!;
  const apiToken = process.env.CF_API_TOKEN!;
  const databaseId = process.env.CF_D1_DATABASE_ID!;
  const { D1RestClient } = await import('../../packages/db/src/rest-client');
  const client = new D1RestClient({ accountId, apiToken, databaseId });
  const result = await client.query(
    `SELECT id, source_item_id, raw_json FROM listings_raw
     WHERE source_id = (SELECT id FROM sources WHERE name = 'facebook')
     ORDER BY fetched_at DESC LIMIT ?`,
    [limit]
  );
  return result.results as unknown as PostSample[];
}

function extractTextFromCandidate(rawJson: string): string | null {
  try {
    const candidate = JSON.parse(rawJson);
    const parts = [candidate.rawTitle, candidate.rawDescription].filter(Boolean);
    return parts.length > 0 ? parts.join('\n') : null;
  } catch {
    return null;
  }
}

function extractUrlFromCandidate(rawJson: string): string | null {
  try {
    const candidate = JSON.parse(rawJson);
    return candidate.rawUrl || null;
  } catch {
    return null;
  }
}

interface SampleEntry {
  id: string;
  sourcePostId: string;
  url: string | null;
  category: string;
  text: string;
  expected?: {
    isRental: boolean | null;
    price: { amount: number; currency: string; period: string } | null;
    bedrooms: number | null;
    city: string | null;
    neighborhood: string | null;
    street: string | null;
    floor: number | null;
    squareMeters: number | null;
    entryDate: string | null;
    tags: string[];
  };
  notes: string;
}

async function main() {
  console.log(`\n=== Export Samples for Eval ===`);
  console.log(`  Limit:           ${SAMPLE_SIZE}`);
  console.log(`  DB mode:         ${isLocal ? 'local' : 'remote REST'}`);
  console.log(`  Golden template: ${isGoldenTemplate}\n`);

  const posts = await fetchFacebookPosts(SAMPLE_SIZE);
  console.log(`Fetched ${posts.length} posts from DB.`);

  const entries: SampleEntry[] = [];
  let skipped = 0;

  for (const post of posts) {
    const text = extractTextFromCandidate(post.raw_json);
    if (!text || text.length < 100) {
      skipped++;
      continue;
    }

    const entry: SampleEntry = {
      id: `sample-${String(entries.length + 1).padStart(3, '0')}`,
      sourcePostId: post.source_item_id,
      url: extractUrlFromCandidate(post.raw_json),
      category: 'unlabeled',
      text,
      notes: '',
    };

    if (isGoldenTemplate) {
      entry.expected = {
        isRental: null,
        price: null,
        bedrooms: null,
        city: null,
        neighborhood: null,
        street: null,
        floor: null,
        squareMeters: null,
        entryDate: null,
        tags: [],
      };
    }

    entries.push(entry);
  }

  console.log(`Exported ${entries.length} posts (skipped ${skipped} with text < 100 chars).`);

  const timestamp = new Date().toISOString().slice(0, 10);
  const suffix = isGoldenTemplate ? '-golden-template' : '';
  const filename = `scripts/eval/samples-${timestamp}${suffix}.json`;

  const { writeFileSync } = await import('fs');
  writeFileSync(filename, JSON.stringify(entries, null, 2) + '\n');
  console.log(`Written to: ${filename}`);

  if (isGoldenTemplate) {
    console.log(`\nNext steps:`);
    console.log(`  1. Open ${filename}`);
    console.log(`  2. For each post, read the Hebrew text and fill in the 'expected' fields`);
    console.log(`  3. Set 'category' to: standard_rental, missing_fields, non_rental, or edge_case`);
    console.log(`  4. For non-rental posts, only 'isRental: false' is needed in expected`);
    console.log(`  5. City values must use normalized form (check packages/extraction/src/cities.ts)`);
    console.log(`  6. Save as scripts/eval/golden-dataset.json when done`);
  }
}

main().catch((err) => {
  console.error('Fatal:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
