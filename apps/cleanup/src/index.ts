import { createDB } from '@rentifier/db';
import { runCleanup } from './cleanup-service';

export interface Env {
  DB: D1Database;
  RETENTION_DAYS?: string;
  BATCH_SIZE?: string;
  MAX_DELETES_PER_RUN?: string;
}

const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_MAX_DELETES_PER_RUN = 50_000;

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw == null) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export default {
  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<void> {
    console.log('Cleanup worker triggered at', new Date().toISOString());

    const db = createDB(env.DB);
    const opts = {
      retentionDays: parsePositiveInt(env.RETENTION_DAYS, DEFAULT_RETENTION_DAYS),
      batchSize: parsePositiveInt(env.BATCH_SIZE, DEFAULT_BATCH_SIZE),
      maxDeletesPerRun: parsePositiveInt(env.MAX_DELETES_PER_RUN, DEFAULT_MAX_DELETES_PER_RUN),
    };

    try {
      const result = await runCleanup(db, opts);
      console.log('Cleanup completed:', JSON.stringify(result));
      await db.updateWorkerState('cleanup', new Date().toISOString(), 'ok');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Cleanup failed:', message);
      await db.updateWorkerState('cleanup', new Date().toISOString(), 'error', message);
      throw error;
    }
  },
};
