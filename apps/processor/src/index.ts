import type { Ai } from '@cloudflare/workers-types';
import type { AiProvider } from '@rentifier/extraction';
import { createDB } from '@rentifier/db';
import { processBatch } from './pipeline';

export interface Env {
  DB: D1Database;
  AI: Ai;
  BATCH_SIZE?: string;
  AI_GATEWAY_ID?: string;
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
      const aiConfig = env.AI_GATEWAY_ID ? { gatewayId: env.AI_GATEWAY_ID } : undefined;
      const result = await processBatch(db, batchSize, env.AI as unknown as AiProvider, aiConfig);
      console.log('Processor completed:', JSON.stringify(result));
    } catch (error) {
      console.error('Processor failed:', error);
    }
  },
};
