/**
 * Pulls a stratified 100-listing sample for the resolver spike.
 *
 * Stratum (matches spec.md P0 AC #1):
 *   50 Yad2 in top-3 cities (תל אביב / ירושלים / חיפה), with coords
 *   20 Yad2 in other M3 cities, with coords
 *   20 Facebook listings with street + city but no coords
 *   10 edge cases:
 *       - 5 listings with coords but the current `neighborhood` IS set
 *         (lets us check if resolvers AGREE with regex/AI attribution)
 *       - 5 listings in cities OUTSIDE the top 10 M3 list (out-of-coverage test)
 *
 * All sampled listings must have a non-empty `city`. Results are stable across
 * runs because we order by listing id and take the first N per bucket.
 *
 * Usage:
 *   pnpm tsx --env-file=.env scripts/spike-neighborhoods/sample-listings.ts [--local]
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openD1 } from './d1';
import type { SampleFile, SampleListing, StratumBucket } from './types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'out');

const TOP3_CITIES = ['תל אביב', 'ירושלים', 'חיפה'];
const OTHER_M3_CITIES = [
  'הרצליה',
  'רמת גן',
  'גבעתיים',
  'באר שבע',
  'נתניה',
  'ראשון לציון',
  'פתח תקווה',
];

const STRATUM_TARGETS: Record<StratumBucket, number> = {
  yad2_top3: 50,
  yad2_other_m3: 20,
  fb_street_city: 20,
  edge: 10,
};

interface ListingRow {
  id: number;
  source_name: string;
  city: string | null;
  neighborhood: string | null;
  street: string | null;
  house_number: string | null;
  latitude: number | null;
  longitude: number | null;
  url: string;
}

function inList(values: string[]): string {
  return values.map((v) => `'${v.replace(/'/g, "''")}'`).join(', ');
}

async function main(): Promise<void> {
  const local = process.argv.includes('--local');
  const db = await openD1({ local });

  try {
    const take = async (sql: string, params: unknown[] = []) =>
      db.query<ListingRow>(sql, params);

    const yad2Top3 = await take(
      `SELECT l.id, s.name AS source_name, l.city, l.neighborhood, l.street,
              l.house_number, l.latitude, l.longitude, l.url
       FROM listings l JOIN sources s ON s.id = l.source_id
       WHERE s.name = 'yad2'
         AND l.city IN (${inList(TOP3_CITIES)})
         AND l.latitude IS NOT NULL AND l.longitude IS NOT NULL
         AND l.latitude <> 0 AND l.longitude <> 0
       ORDER BY l.id DESC
       LIMIT ${STRATUM_TARGETS.yad2_top3}`,
    );

    const yad2OtherM3 = await take(
      `SELECT l.id, s.name AS source_name, l.city, l.neighborhood, l.street,
              l.house_number, l.latitude, l.longitude, l.url
       FROM listings l JOIN sources s ON s.id = l.source_id
       WHERE s.name = 'yad2'
         AND l.city IN (${inList(OTHER_M3_CITIES)})
         AND l.latitude IS NOT NULL AND l.longitude IS NOT NULL
         AND l.latitude <> 0 AND l.longitude <> 0
       ORDER BY l.id DESC
       LIMIT ${STRATUM_TARGETS.yad2_other_m3}`,
    );

    const fbStreetCity = await take(
      `SELECT l.id, s.name AS source_name, l.city, l.neighborhood, l.street,
              l.house_number, l.latitude, l.longitude, l.url
       FROM listings l JOIN sources s ON s.id = l.source_id
       WHERE s.name = 'facebook'
         AND l.city IS NOT NULL
         AND l.street IS NOT NULL
         AND (l.latitude IS NULL OR l.longitude IS NULL OR l.latitude = 0 OR l.longitude = 0)
       ORDER BY l.id DESC
       LIMIT ${STRATUM_TARGETS.fb_street_city}`,
    );

    const edgeAgreement = await take(
      `SELECT l.id, s.name AS source_name, l.city, l.neighborhood, l.street,
              l.house_number, l.latitude, l.longitude, l.url
       FROM listings l JOIN sources s ON s.id = l.source_id
       WHERE l.neighborhood IS NOT NULL
         AND l.latitude IS NOT NULL AND l.longitude IS NOT NULL
         AND l.latitude <> 0 AND l.longitude <> 0
       ORDER BY l.id DESC
       LIMIT 5`,
    );

    const allM3 = [...TOP3_CITIES, ...OTHER_M3_CITIES];
    const edgeOutOfCoverage = await take(
      `SELECT l.id, s.name AS source_name, l.city, l.neighborhood, l.street,
              l.house_number, l.latitude, l.longitude, l.url
       FROM listings l JOIN sources s ON s.id = l.source_id
       WHERE l.city IS NOT NULL
         AND l.city NOT IN (${inList(allM3)})
         AND l.latitude IS NOT NULL AND l.longitude IS NOT NULL
         AND l.latitude <> 0 AND l.longitude <> 0
       ORDER BY l.id DESC
       LIMIT 5`,
    );

    const toSample = (rows: ListingRow[], bucket: StratumBucket): SampleListing[] =>
      rows.map((r) => ({
        id: Number(r.id),
        source: (r.source_name === 'yad2' ? 'yad2' : 'facebook') as SampleListing['source'],
        bucket,
        city: r.city,
        neighborhood: r.neighborhood,
        street: r.street,
        house_number: r.house_number,
        latitude: r.latitude == null ? null : Number(r.latitude),
        longitude: r.longitude == null ? null : Number(r.longitude),
        url: r.url,
      }));

    const listings: SampleListing[] = [
      ...toSample(yad2Top3, 'yad2_top3'),
      ...toSample(yad2OtherM3, 'yad2_other_m3'),
      ...toSample(fbStreetCity, 'fb_street_city'),
      ...toSample(edgeAgreement, 'edge'),
      ...toSample(edgeOutOfCoverage, 'edge'),
    ];

    const stratum: Record<StratumBucket, number> = {
      yad2_top3: yad2Top3.length,
      yad2_other_m3: yad2OtherM3.length,
      fb_street_city: fbStreetCity.length,
      edge: edgeAgreement.length + edgeOutOfCoverage.length,
    };

    const out: SampleFile = {
      generatedAt: new Date().toISOString(),
      count: listings.length,
      stratum,
      listings,
    };

    await mkdir(OUT_DIR, { recursive: true });
    const outPath = join(OUT_DIR, 'sample.json');
    await writeFile(outPath, JSON.stringify(out, null, 2), 'utf8');

    console.log(`\nSample (${listings.length} listings):`);
    for (const [k, v] of Object.entries(stratum)) {
      const target = STRATUM_TARGETS[k as StratumBucket];
      const short = v < target ? `  (short of ${target})` : '';
      console.log(`  ${k.padEnd(18)} ${String(v).padStart(3)}${short}`);
    }
    console.log(`\nWrote ${outPath}`);
  } finally {
    if (db.dispose) await db.dispose();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
