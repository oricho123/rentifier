/**
 * Orchestrator for the neighborhood-resolver spike.
 *
 * Reads out/sample.json, runs every resolver against every listing, writes:
 *   - out/results.csv         (per-listing × per-resolver raw rows)
 *   - out/spike-results.md    (decision memo skeleton with aggregate metrics)
 *
 * Decision rule (spec P0 AC #6): pick the strategy with ≥80% hit rate AND
 * ≥70% canonical-name alignment. If both qualify, pick the simpler (live + cache).
 * If neither qualifies, escalate to a hybrid proposal in the memo.
 *
 * Usage:
 *   pnpm tsx --env-file=.env scripts/spike-neighborhoods/run-spike.ts
 *
 * Env toggles:
 *   SPIKE_GOVMAP_ENABLED=1    — actually call GovMap (requires wiring govmap.ts)
 *   SPIKE_USER_AGENT=...      — override User-Agent sent to Nominatim / Overpass
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveGovmap } from './resolvers/govmap';
import { resolveNominatim } from './resolvers/nominatim';
import { resolveOsmPolygon } from './resolvers/osm-polygons';
import type {
  ResolveAttempt,
  ResolverId,
  ResolveStatus,
  SampleFile,
  SampleListing,
} from './types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'out');
const SAMPLE_PATH = join(OUT_DIR, 'sample.json');
const CSV_PATH = join(OUT_DIR, 'results.csv');
const MEMO_PATH = join(OUT_DIR, 'spike-results.md');

interface ResolverSpec {
  id: ResolverId;
  run: (listing: SampleListing) => Promise<ResolveAttempt>;
}

const RESOLVERS: ResolverSpec[] = [
  { id: 'osm_polygon', run: resolveOsmPolygon },
  { id: 'govmap', run: resolveGovmap },
  { id: 'nominatim', run: resolveNominatim },
];

interface AggMetrics {
  total: number;
  considered: number; /** excludes miss_no_input */
  hitCanonical: number;
  hitUnknown: number;
  miss: number;
  errors: number;
  latencyMs: number[];
}

function newAgg(): AggMetrics {
  return {
    total: 0,
    considered: 0,
    hitCanonical: 0,
    hitUnknown: 0,
    miss: 0,
    errors: 0,
    latencyMs: [],
  };
}

function bucket(status: ResolveStatus): 'hit_c' | 'hit_u' | 'miss' | 'err' | 'n/a' {
  switch (status) {
    case 'hit_canonical':
      return 'hit_c';
    case 'hit_unknown':
      return 'hit_u';
    case 'miss_out_of_coverage':
    case 'miss_ambiguous':
      return 'miss';
    case 'miss_no_input':
      return 'n/a';
    case 'error_timeout':
    case 'error_rate_limited':
    case 'error_provider':
    case 'error_not_implemented':
      return 'err';
  }
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main(): Promise<void> {
  const sampleRaw = await readFile(SAMPLE_PATH, 'utf8').catch(() => {
    throw new Error(
      `Sample file not found at ${SAMPLE_PATH}. Run sample-listings.ts first.`,
    );
  });
  const sample = JSON.parse(sampleRaw) as SampleFile;
  console.log(`\nRunning spike against ${sample.count} listings...\n`);

  const allAttempts: ResolveAttempt[] = [];
  const perResolver = new Map<ResolverId, AggMetrics>();
  for (const r of RESOLVERS) perResolver.set(r.id, newAgg());

  for (const [idx, listing] of sample.listings.entries()) {
    process.stdout.write(`  [${String(idx + 1).padStart(3)}/${sample.count}] #${listing.id} ${listing.bucket} ${listing.city ?? '?'} ...`);
    for (const resolver of RESOLVERS) {
      const attempt = await resolver.run(listing);
      allAttempts.push(attempt);
      const agg = perResolver.get(resolver.id)!;
      agg.total++;
      const b = bucket(attempt.status);
      if (b === 'n/a') continue;
      agg.considered++;
      agg.latencyMs.push(attempt.latencyMs);
      if (b === 'hit_c') agg.hitCanonical++;
      else if (b === 'hit_u') agg.hitUnknown++;
      else if (b === 'miss') agg.miss++;
      else if (b === 'err') agg.errors++;
    }
    process.stdout.write(' done\n');
  }

  await mkdir(OUT_DIR, { recursive: true });

  const csvRows: string[] = [
    [
      'listing_id',
      'source',
      'bucket',
      'city',
      'current_neighborhood',
      'latitude',
      'longitude',
      'street',
      'resolver',
      'status',
      'raw_name',
      'canonical_name',
      'latency_ms',
      'error',
    ].join(','),
  ];
  const listingById = new Map(sample.listings.map((l) => [l.id, l] as const));
  for (const a of allAttempts) {
    const l = listingById.get(a.listingId)!;
    csvRows.push(
      [
        l.id,
        l.source,
        l.bucket,
        l.city,
        l.neighborhood,
        l.latitude,
        l.longitude,
        l.street,
        a.resolver,
        a.status,
        a.rawName,
        a.canonicalName,
        a.latencyMs,
        a.error ?? '',
      ]
        .map(csvCell)
        .join(','),
    );
  }
  await writeFile(CSV_PATH, csvRows.join('\n'), 'utf8');

  const lines: string[] = [];
  lines.push('# Spike Results — Neighborhood Resolver Strategy');
  lines.push('');
  lines.push(`- Sample: **${sample.count} listings** generated ${sample.generatedAt}`);
  lines.push('- Stratum:');
  for (const [k, v] of Object.entries(sample.stratum)) lines.push(`  - ${k}: ${v}`);
  lines.push('');
  lines.push('## Aggregate metrics');
  lines.push('');
  lines.push('| Resolver | Considered | Hit (canonical) | Hit (unknown) | Miss | Errors | Hit rate | Alignment | p50 ms | p95 ms |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');

  type Summary = {
    id: ResolverId;
    hitRate: number;
    alignment: number;
    considered: number;
  };
  const summaries: Summary[] = [];

  for (const { id } of RESOLVERS) {
    const m = perResolver.get(id)!;
    const considered = m.considered;
    const hits = m.hitCanonical + m.hitUnknown;
    const hitRate = considered === 0 ? 0 : hits / considered;
    const alignment = hits === 0 ? 0 : m.hitCanonical / hits;
    const p50 = percentile(m.latencyMs, 50);
    const p95 = percentile(m.latencyMs, 95);
    summaries.push({ id, hitRate, alignment, considered });
    const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
    lines.push(
      `| ${id} | ${considered} | ${m.hitCanonical} | ${m.hitUnknown} | ${m.miss} | ${m.errors} | ${pct(hitRate)} | ${pct(alignment)} | ${p50} | ${p95} |`,
    );
  }
  lines.push('');

  lines.push('## Decision');
  lines.push('');
  lines.push('**Decision rule:** pick the strategy with ≥80% hit rate AND ≥70% canonical-name alignment. If both qualify, pick the simpler (live + cache). If neither qualifies, propose a hybrid.');
  lines.push('');
  const qualified = summaries.filter((s) => s.hitRate >= 0.8 && s.alignment >= 0.7);
  if (qualified.length === 0) {
    lines.push('- **Result:** no resolver met both thresholds on its own. Hybrid proposal required — see notes below.');
  } else if (qualified.length === 1) {
    lines.push(`- **Result:** \`${qualified[0].id}\` is the only qualifier. Recommend adopting it as Strategy for P1.`);
  } else {
    const liveFirst = qualified.find((s) => s.id !== 'osm_polygon') ?? qualified[0];
    lines.push(`- **Result:** multiple qualifiers (${qualified.map((q) => q.id).join(', ')}). Tie-break = simpler → recommend \`${liveFirst.id}\` (live + cache is lower operational overhead than maintaining a polygon bundle).`);
  }
  lines.push('');
  lines.push('## Notes / follow-ups');
  lines.push('- Unknown raw names (status = `hit_unknown`) are candidates for inclusion in `CITY_NEIGHBORHOODS`. Review `results.csv` for the list.');
  lines.push('- If GovMap shows `error_not_implemented`, the stub at `scripts/spike-neighborhoods/resolvers/govmap.ts` still needs wiring. Re-run after wiring; append an updated table above and keep both passes for history.');
  lines.push('- Paste this file to `.specs/features/neighborhood-extraction-coverage/spike-results.md` and record an AD in `.specs/project/STATE.md` with the final choice + reasoning.');
  lines.push('');

  await writeFile(MEMO_PATH, lines.join('\n'), 'utf8');
  console.log(`\nWrote ${CSV_PATH}`);
  console.log(`Wrote ${MEMO_PATH}\n`);

  for (const s of summaries) {
    const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
    console.log(`  ${s.id.padEnd(14)} considered=${String(s.considered).padStart(3)}  hit=${pct(s.hitRate)}  alignment=${pct(s.alignment)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
