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

import { Yad2Connector, fetchYad2Region } from '@rentifier/connectors';
import { createRestDBFromEnv } from '@rentifier/db';
import type { DB } from '@rentifier/db';

const isLocal = process.argv.includes('--local');
const isDiscoverRegions = process.argv.includes('--discover-regions');

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

async function discoverRegions() {
  console.log('Discovering Yad2 region codes (trying regions 1-10)...\n');
  const cityToRegions: Record<string, number[]> = {};

  for (let regionCode = 1; regionCode <= 10; regionCode++) {
    try {
      const response = await fetchYad2Region(regionCode, 1); // 1 retry only
      const markers = response.data.markers;
      if (markers.length === 0) continue;

      const cities: Record<string, number> = {};
      for (const m of markers) {
        const city = m.address?.city?.text ?? '?';
        cities[city] = (cities[city] || 0) + 1;
      }

      const regionName = markers[0]?.address?.region?.text ?? '?';
      console.log(`Region ${regionCode} (${regionName}): ${markers.length} markers`);
      for (const [city, count] of Object.entries(cities).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${city}: ${count}`);
        if (!cityToRegions[city]) cityToRegions[city] = [];
        cityToRegions[city].push(regionCode);
      }
      console.log();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`Region ${regionCode}: ERROR - ${msg}`);
    }
  }

  console.log('\n--- SQL to update monitored_cities ---');
  for (const [city, regions] of Object.entries(cityToRegions)) {
    console.log(`UPDATE monitored_cities SET region_code = ${regions[0]} WHERE city_name = '${city}';`);
  }
}

async function main() {
  if (isDiscoverRegions) {
    await discoverRegions();
    return;
  }

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
