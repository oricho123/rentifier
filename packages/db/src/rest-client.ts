import type { D1Database } from '@cloudflare/workers-types';
import type { DB } from './queries';
import { createDB } from './queries';

export interface D1RestConfig {
  accountId: string;
  apiToken: string;
  databaseId: string;
}

export class D1RestError extends Error {
  constructor(
    message: string,
    public readonly errors: unknown[],
  ) {
    super(message);
    this.name = 'D1RestError';
  }
}

interface D1RestResponse {
  success: boolean;
  errors: unknown[];
  result: { results: Record<string, unknown>[]; meta?: Record<string, unknown> }[];
}

export class D1RestClient {
  private readonly url: string;
  private readonly headers: Record<string, string>;

  constructor(private readonly config: D1RestConfig) {
    this.url = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/d1/database/${config.databaseId}/query`;
    this.headers = {
      'Authorization': `Bearer ${config.apiToken}`,
      'Content-Type': 'application/json',
    };
  }

  async query(sql: string, params: unknown[] = []): Promise<{ results: Record<string, unknown>[]; meta?: Record<string, unknown> }> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ sql, params }),
    });

    const data = (await res.json()) as D1RestResponse;
    if (!data.success) {
      throw new D1RestError(`D1 REST query failed: ${JSON.stringify(data.errors)}`, data.errors);
    }
    return data.result[0];
  }

  // D1Database interface shim

  prepare(sql: string): RestPreparedStatement {
    return new RestPreparedStatement(this, sql);
  }

  async batch(stmts: RestPreparedStatement[]): Promise<unknown[]> {
    const results: unknown[] = [];
    for (const stmt of stmts) {
      results.push(await stmt.all());
    }
    return results;
  }

  dump(): never {
    throw new Error('dump() is not supported via D1 REST API');
  }

  exec(): never {
    throw new Error('exec() is not supported via D1 REST API');
  }
}

class RestPreparedStatement {
  private params: unknown[] = [];

  constructor(
    private readonly client: D1RestClient,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]): RestPreparedStatement {
    const stmt = new RestPreparedStatement(this.client, this.sql);
    stmt.params = values;
    return stmt;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    const result = await this.client.query(this.sql, this.params);
    return { results: result.results as T[] };
  }

  async first<T = Record<string, unknown>>(col?: string): Promise<T | null> {
    const result = await this.client.query(this.sql, this.params);
    const row = result.results[0];
    if (!row) return null;
    if (col) return (row as Record<string, unknown>)[col] as T;
    return row as T;
  }

  async run(): Promise<{ success: boolean; meta: Record<string, unknown> }> {
    const result = await this.client.query(this.sql, this.params);
    return { success: true, meta: result.meta ?? {} };
  }

  async raw<T = unknown[]>(): Promise<T[]> {
    const result = await this.client.query(this.sql, this.params);
    return result.results.map(row => Object.values(row)) as T[];
  }
}

export function createRestDB(config: D1RestConfig): DB {
  const client = new D1RestClient(config);
  return createDB(client as unknown as D1Database);
}

/**
 * Convenience factory that reads config from environment variables.
 * Only usable in Node.js environments (scripts, CI), not in Workers.
 */
export function createRestDBFromEnv(): DB {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const env = (globalThis as Record<string, unknown>).process as { env: Record<string, string | undefined> } | undefined;
  if (!env) throw new Error('createRestDBFromEnv requires a Node.js environment');

  const accountId = env.env.CF_ACCOUNT_ID;
  const apiToken = env.env.CF_API_TOKEN;
  const databaseId = env.env.CF_D1_DATABASE_ID;

  if (!accountId || !apiToken || !databaseId) {
    throw new Error('Missing required env vars: CF_ACCOUNT_ID, CF_API_TOKEN, CF_D1_DATABASE_ID');
  }

  return createRestDB({ accountId, apiToken, databaseId });
}
