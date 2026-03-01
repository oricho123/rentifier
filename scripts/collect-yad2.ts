/**
 * GitHub Actions scraper for yad2.co.il.
 *
 * Runs outside Cloudflare Workers (GitHub's IP ranges bypass Radware).
 * Reads/writes cursor state and listings directly via the Cloudflare D1 REST API.
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

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_API_TOKEN = process.env.CF_API_TOKEN;
const CF_D1_DATABASE_ID = process.env.CF_D1_DATABASE_ID;

if (!CF_ACCOUNT_ID || !CF_API_TOKEN || !CF_D1_DATABASE_ID) {
  console.error('Missing required env vars: CF_ACCOUNT_ID, CF_API_TOKEN, CF_D1_DATABASE_ID');
  process.exit(1);
}

const D1_URL = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${CF_D1_DATABASE_ID}/query`;

interface D1Result {
  results: Record<string, unknown>[];
}

async function d1Query(sql: string, params: unknown[] = []): Promise<D1Result> {
  const res = await fetch(D1_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CF_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql, params }),
  });

  const data = await res.json() as { success: boolean; errors: unknown[]; result: D1Result[] };
  if (!data.success) {
    throw new Error(`D1 query failed: ${JSON.stringify(data.errors)}`);
  }
  return data.result[0];
}

async function main() {
  // Resolve yad2 source row
  const sourceRes = await d1Query(
    "SELECT id FROM sources WHERE name = 'yad2' AND enabled = 1 LIMIT 1"
  );
  const sourceRow = sourceRes.results[0];
  if (!sourceRow) {
    console.log(JSON.stringify({ event: 'collect_skip', reason: 'yad2 source not found or disabled' }));
    return;
  }
  const sourceId = sourceRow.id as number;

  // Read current cursor
  const stateRes = await d1Query(
    'SELECT cursor FROM source_state WHERE source_id = ? LIMIT 1',
    [sourceId]
  );
  const cursor = (stateRes.results[0]?.cursor as string) ?? null;

  console.log(JSON.stringify({ event: 'collect_start', sourceId, hasCursor: !!cursor }));

  // Build a minimal DB adapter that uses the D1 REST API
  // (the full DB object requires a D1Database binding, unavailable outside Workers)
  const db = {
    async getEnabledCities() {
      const res = await d1Query(
        'SELECT * FROM monitored_cities WHERE enabled = 1 ORDER BY priority DESC, id ASC'
      );
      return res.results as { id: number; city_name: string; city_code: number; enabled: boolean; priority: number; created_at: string }[];
    },
  };

  const connector = new Yad2Connector();
  let candidates: Awaited<ReturnType<typeof connector.fetchNew>>['candidates'];
  let nextCursor: string | null;

  try {
    ({ candidates, nextCursor } = await connector.fetchNew(cursor, db as any));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ event: 'collect_error', error: message }));

    await d1Query(
      `INSERT INTO source_state (source_id, last_run_at, last_status, last_error)
       VALUES (?, datetime('now'), 'error', ?)
       ON CONFLICT(source_id) DO UPDATE SET
         last_run_at = excluded.last_run_at,
         last_status = excluded.last_status,
         last_error  = excluded.last_error`,
      [sourceId, message]
    );
    process.exit(1);
  }

  console.log(JSON.stringify({ event: 'collect_fetched', candidateCount: candidates.length }));

  // Insert raw listings one by one (D1 REST API doesn't support batching across statements)
  for (const c of candidates) {
    await d1Query(
      'INSERT OR IGNORE INTO listings_raw (source_id, source_item_id, url, raw_json) VALUES (?, ?, ?, ?)',
      [sourceId, c.sourceItemId, c.rawUrl, JSON.stringify(c)]
    );
  }

  // Update source state
  await d1Query(
    `INSERT INTO source_state (source_id, cursor, last_run_at, last_status, last_error)
     VALUES (?, ?, datetime('now'), 'ok', NULL)
     ON CONFLICT(source_id) DO UPDATE SET
       cursor       = excluded.cursor,
       last_run_at  = excluded.last_run_at,
       last_status  = excluded.last_status,
       last_error   = excluded.last_error`,
    [sourceId, nextCursor]
  );

  console.log(JSON.stringify({ event: 'collect_complete', candidateCount: candidates.length }));
}

main().catch(err => {
  console.error('Fatal:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
