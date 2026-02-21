import type { DB } from '@rentifier/db';
import { createDefaultRegistry } from './registry';
import { fetchSource } from './fetch-source';

export interface CollectorResult {
  totalSources: number;
  successCount: number;
  errorCount: number;
  skippedCount: number;
  totalFetched: number;
  errors: Array<{ sourceId: number; error: string }>;
}

export async function runCollector(db: DB): Promise<CollectorResult> {
  const registry = createDefaultRegistry();
  const sources = await db.getEnabledSources();

  if (sources.length === 0) {
    console.warn('No enabled sources found');
    return { totalSources: 0, successCount: 0, errorCount: 0, skippedCount: 0, totalFetched: 0, errors: [] };
  }

  const result: CollectorResult = {
    totalSources: sources.length,
    successCount: 0,
    errorCount: 0,
    skippedCount: 0,
    totalFetched: 0,
    errors: [],
  };

  for (const source of sources) {
    const connector = registry.get(source.name);

    if (!connector) {
      console.warn(`No connector registered for source: ${source.name}`);
      result.skippedCount++;
      continue;
    }

    try {
      const fetchResult = await fetchSource(db, source, connector);

      if (fetchResult.success) {
        result.successCount++;
        result.totalFetched += fetchResult.fetchedCount;
      } else {
        result.errorCount++;
        result.errors.push({ sourceId: source.id, error: fetchResult.error || 'Unknown error' });
      }
    } catch (error) {
      console.error(`Unexpected error fetching source ${source.id}:`, error);
      result.errorCount++;
      result.errors.push({ sourceId: source.id, error: String(error) });
    }
  }

  return result;
}
