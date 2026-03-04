/**
 * A/B test: Llama 3.1 8B vs Granite 4.0-h-micro for Hebrew rental extraction.
 *
 * Fetches recent Facebook posts from D1 and runs both models side by side,
 * comparing JSON parse rate, Zod validation rate, field accuracy, and latency.
 *
 * Uses Cloudflare AI Gateway (rentifier-ai-gateway) for all requests.
 *
 * Usage:
 *   pnpm tsx --env-file=.env scripts/ab-test-models.ts [--limit N] [--local] [--verbose]
 *
 * Required env vars:
 *   CF_ACCOUNT_ID, CF_API_TOKEN
 *   CF_D1_DATABASE_ID (remote mode only)
 */

import { aiExtract, type AiProvider, type AiExtractDetailedResult } from '../packages/extraction/src/ai-extractor';

const isLocal = process.argv.includes('--local');
const isVerbose = process.argv.includes('--verbose');
const limitArg = process.argv.find((_, i, arr) => arr[i - 1] === '--limit');
const SAMPLE_SIZE = limitArg ? parseInt(limitArg, 10) : 15;

const MODEL_A = '@cf/meta/llama-3.1-8b-instruct';
const MODEL_B = '@cf/ibm-granite/granite-4.0-h-micro';
const GATEWAY_ID = 'rentifier-ai-gateway';

/**
 * Cloudflare Workers AI provider routed through AI Gateway.
 * Logs raw HTTP status and response body for debugging.
 */
function createGatewayAiProvider(): AiProvider {
  const accountId = process.env.CF_ACCOUNT_ID;
  const apiToken = process.env.CF_API_TOKEN;
  if (!accountId || !apiToken) {
    throw new Error('Missing CF_ACCOUNT_ID or CF_API_TOKEN');
  }

  return {
    async run(model, input) {
      // AI Gateway URL format: https://gateway.ai.cloudflare.com/v1/{account}/{gateway}/workers-ai/{model}
      const url = `https://gateway.ai.cloudflare.com/v1/${accountId}/${GATEWAY_ID}/workers-ai/${model}`;

      if (isVerbose) {
        console.log(`    [request] POST ${url}`);
        console.log(`    [request] body keys: ${Object.keys(input).join(', ')}`);
        console.log(`    [request] prompt length: ${input.messages?.[0]?.content?.length ?? 0} chars`);
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
      });

      const rawBody = await res.text();

      if (isVerbose) {
        console.log(`    [response] HTTP ${res.status} ${res.statusText}`);
        console.log(`    [response] headers: content-type=${res.headers.get('content-type')}, cf-cache-status=${res.headers.get('cf-cache-status')}`);
        console.log(`    [response] body (first 500 chars): ${rawBody.slice(0, 500)}`);
      }

      if (!res.ok) {
        console.log(`    [error] HTTP ${res.status}: ${rawBody.slice(0, 300)}`);
        throw new Error(`AI Gateway error ${res.status}: ${rawBody.slice(0, 200)}`);
      }

      // Parse response — Workers AI wraps in { result: { response: "..." } }
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(rawBody);
      } catch {
        console.log(`    [error] Failed to parse response JSON: ${rawBody.slice(0, 200)}`);
        throw new Error('AI Gateway returned non-JSON response');
      }

      const result = data.result as Record<string, unknown> | undefined;
      // Llama format: { result: { response: "..." } }
      // Granite/OpenAI format: { result: { choices: [{ message: { content: "..." } }] } }
      let response = result?.response as string | undefined;
      if (!response && result?.choices) {
        const choices = result.choices as Array<{ message?: { content?: string } }>;
        response = choices[0]?.message?.content;
      }

      if (isVerbose) {
        console.log(`    [parsed] response type: ${typeof response}, length: ${response?.length ?? 0}`);
        if (response) {
          console.log(`    [parsed] response preview: ${response.slice(0, 300)}`);
        } else {
          console.log(`    [parsed] full data keys: ${JSON.stringify(Object.keys(data))}`);
          console.log(`    [parsed] full data: ${JSON.stringify(data).slice(0, 500)}`);
        }
      }

      return { response };
    },
  };
}

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
  const { D1RestClient } = await import('../packages/db/src/rest-client');
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
    // Facebook candidates use rawTitle + rawDescription
    const parts = [candidate.rawTitle, candidate.rawDescription].filter(Boolean);
    return parts.length > 0 ? parts.join('\n') : null;
  } catch {
    return null;
  }
}

interface ComparisonRow {
  postId: number;
  textPreview: string;
  modelA: AiExtractDetailedResult;
  modelB: AiExtractDetailedResult;
}

function statusLabel(r: AiExtractDetailedResult): string {
  if (r.ok) return 'OK';
  return `FAIL(${r.reason})`;
}

function fieldSummary(r: AiExtractDetailedResult): string {
  if (!r.ok) return '-';
  const d = r.data;
  const parts: string[] = [];
  if (d.price) parts.push(`price=${d.price.amount}`);
  if (d.city) parts.push(`city=${d.city}`);
  if (d.neighborhood) parts.push(`neighborhood=${d.neighborhood}`);
  if (d.street) parts.push(`street=${d.street}`);
  if (d.bedrooms !== null) parts.push(`beds=${d.bedrooms}`);
  if (d.floor !== null) parts.push(`floor=${d.floor}`);
  if (d.tags.length > 0) parts.push(`tags=[${d.tags.join(',')}]`);
  return parts.join(' | ') || '(empty)';
}

async function main() {
  console.log(`\n=== A/B Model Test ===`);
  console.log(`  Model A: ${MODEL_A}`);
  console.log(`  Model B: ${MODEL_B}`);
  console.log(`  Gateway: ${GATEWAY_ID}`);
  console.log(`  Sample:  ${SAMPLE_SIZE} posts`);
  console.log(`  Verbose: ${isVerbose}`);
  console.log(`  DB mode: ${isLocal ? 'local' : 'remote REST'}\n`);

  const posts = await fetchFacebookPosts(SAMPLE_SIZE);
  console.log(`Fetched ${posts.length} posts from DB.\n`);

  if (posts.length === 0) {
    console.log('No Facebook posts found. Run the collector first.');
    return;
  }

  const ai = createGatewayAiProvider();
  const comparisons: ComparisonRow[] = [];

  // Stats accumulators
  const stats = {
    [MODEL_A]: { total: 0, ok: 0, jsonFail: 0, zodFail: 0, nonRental: 0, timeout: 0, emptyResponse: 0, totalLatency: 0 },
    [MODEL_B]: { total: 0, ok: 0, jsonFail: 0, zodFail: 0, nonRental: 0, timeout: 0, emptyResponse: 0, totalLatency: 0 },
  };

  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    const text = extractTextFromCandidate(post.raw_json);
    if (!text || text.length < 100) {
      console.log(`[${i + 1}/${posts.length}] Post #${post.id} — text too short (${text?.length ?? 0} chars), skipping`);
      continue;
    }

    const preview = text.slice(0, 60).replace(/\n/g, ' ');
    console.log(`[${i + 1}/${posts.length}] Post #${post.id} (${text.length} chars): "${preview}..."`);

    // Run both models sequentially (avoid rate limits)
    console.log(`  Running Model A (Llama 8B)...`);
    const resultA = await aiExtract(text, ai, { model: MODEL_A, timeoutMs: 30000 });

    console.log(`  Running Model B (Granite micro)...`);
    const resultB = await aiExtract(text, ai, { model: MODEL_B, timeoutMs: 30000 });

    // Accumulate stats
    for (const [model, result] of [[MODEL_A, resultA], [MODEL_B, resultB]] as const) {
      const s = stats[model];
      s.total++;
      s.totalLatency += result.latencyMs;
      if (result.ok) {
        s.ok++;
      } else {
        switch (result.reason) {
          case 'json_parse': s.jsonFail++; break;
          case 'zod_validation': s.zodFail++; break;
          case 'non_rental': s.nonRental++; break;
          case 'timeout': s.timeout++; break;
          case 'empty_response': s.emptyResponse++; break;
        }
      }
    }

    console.log(`  A (Llama 8B):     ${statusLabel(resultA).padEnd(25)} ${String(resultA.latencyMs).padStart(6)}ms — ${fieldSummary(resultA)}`);
    console.log(`  B (Granite micro): ${statusLabel(resultB).padEnd(25)} ${String(resultB.latencyMs).padStart(6)}ms — ${fieldSummary(resultB)}`);

    // Field-level comparison when both succeed
    if (resultA.ok && resultB.ok) {
      const diffs: string[] = [];
      const a = resultA.data;
      const b = resultB.data;
      if (a.price?.amount !== b.price?.amount) diffs.push(`price: ${a.price?.amount} vs ${b.price?.amount}`);
      if (a.city !== b.city) diffs.push(`city: ${a.city} vs ${b.city}`);
      if (a.neighborhood !== b.neighborhood) diffs.push(`neighborhood: ${a.neighborhood} vs ${b.neighborhood}`);
      if (a.bedrooms !== b.bedrooms) diffs.push(`beds: ${a.bedrooms} vs ${b.bedrooms}`);
      if (a.street !== b.street) diffs.push(`street: ${a.street} vs ${b.street}`);
      if (diffs.length > 0) {
        console.log(`  DIFF: ${diffs.join(' | ')}`);
      } else {
        console.log(`  MATCH: Both models agree on all key fields`);
      }
    }

    comparisons.push({ postId: post.id, textPreview: preview, modelA: resultA, modelB: resultB });
    console.log('');
  }

  // Print summary
  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));

  const sA = stats[MODEL_A];
  const sB = stats[MODEL_B];

  if (sA.total === 0 || sB.total === 0) {
    console.log('Not enough data to compare.');
    return;
  }

  const pct = (n: number, total: number) => total > 0 ? `${Math.round((n / total) * 100)}%` : '-';

  const header = ['Metric', 'Llama 3.1 8B', 'Granite micro'];
  const rows: string[][] = [];

  rows.push(['Posts tested', String(sA.total), String(sB.total)]);
  rows.push(['Success (ok)', `${sA.ok} (${pct(sA.ok, sA.total)})`, `${sB.ok} (${pct(sB.ok, sB.total)})`]);
  rows.push(['Non-rental', `${sA.nonRental} (${pct(sA.nonRental, sA.total)})`, `${sB.nonRental} (${pct(sB.nonRental, sB.total)})`]);
  rows.push(['JSON parse fail', String(sA.jsonFail), String(sB.jsonFail)]);
  rows.push(['Zod validation fail', String(sA.zodFail), String(sB.zodFail)]);
  rows.push(['Timeout', String(sA.timeout), String(sB.timeout)]);
  rows.push(['Empty response', String(sA.emptyResponse), String(sB.emptyResponse)]);
  rows.push(['Avg latency', `${Math.round(sA.totalLatency / sA.total)}ms`, `${Math.round(sB.totalLatency / sB.total)}ms`]);

  // Count field agreement
  let bothOk = 0;
  let fieldMatch = 0;
  for (const c of comparisons) {
    if (c.modelA.ok && c.modelB.ok) {
      bothOk++;
      const a = c.modelA.data;
      const b = c.modelB.data;
      if (a.price?.amount === b.price?.amount && a.city === b.city && a.bedrooms === b.bedrooms) {
        fieldMatch++;
      }
    }
  }
  if (bothOk > 0) {
    rows.push(['Field agreement', `${fieldMatch}/${bothOk} posts match on price+city+beds`, '']);
  }

  // Print table
  const colWidths = [20, 22, 22];
  console.log(header.map((h, i) => h.padEnd(colWidths[i])).join(' '));
  console.log(colWidths.map(w => '-'.repeat(w)).join(' '));
  for (const row of rows) {
    console.log(row.map((cell, i) => cell.padEnd(colWidths[i])).join(' '));
  }

  // Verdict
  console.log('\n' + '='.repeat(70));
  const okRateB = sB.ok / sB.total;
  const okRateA = sA.ok / sA.total;

  if (sB.emptyResponse > sB.total * 0.5) {
    console.log('VERDICT: Granite returns empty responses too often.');
    console.log(`         ${sB.emptyResponse}/${sB.total} empty — the model likely cannot handle this task.`);
    console.log('         Stick with Llama 3.1 8B.');
  } else if (okRateB >= okRateA * 0.8 && sB.zodFail <= sA.total * 0.2) {
    console.log('VERDICT: Granite looks viable! Success rate is within 80% of Llama.');
    console.log('         Consider switching to save ~90% on AI costs.');
  } else if (sB.jsonFail + sB.zodFail > sA.total * 0.3) {
    console.log('VERDICT: Granite struggles with structured output.');
    console.log(`         ${sB.jsonFail} JSON failures + ${sB.zodFail} Zod failures is too many.`);
    console.log('         Stick with Llama 3.1 8B.');
  } else {
    console.log('VERDICT: Mixed results. Review individual post comparisons above.');
  }
  console.log('='.repeat(70) + '\n');
}

main().catch((err) => {
  console.error('Fatal:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
