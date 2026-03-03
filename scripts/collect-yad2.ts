/**
 * GitHub Actions scraper for yad2.co.il.
 *
 * Runs outside Cloudflare Workers (GitHub's IP ranges bypass Radware).
 *
 * Modes:
 *   --local   Use local D1 database (via wrangler getPlatformProxy)
 *   default   Use remote D1 via REST API (for GitHub Actions)
 *
 * Required env vars (remote mode / GitHub Actions secrets):
 *   CF_ACCOUNT_ID      — Cloudflare account ID
 *   CF_API_TOKEN       — Cloudflare API token with D1:Edit permission
 *   CF_D1_DATABASE_ID  — D1 database ID
 */

import { Yad2Connector } from '@rentifier/connectors';
import { createRestDBFromEnv } from '@rentifier/db';
import type { DB } from '@rentifier/db';

const isLocal = process.argv.includes('--local');

async function getDB(): Promise<{ db: DB; cleanup?: () => Promise<void> }> {
  if (isLocal) {
    const { getPlatformProxy } = await import('wrangler');
    const proxy = await getPlatformProxy({
      configPath: 'apps/collector/wrangler.json',
      persist: { path: '.wrangler/v3' },
    });
    const { createDB } = await import('@rentifier/db/src/queries');
    const db = createDB(proxy.env.DB as never);
    return { db, cleanup: () => proxy.dispose() };
  }
  return { db: createRestDBFromEnv() };
}

async function main() {
  const { db, cleanup } = await getDB();
  if (isLocal) console.log('Using local D1 database');

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

  if (cleanup) await cleanup();
}

main().catch(err => {
  console.error('Fatal:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
