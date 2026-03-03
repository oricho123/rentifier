import { createDB } from '@rentifier/db';
import { runCollector } from './collector';

export interface Env {
  DB: D1Database;
  ENABLE_YAD2_CONNECTOR?: string;
  ENABLE_FACEBOOK_CONNECTOR?: string;
  FB_COOKIES_1?: string;
  FB_COOKIES_2?: string;
  FB_ACCOUNT_COUNT?: string;
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
      const result = await runCollector(db, env);
      console.log('Collector completed:', JSON.stringify(result));
    } catch (error) {
      console.error('Collector failed:', error);
    }
  },
};
