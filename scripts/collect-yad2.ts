/**
 * GitHub Actions scraper for yad2.co.il.
 *
 * Runs outside Cloudflare Workers (GitHub's IP ranges bypass Radware).
 * Uses D1RestClient to access the database via Cloudflare's D1 REST API.
 *
 * Required env vars (set as GitHub Actions secrets):
 *   CF_ACCOUNT_ID      — Cloudflare account ID
 *   CF_API_TOKEN       — Cloudflare API token with D1:Edit permission
 *   CF_D1_DATABASE_ID  — D1 database ID
 *
 * Activate this script by:
 *   1. Adding the secrets above to the GitHub repo
 *   2. Enabling .github/workflows/collect-yad2.yml
 *   3. Removing Yad2Connector from apps/collector/src/registry.ts
 *      (so the Cloudflare Worker stops trying to scrape yad2)
 */

import { Yad2Connector } from '@rentifier/connectors';
import { createRestDBFromEnv } from '@rentifier/db';

async function main() {
  const db = createRestDBFromEnv();

  // Resolve yad2 source row
  const sources = await db.getEnabledSources();
  const source = sources.find(s => s.name === 'yad2');
  if (!source) {
    console.log(JSON.stringify({ event: 'collect_skip', reason: 'yad2 source not found or disabled' }));
    return;
  }

  // Read current cursor
  const state = await db.getSourceState(source.id);
  const cursor = state?.cursor ?? null;

  console.log(JSON.stringify({ event: 'collect_start', sourceId: source.id, hasCursor: !!cursor }));

  const connector = new Yad2Connector();
  let candidates: Awaited<ReturnType<typeof connector.fetchNew>>['candidates'];
  let nextCursor: string | null;

  try {
    ({ candidates, nextCursor } = await connector.fetchNew(cursor, db));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ event: 'collect_error', error: message }));

    await db.updateSourceState(source.id, {
      last_run_at: new Date().toISOString(),
      last_status: 'error',
      last_error: message,
    });
    process.exit(1);
  }

  console.log(JSON.stringify({ event: 'collect_fetched', candidateCount: candidates.length }));

  // Insert raw listings
  if (candidates.length > 0) {
    await db.insertRawListings(
      candidates.map(c => ({
        source_id: source.id,
        source_item_id: c.sourceItemId,
        url: c.rawUrl,
        raw_json: JSON.stringify(c),
      }))
    );
  }

  // Update source state
  await db.updateSourceState(source.id, {
    cursor: nextCursor,
    last_run_at: new Date().toISOString(),
    last_status: 'ok',
    last_error: null,
  });

  console.log(JSON.stringify({ event: 'collect_complete', candidateCount: candidates.length }));
}

main().catch(err => {
  console.error('Fatal:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
