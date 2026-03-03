/**
 * GitHub Actions scraper for Facebook Groups.
 *
 * Uses Playwright headless browser to scrape posts from Facebook group feeds.
 *
 * Modes:
 *   --local   Use local D1 database (via wrangler getPlatformProxy)
 *   default   Use remote D1 via REST API (for GitHub Actions)
 *
 * Required env vars (remote mode / GitHub Actions secrets):
 *   CF_ACCOUNT_ID        — Cloudflare account ID
 *   CF_API_TOKEN         — Cloudflare API token with D1:Edit permission
 *   CF_D1_DATABASE_ID    — D1 database ID
 *
 * Required env vars (both modes):
 *   FB_ACCOUNT_COUNT     — Number of Facebook accounts (default: 1)
 *   FB_COOKIES_1..N      — Cookie strings per account
 *   TELEGRAM_BOT_TOKEN   — Telegram bot token (for admin alerts, optional)
 *   TELEGRAM_ADMIN_CHAT_ID — Admin's Telegram chat ID (optional)
 */

import { FacebookConnector } from '@rentifier/connectors/src/facebook';
import { FacebookClientError } from '@rentifier/connectors/src/facebook/client';
import { createRestDBFromEnv } from '@rentifier/db';
import type { DB } from '@rentifier/db';

const isLocal = process.argv.includes('--local');

async function getDB(): Promise<{ db: DB; cleanup?: () => Promise<void> }> {
  if (isLocal) {
    // Use wrangler's getPlatformProxy to get local D1 binding
    const { getPlatformProxy } = await import('wrangler');
    const proxy = await getPlatformProxy({
      configPath: 'apps/collector/wrangler.json',
      persist: { path: '.wrangler/v3' },
    });
    // Import createDB dynamically to avoid ESM resolution issues with D1Database types
    const { createDB } = await import('@rentifier/db/src/queries');
    const db = createDB(proxy.env.DB as never);
    return { db, cleanup: () => proxy.dispose() };
  }
  return { db: createRestDBFromEnv() };
}

/**
 * Send a Telegram notification to the admin about cookie expiry.
 * Fails silently — logging errors but never crashing the script.
 */
async function notifyAdminCookieExpiry(
  accountId: string,
  errorType: string,
): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;

  if (!botToken || !chatId) {
    console.log(
      JSON.stringify({
        event: 'fb_admin_notify_skip',
        reason: 'TELEGRAM_BOT_TOKEN or TELEGRAM_ADMIN_CHAT_ID not set',
      }),
    );
    return;
  }

  const message =
    `⚠️ Facebook account #${accountId} ${errorType === 'banned' ? 'banned/challenged' : 'cookie expired'}.\n\n` +
    `Please refresh cookies in GitHub Secrets (FB_COOKIES_${accountId}).`;

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: 'HTML',
        }),
      },
    );

    if (!response.ok) {
      console.log(
        JSON.stringify({
          event: 'fb_admin_notify_failed',
          status: response.status,
          accountId,
        }),
      );
    } else {
      console.log(
        JSON.stringify({ event: 'fb_admin_notify_sent', accountId }),
      );
    }
  } catch (err) {
    console.log(
      JSON.stringify({
        event: 'fb_admin_notify_error',
        error: err instanceof Error ? err.message : String(err),
        accountId,
      }),
    );
  }
}

async function main() {
  const { db, cleanup } = await getDB();
  if (isLocal) console.log('Using local D1 database');

  // Resolve facebook source row
  const sources = await db.getEnabledSources();
  const source = sources.find((s) => s.name === 'facebook');
  if (!source) {
    console.log(
      JSON.stringify({
        event: 'collect_skip',
        reason: 'facebook source not found or disabled',
      }),
    );
    return;
  }

  // Read current cursor
  const sourceState = await db.getSourceState(source.id);
  const cursor = sourceState?.cursor ?? null;

  console.log(
    JSON.stringify({
      event: 'collect_start',
      source: 'facebook',
      sourceId: source.id,
      hasCursor: !!cursor,
    }),
  );

  const connector = new FacebookConnector();
  let candidates: Awaited<ReturnType<typeof connector.fetchNew>>['candidates'];
  let nextCursor: string | null;

  try {
    ({ candidates, nextCursor } = await connector.fetchNew(cursor, db));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      JSON.stringify({ event: 'collect_error', source: 'facebook', error: message }),
    );

    // Notify admin on cookie/ban errors
    if (err instanceof FacebookClientError) {
      if (err.errorType === 'auth_expired' || err.errorType === 'banned') {
        await notifyAdminCookieExpiry('unknown', err.errorType);
      }
    }

    await db.updateSourceState(source.id, {
      last_run_at: new Date().toISOString(),
      last_status: 'error',
      last_error: message,
    });
    process.exit(1);
  }

  // Check cursor for newly disabled accounts and notify admin
  if (nextCursor) {
    try {
      const state = JSON.parse(nextCursor);
      const prevState = cursor ? JSON.parse(cursor) : { disabledAccounts: [] };
      const newlyDisabled = (state.disabledAccounts || []).filter(
        (id: string) => !(prevState.disabledAccounts || []).includes(id),
      );
      for (const accountId of newlyDisabled) {
        await notifyAdminCookieExpiry(accountId, 'auth_expired');
      }
    } catch {
      // Cursor parse failed — skip notification check
    }
  }

  console.log(
    JSON.stringify({
      event: 'collect_fetched',
      source: 'facebook',
      candidateCount: candidates.length,
    }),
  );

  // Insert raw listings
  if (candidates.length > 0) {
    await db.insertRawListings(
      candidates.map((c) => ({
        source_id: source.id,
        source_item_id: c.sourceItemId,
        url: c.rawUrl,
        raw_json: JSON.stringify(c),
      })),
    );
  }

  // Update source state
  await db.updateSourceState(source.id, {
    cursor: nextCursor,
    last_run_at: new Date().toISOString(),
    last_status: 'ok',
    last_error: null,
  });

  console.log(
    JSON.stringify({
      event: 'collect_complete',
      source: 'facebook',
      candidateCount: candidates.length,
    }),
  );

  if (cleanup) await cleanup();
}

main().catch((err) => {
  console.error(
    'Fatal:',
    err instanceof Error ? err.message : String(err),
  );
  process.exit(1);
});
