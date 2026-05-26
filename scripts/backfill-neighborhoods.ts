/**
 * Backfill script: retroactively resolves neighborhoods for historical listings.
 *
 * Implements spec P1b from .specs/features/neighborhood-extraction-coverage/spec.md
 *
 * Usage:
 *   pnpm tsx --env-file=.env scripts/backfill-neighborhoods.ts \
 *     --since=2026-01-01 [--dry-run] [--batch=50] [--delay=1200]
 *
 * Env vars required:
 *   CF_ACCOUNT_ID, CF_API_TOKEN, CF_D1_DATABASE_ID (via .env)
 *
 * Optional:
 *   NEIGHBORHOOD_GEOCODER_USER_AGENT  (defaults to rentifier-backfill/1.0)
 */

import { createRestDBFromEnv } from '../packages/db/src/rest-client';
import type { DB } from '../packages/db/src/queries';
import type { NeighborhoodCacheRow } from '../packages/db/src/schema';
import {
  resolveNeighborhood,
  type NeighborhoodCache,
  type NominatimConfig,
} from '../packages/extraction/src/nominatim-resolver';

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): {
  since: string;
  dryRun: boolean;
  batchSize: number;
  delayMs: number;
} {
  const get = (flag: string) => {
    const entry = argv.find(a => a.startsWith(`--${flag}=`));
    return entry ? entry.split('=')[1] : undefined;
  };

  const since = get('since');
  if (!since) {
    console.error('Error: --since=YYYY-MM-DD is required');
    process.exit(1);
  }

  return {
    since,
    dryRun: argv.includes('--dry-run'),
    batchSize: parseInt(get('batch') ?? '50', 10),
    delayMs: parseInt(get('delay') ?? '1200', 10),
  };
}

// ---------------------------------------------------------------------------
// In-memory + D1 hybrid cache
// ---------------------------------------------------------------------------

function createHybridCache(db: DB): NeighborhoodCache {
  const memCache = new Map<string, { rawName: string | null; canonicalName: string | null }>();

  return {
    async get(cacheKey) {
      const mem = memCache.get(cacheKey);
      if (mem !== undefined) return mem;

      const row = await db.getCachedNeighborhood(cacheKey);
      if (!row) return null;

      const entry = { rawName: row.raw_name, canonicalName: row.canonical_name };
      memCache.set(cacheKey, entry);
      return entry;
    },

    async set(cacheKey, cacheType, rawName, canonicalName, provider) {
      memCache.set(cacheKey, { rawName, canonicalName });
      await db.setCachedNeighborhood(cacheKey, cacheType, rawName, canonicalName, provider);
    },
  };
}

// ---------------------------------------------------------------------------
// Fetch a page of listings needing neighborhoods
// ---------------------------------------------------------------------------

interface ListingNeedingNeighborhood {
  id: number;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  street: string | null;
  ingested_at: string;
}

async function fetchPage(
  since: string,
  afterId: number,
  limit: number,
): Promise<ListingNeedingNeighborhood[]> {
  const { D1RestClient } = await import('../packages/db/src/rest-client');
  const env = process.env;

  const client = new D1RestClient({
    accountId: env.CF_ACCOUNT_ID!,
    apiToken: env.CF_API_TOKEN!,
    databaseId: env.CF_D1_DATABASE_ID!,
  });

  const result = await client.query(
    `SELECT id, city, latitude, longitude, street
     FROM listings
     WHERE neighborhood IS NULL
       AND ingested_at >= ?
       AND id > ?
       AND duplicate_of IS NULL
     ORDER BY id ASC
     LIMIT ?`,
    [since, afterId, limit],
  );

  return result.results as ListingNeedingNeighborhood[];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { since, dryRun, batchSize, delayMs } = args;

  console.log(`Backfill neighborhoods:`);
  console.log(`  since    : ${since}`);
  console.log(`  dry-run  : ${dryRun}`);
  console.log(`  batch    : ${batchSize}`);
  console.log(`  delay    : ${delayMs}ms`);
  console.log('');

  const db = createRestDBFromEnv();
  const cache = createHybridCache(db);

  const nominatimConfig: NominatimConfig = {
    userAgent: process.env.NEIGHBORHOOD_GEOCODER_USER_AGENT
      ?? 'rentifier-backfill/1.0 (+https://github.com/oricho123/rentifier)',
    timeoutMs: 12_000,
  };

  // Budget is per-run for the backfill; set high since we pace via delay
  const budget = { remaining: 100_000 };

  let totalScanned = 0;
  let filledCoords = 0;
  let filledStreet = 0;
  let stillNull = 0;
  let lastId = 0;

  while (true) {
    const page = await fetchPage(since, lastId, batchSize);
    if (page.length === 0) break;

    for (const listing of page) {
      totalScanned++;
      lastId = listing.id;

      const resolved = await resolveNeighborhood({
        city: listing.city,
        latitude: listing.latitude,
        longitude: listing.longitude,
        street: listing.street,
        cache,
        config: nominatimConfig,
        budget,
      });

      if (resolved) {
        if (resolved.source === 'coords_live' || resolved.source === 'coords_cache') {
          filledCoords++;
        } else {
          filledStreet++;
        }

        if (!dryRun) {
          await db.updateListingNeighborhood(listing.id, resolved.neighborhood, resolved.source);
        }
      } else {
        stillNull++;
      }

      // Progress every 100 listings
      if (totalScanned % 100 === 0) {
        console.log(
          `[${new Date().toISOString()}] scanned=${totalScanned} filled_coords=${filledCoords} filled_street=${filledStreet} still_null=${stillNull} budget_left=${budget.remaining}`,
        );
      }

      // Pace external calls — only delay if a live call was made
      if (resolved?.source === 'coords_live' || resolved?.source === 'street_live') {
        await new Promise(res => setTimeout(res, delayMs));
      }
    }
  }

  console.log('');
  console.log('=== Backfill complete ===');
  console.log(`  total scanned  : ${totalScanned}`);
  console.log(`  filled (coords): ${filledCoords}`);
  console.log(`  filled (street): ${filledStreet}`);
  console.log(`  still null     : ${stillNull}`);
  console.log(`  budget used    : ${100_000 - budget.remaining}`);
  if (dryRun) console.log('  DRY RUN — no writes were made');
}

main().catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
