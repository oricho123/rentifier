import { createDB } from '@rentifier/db';
import { runCollector } from './collector';

export interface Env {
  DB: D1Database;
}

export default {
  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<void> {
    console.log('Collector worker triggered at', new Date().toISOString());

    try {
      const db = createDB(env.DB);
      const result = await runCollector(db);
      console.log('Collector completed:', JSON.stringify(result));
    } catch (error) {
      console.error('Collector failed:', error);
    }
  },
};
