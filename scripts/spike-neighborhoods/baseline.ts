/**
 * Baseline measurement for the neighborhood-coverage spike.
 *
 * Writes out/baseline.json with the current `neighborhood` non-null rate per
 * source over the last 30 days. This becomes the denominator for the spec's
 * success criteria ("lift Yad2 to ≥90%, Facebook to ≥70%").
 *
 * Usage:
 *   pnpm tsx --env-file=.env scripts/spike-neighborhoods/baseline.ts [--local]
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openD1 } from './d1';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'out');

interface Row {
  source_name: string;
  total: number;
  with_neighborhood: number;
  with_coords: number;
  with_street: number;
}

async function main(): Promise<void> {
  const local = process.argv.includes('--local');
  const db = await openD1({ local });

  try {
    const rows = await db.query<Row>(
      `SELECT
         s.name AS source_name,
         COUNT(*) AS total,
         SUM(CASE WHEN l.neighborhood IS NOT NULL THEN 1 ELSE 0 END) AS with_neighborhood,
         SUM(CASE WHEN l.latitude IS NOT NULL AND l.longitude IS NOT NULL THEN 1 ELSE 0 END) AS with_coords,
         SUM(CASE WHEN l.street IS NOT NULL THEN 1 ELSE 0 END) AS with_street
       FROM listings l
       JOIN sources s ON s.id = l.source_id
       WHERE l.ingested_at >= datetime('now', '-30 days')
       GROUP BY s.name
       ORDER BY total DESC`,
    );

    const summary = {
      generatedAt: new Date().toISOString(),
      window: 'last_30_days',
      perSource: rows.map((r) => ({
        source: r.source_name,
        total: Number(r.total),
        withNeighborhood: Number(r.with_neighborhood),
        withCoords: Number(r.with_coords),
        withStreet: Number(r.with_street),
        neighborhoodRate: Number(r.total) === 0 ? 0 : Number(r.with_neighborhood) / Number(r.total),
        coordRate: Number(r.total) === 0 ? 0 : Number(r.with_coords) / Number(r.total),
        streetRate: Number(r.total) === 0 ? 0 : Number(r.with_street) / Number(r.total),
      })),
    };

    await mkdir(OUT_DIR, { recursive: true });
    const outPath = join(OUT_DIR, 'baseline.json');
    await writeFile(outPath, JSON.stringify(summary, null, 2), 'utf8');

    console.log(`\nBaseline (last 30 days):`);
    for (const s of summary.perSource) {
      const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
      console.log(
        `  ${s.source.padEnd(12)} total=${String(s.total).padStart(6)}  neighborhood=${pct(s.neighborhoodRate)}  coords=${pct(s.coordRate)}  street=${pct(s.streetRate)}`,
      );
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
