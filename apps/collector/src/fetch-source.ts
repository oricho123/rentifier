import type { Connector } from '@rentifier/connectors';
import type { DB, Source } from '@rentifier/db';

export interface FetchSourceResult {
  sourceId: number;
  success: boolean;
  fetchedCount: number;
  nextCursor: string | null;
  error?: string;
}

export async function fetchSource(
  db: DB,
  source: Source,
  connector: Connector
): Promise<FetchSourceResult> {
  try {
    const state = await db.getSourceState(source.id);
    const cursor = state?.cursor ?? null;

    console.log(`Fetching from ${source.name} with cursor: ${cursor}`);
    const { candidates, nextCursor } = await connector.fetchNew(cursor);
    console.log(`Fetched ${candidates.length} candidates from ${source.name}`);

    // Store full candidate as raw_json so processor can reconstruct it
    const rawListings = candidates.map((c) => ({
      source_id: source.id,
      source_item_id: c.sourceItemId,
      url: c.rawUrl,
      raw_json: JSON.stringify(c),
    }));
    await db.insertRawListings(rawListings);

    await db.updateSourceState(source.id, {
      cursor: nextCursor,
      last_run_at: new Date().toISOString(),
      last_status: 'ok',
      last_error: null,
    });

    return {
      sourceId: source.id,
      success: true,
      fetchedCount: candidates.length,
      nextCursor,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    await db.updateSourceState(source.id, {
      last_run_at: new Date().toISOString(),
      last_status: 'error',
      last_error: errorMessage,
    });

    console.error(`Source ${source.name} failed:`, errorMessage);

    return {
      sourceId: source.id,
      success: false,
      fetchedCount: 0,
      nextCursor: null,
      error: errorMessage,
    };
  }
}
