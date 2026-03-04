/**
 * AI extraction evaluation script.
 *
 * Runs aiExtract() against the golden dataset and computes detailed metrics:
 * success rate, failure breakdown, field-level accuracy, and category stats.
 *
 * Usage:
 *   pnpm tsx --env-file=.env scripts/eval/run-eval.ts [options]
 *
 * Options:
 *   --model <model>       Model to evaluate (default: @cf/meta/llama-3.1-8b-instruct)
 *   --golden <path>       Path to golden dataset (default: scripts/eval/golden-dataset.json)
 *   --output <path>       Write JSON results to file
 *   --quick <N>           Run against N randomly-selected golden posts (fast feedback)
 *   --category <cat>      Filter golden dataset by category
 *   --timeout <ms>        Per-request timeout (default: 30000)
 *
 * Required env vars:
 *   CF_ACCOUNT_ID, CF_API_TOKEN
 */

import { readFileSync } from 'fs';
import { writeFileSync } from 'fs';
import { aiExtract, type AiProvider, type AiExtractionResult, type AiExtractDetailedResult } from '../../packages/extraction/src/ai-extractor';

// --- CLI args ---
function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

const MODEL = getArg('--model') ?? '@cf/meta/llama-3.1-8b-instruct';
const GOLDEN_PATH = getArg('--golden') ?? 'scripts/eval/golden-dataset.json';
const OUTPUT_PATH = getArg('--output');
const QUICK_N = getArg('--quick') ? parseInt(getArg('--quick')!, 10) : undefined;
const CATEGORY_FILTER = getArg('--category');
const TIMEOUT_MS = getArg('--timeout') ? parseInt(getArg('--timeout')!, 10) : 30000;
const GATEWAY_ID = 'rentifier-ai-gateway';

// --- Types ---
interface GoldenEntry {
  id: string;
  sourcePostId: string;
  url?: string | null;
  category: string;
  text: string;
  expected: {
    isRental: boolean;
    price?: { amount: number; currency: string; period: string } | null;
    bedrooms?: number | null;
    city?: string | null;
    neighborhood?: string | null;
    street?: string | null;
    floor?: number | null;
    squareMeters?: number | null;
    entryDate?: string | null;
    tags?: string[];
  };
  notes?: string;
}

interface FieldAccuracy {
  correct: number;
  wrong_value: number;
  missing: number;
  hallucinated: number;
  total: number;
  rate: number;
}

interface EvalResults {
  run: {
    timestamp: string;
    model: string;
    dataSource: string;
    totalPosts: number;
  };
  overall: {
    successRate: number;
    ok: number;
    failed: number;
  };
  failureBreakdown: Record<string, number>;
  fieldAccuracy: Record<string, FieldAccuracy>;
  categoryBreakdown: Record<string, { ok: number; total: number; rate: number }>;
  postDetails: Array<{
    id: string;
    category: string;
    status: 'correct' | 'ok_with_mismatches' | 'failed';
    reason?: string;
    textPreview: string;
    rawResponse?: string;
    fieldMismatches?: Array<{
      field: string;
      type: 'wrong_value' | 'missing' | 'hallucinated';
      expected: unknown;
      actual: unknown;
    }>;
  }>;
}

// --- AI Provider ---
function createGatewayAiProvider(): AiProvider {
  const accountId = process.env.CF_ACCOUNT_ID;
  const apiToken = process.env.CF_API_TOKEN;
  if (!accountId || !apiToken) {
    throw new Error('Missing CF_ACCOUNT_ID or CF_API_TOKEN');
  }

  return {
    async run(model, input) {
      const url = `https://gateway.ai.cloudflare.com/v1/${accountId}/${GATEWAY_ID}/workers-ai/${model}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
      });

      const rawBody = await res.text();
      if (!res.ok) {
        throw new Error(`AI Gateway error ${res.status}: ${rawBody.slice(0, 200)}`);
      }

      let data: Record<string, unknown>;
      try {
        data = JSON.parse(rawBody);
      } catch {
        throw new Error('AI Gateway returned non-JSON response');
      }

      const result = data.result as Record<string, unknown> | undefined;
      let response = result?.response as string | undefined;
      if (!response && result?.choices) {
        const choices = result.choices as Array<{ message?: { content?: string } }>;
        response = choices[0]?.message?.content;
      }

      // Stash raw response for debugging failures
      (this as any).__lastRawResponse = response ?? rawBody.slice(0, 500);

      return { response };
    },
  };
}

// --- Hebrew string normalization for comparison ---
function normalizeHebrew(s: string): string {
  return s
    // Normalize Hebrew geresh ׳ (U+05F3) and gershayim ״ (U+05F4) to ASCII equivalents
    .replace(/\u05F3/g, "'")
    .replace(/\u05F4/g, '"')
    // Normalize leading ה (definite article) — "הצפון הישן" matches "צפון הישן"
    .replace(/^ה/, '')
    .trim();
}

// --- Field comparison ---
function compareField(
  fieldName: string,
  expected: unknown,
  actual: unknown
): 'correct' | 'wrong_value' | 'missing' | 'hallucinated' {
  if (fieldName === 'price') {
    const exp = expected as { amount: number; currency: string } | null | undefined;
    const act = actual as { amount: number; currency: string } | null | undefined;
    if (exp == null && act == null) return 'correct';
    if (exp != null && act == null) return 'missing';
    if (exp == null && act != null) return 'hallucinated';
    if (exp!.amount === act!.amount && exp!.currency === act!.currency) return 'correct';
    return 'wrong_value';
  }

  if (fieldName === 'tags') {
    const exp = new Set((expected as string[] | undefined) ?? []);
    const act = new Set((actual as string[] | undefined) ?? []);
    if (exp.size === act.size && [...exp].every((t) => act.has(t))) return 'correct';
    if (exp.size === 0 && act.size > 0) return 'hallucinated';
    if (exp.size > 0 && act.size === 0) return 'missing';
    return 'wrong_value';
  }

  // String fields: normalize Hebrew before comparing
  if (typeof expected === 'string' && typeof actual === 'string') {
    if (normalizeHebrew(expected) === normalizeHebrew(actual)) return 'correct';
    return 'wrong_value';
  }

  // Default: strict equality
  if (expected == null && actual == null) return 'correct';
  if (expected != null && actual == null) return 'missing';
  if (expected == null && actual != null) return 'hallucinated';
  if (expected === actual) return 'correct';
  return 'wrong_value';
}

// --- Main ---
async function main() {
  // Load golden dataset
  let golden: GoldenEntry[];
  try {
    golden = JSON.parse(readFileSync(GOLDEN_PATH, 'utf-8'));
  } catch (err) {
    console.error(`Failed to read golden dataset at ${GOLDEN_PATH}`);
    console.error(err instanceof Error ? err.message : String(err));
    console.error('\nRun export-samples.ts --golden-template first, then label the posts.');
    process.exit(1);
  }

  // Filter by category
  if (CATEGORY_FILTER) {
    golden = golden.filter((g) => g.category === CATEGORY_FILTER);
    if (golden.length === 0) {
      console.error(`No posts found with category '${CATEGORY_FILTER}'`);
      process.exit(1);
    }
  }

  // Quick mode: random subset
  if (QUICK_N && QUICK_N < golden.length) {
    const shuffled = [...golden].sort(() => Math.random() - 0.5);
    golden = shuffled.slice(0, QUICK_N);
  }

  console.log(`\n=== AI Extraction Eval ===`);
  console.log(`  Model:    ${MODEL}`);
  console.log(`  Dataset:  ${GOLDEN_PATH} (${golden.length} posts)`);
  console.log(`  Timeout:  ${TIMEOUT_MS}ms`);
  if (CATEGORY_FILTER) console.log(`  Category: ${CATEGORY_FILTER}`);
  if (QUICK_N) console.log(`  Quick:    ${QUICK_N} posts`);
  console.log('');

  const ai = createGatewayAiProvider();

  // Accumulators
  let okCount = 0;
  let failCount = 0;
  const failureBreakdown: Record<string, number> = {
    json_parse: 0,
    zod_validation: 0,
    non_rental: 0,
    empty_response: 0,
    timeout: 0,
  };

  const fields = ['isRental', 'price', 'bedrooms', 'city', 'neighborhood', 'street', 'floor', 'squareMeters', 'tags'] as const;
  const fieldAccuracy: Record<string, FieldAccuracy> = {};
  for (const f of fields) {
    fieldAccuracy[f] = { correct: 0, wrong_value: 0, missing: 0, hallucinated: 0, total: 0, rate: 0 };
  }

  const categoryStats: Record<string, { ok: number; total: number }> = {};
  const postDetails: EvalResults['postDetails'] = [];

  for (let i = 0; i < golden.length; i++) {
    const entry = golden[i];
    const preview = entry.text.slice(0, 80).replace(/\n/g, ' ');
    process.stdout.write(`[${i + 1}/${golden.length}] ${entry.id} (${entry.category}): `);

    const result = await aiExtract(entry.text, ai, { model: MODEL, timeoutMs: TIMEOUT_MS });

    // Category tracking
    if (!categoryStats[entry.category]) {
      categoryStats[entry.category] = { ok: 0, total: 0 };
    }
    categoryStats[entry.category].total++;

    // Non-rental scoring
    if (!entry.expected.isRental) {
      // Expected non-rental
      if (!result.ok && result.reason === 'non_rental') {
        // Correct: model rejected a non-rental
        okCount++;
        categoryStats[entry.category].ok++;
        fieldAccuracy.isRental.correct++;
        fieldAccuracy.isRental.total++;
        console.log(`CORRECT (non-rental correctly rejected) ${result.latencyMs}ms`);
        postDetails.push({
          id: entry.id,
          category: entry.category,
          status: 'correct',
          textPreview: preview,
        });
      } else if (result.ok) {
        // Wrong: model thought it was a rental
        failCount++;
        fieldAccuracy.isRental.wrong_value++;
        fieldAccuracy.isRental.total++;
        console.log(`WRONG (non-rental classified as rental) ${result.latencyMs}ms`);
        postDetails.push({
          id: entry.id,
          category: entry.category,
          status: 'failed',
          reason: 'false_positive_rental',
          textPreview: preview,
        });
      } else {
        // Model failed for other reason on a non-rental — count as failure
        failCount++;
        failureBreakdown[result.reason] = (failureBreakdown[result.reason] ?? 0) + 1;
        fieldAccuracy.isRental.total++;
        fieldAccuracy.isRental.wrong_value++;
        console.log(`FAIL(${result.reason}) ${result.latencyMs}ms`);
        postDetails.push({
          id: entry.id,
          category: entry.category,
          status: 'failed',
          reason: result.reason,
          textPreview: preview,
          rawResponse: (ai as Record<string, unknown>).__lastRawResponse as string | undefined,
        });
      }
      continue;
    }

    // Expected rental
    if (result.ok) {
      okCount++;
      categoryStats[entry.category].ok++;
      console.log(`OK ${result.latencyMs}ms`);

      // Field-level accuracy
      fieldAccuracy.isRental.correct++;
      fieldAccuracy.isRental.total++;

      const mismatches: NonNullable<EvalResults['postDetails'][number]['fieldMismatches']> = [];

      for (const field of fields) {
        if (field === 'isRental') continue; // Already counted
        const expectedVal = entry.expected[field as keyof typeof entry.expected];
        const actualVal = result.data[field as keyof AiExtractionResult];
        const comparison = compareField(field, expectedVal, actualVal);

        fieldAccuracy[field][comparison]++;
        fieldAccuracy[field].total++;

        if (comparison !== 'correct') {
          process.stdout.write(`  ${field}: ${comparison} (expected=${JSON.stringify(expectedVal)}, got=${JSON.stringify(actualVal)})\n`);
          mismatches.push({ field, type: comparison, expected: expectedVal, actual: actualVal });
        }
      }

      postDetails.push({
        id: entry.id,
        category: entry.category,
        status: mismatches.length === 0 ? 'correct' : 'ok_with_mismatches',
        textPreview: preview,
        fieldMismatches: mismatches.length > 0 ? mismatches : undefined,
      });
    } else if (result.reason === 'non_rental') {
      // Wrong: model rejected a real rental
      failCount++;
      fieldAccuracy.isRental.wrong_value++;
      fieldAccuracy.isRental.total++;
      console.log(`WRONG (rental rejected as non-rental) ${result.latencyMs}ms`);
      postDetails.push({
        id: entry.id,
        category: entry.category,
        status: 'failed',
        reason: 'false_negative_rental',
        textPreview: preview,
      });
    } else {
      // Parse/validation/timeout failure
      failCount++;
      failureBreakdown[result.reason] = (failureBreakdown[result.reason] ?? 0) + 1;
      console.log(`FAIL(${result.reason}) ${result.latencyMs}ms`);
      postDetails.push({
        id: entry.id,
        category: entry.category,
        status: 'failed',
        reason: result.reason,
        textPreview: preview,
        rawResponse: (ai as Record<string, unknown>).__lastRawResponse as string | undefined,
      });
    }
  }

  // Compute rates
  const total = okCount + failCount;
  for (const f of fields) {
    const fa = fieldAccuracy[f];
    fa.rate = fa.total > 0 ? Math.round((fa.correct / fa.total) * 1000) / 1000 : 0;
  }

  const categoryBreakdown: Record<string, { ok: number; total: number; rate: number }> = {};
  for (const [cat, stats] of Object.entries(categoryStats)) {
    categoryBreakdown[cat] = {
      ...stats,
      rate: stats.total > 0 ? Math.round((stats.ok / stats.total) * 1000) / 1000 : 0,
    };
  }

  const results: EvalResults = {
    run: {
      timestamp: new Date().toISOString(),
      model: MODEL,
      dataSource: GOLDEN_PATH,
      totalPosts: total,
    },
    overall: {
      successRate: total > 0 ? Math.round((okCount / total) * 1000) / 1000 : 0,
      ok: okCount,
      failed: failCount,
    },
    failureBreakdown,
    fieldAccuracy,
    categoryBreakdown,
    postDetails,
  };

  // --- Print summary ---
  console.log('\n' + '='.repeat(70));
  console.log('EVAL RESULTS');
  console.log('='.repeat(70));

  const pct = (n: number) => `${Math.round(n * 100)}%`;

  console.log(`\nModel: ${MODEL}`);
  console.log(`Posts: ${total}`);
  console.log(`Success: ${okCount}/${total} (${pct(results.overall.successRate)})`);
  console.log(`Failed:  ${failCount}/${total}`);

  console.log(`\nFailure Breakdown:`);
  for (const [reason, count] of Object.entries(failureBreakdown)) {
    if (count > 0) console.log(`  ${reason}: ${count}`);
  }

  console.log(`\nField Accuracy:`);
  const fieldHeader = ['Field', 'Rate', 'Correct', 'Wrong', 'Missing', 'Halluc.', 'Total'];
  const fw = [16, 8, 8, 8, 8, 8, 6];
  console.log(fieldHeader.map((h, i) => h.padEnd(fw[i])).join(''));
  console.log(fw.map((w) => '-'.repeat(w)).join(''));
  for (const f of fields) {
    const fa = fieldAccuracy[f];
    if (fa.total === 0) continue;
    const row = [
      f,
      pct(fa.rate),
      String(fa.correct),
      String(fa.wrong_value),
      String(fa.missing),
      String(fa.hallucinated),
      String(fa.total),
    ];
    console.log(row.map((cell, i) => cell.padEnd(fw[i])).join(''));
  }

  console.log(`\nCategory Breakdown:`);
  for (const [cat, stats] of Object.entries(categoryBreakdown)) {
    console.log(`  ${cat}: ${stats.ok}/${stats.total} (${pct(stats.rate)})`);
  }

  const problemPosts = postDetails.filter((p) => p.status !== 'correct');
  if (problemPosts.length > 0) {
    console.log(`\nPost Details (${problemPosts.length} with issues):`);
    for (const p of problemPosts) {
      const label = p.status === 'failed' ? `FAIL(${p.reason})` : `OK (${p.fieldMismatches?.length} mismatches)`;
      console.log(`  ${p.id} [${p.category}] — ${label}`);
      console.log(`    text: "${p.textPreview}..."`);
      if (p.rawResponse) {
        console.log(`    raw:  "${p.rawResponse.slice(0, 200)}..."`);
      }
      if (p.fieldMismatches) {
        for (const m of p.fieldMismatches) {
          console.log(`    ${m.field}: ${m.type} (expected=${JSON.stringify(m.expected)}, got=${JSON.stringify(m.actual)})`);
        }
      }
    }
  }

  console.log('\n' + '='.repeat(70));

  // Save results
  if (OUTPUT_PATH) {
    writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2) + '\n');
    console.log(`Results written to: ${OUTPUT_PATH}`);
  }
}

main().catch((err) => {
  console.error('Fatal:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
