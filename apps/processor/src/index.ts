import { createDB } from '@rentifier/db';
import { processBatch } from './pipeline';

export interface Env {
  DB: D1Database;
  BATCH_SIZE?: string;
}

export default {
  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<void> {
    console.log('Processor worker triggered at', new Date().toISOString());

    try {
      const db = createDB(env.DB);
      const batchSize = env.BATCH_SIZE ? parseInt(env.BATCH_SIZE, 10) : 50;
      const result = await processBatch(db, batchSize);
      console.log('Processor completed:', JSON.stringify(result));
    } catch (error) {
      console.error('Processor failed:', error);
    }
  },
};
