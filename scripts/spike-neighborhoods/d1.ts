/**
 * Thin helper to pick between local and remote D1 for the spike scripts.
 *
 * Usage:
 *   const db = await openD1({ local: process.argv.includes('--local') });
 *   const rows = await db.query<MyRow>('SELECT ...', [param]);
 */

import type { D1RestClient } from '../../packages/db/src/rest-client';

export interface SpikeD1 {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]>;
  dispose?(): Promise<void>;
}

export async function openD1({ local }: { local: boolean }): Promise<SpikeD1> {
  if (local) {
    const { getPlatformProxy } = await import('wrangler');
    const proxy = await getPlatformProxy({
      configPath: 'apps/collector/wrangler.json',
      persist: { path: '.wrangler/v3' },
    });
    const d1 = proxy.env.DB as any;
    return {
      async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
        const res = await d1.prepare(sql).bind(...params).all();
        return res.results as T[];
      },
      async dispose() {
        await proxy.dispose();
      },
    };
  }

  const accountId = process.env.CF_ACCOUNT_ID;
  const apiToken = process.env.CF_API_TOKEN;
  const databaseId = process.env.CF_D1_DATABASE_ID;
  if (!accountId || !apiToken || !databaseId) {
    throw new Error(
      'Remote D1 requires CF_ACCOUNT_ID, CF_API_TOKEN, CF_D1_DATABASE_ID (see .env). Pass --local to use the local D1 instead.',
    );
  }

  const { D1RestClient: Ctor } = (await import('../../packages/db/src/rest-client')) as {
    D1RestClient: new (cfg: { accountId: string; apiToken: string; databaseId: string }) => D1RestClient;
  };
  const client = new Ctor({ accountId, apiToken, databaseId });

  return {
    async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
      const res = await client.query(sql, params);
      return res.results as unknown as T[];
    },
  };
}
