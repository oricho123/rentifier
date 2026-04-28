import type { Ai } from '@cloudflare/workers-types';
import type { AiProvider } from '@rentifier/extraction';
import { createDB } from '@rentifier/db';
import { processBatch, type ProcessorConfig } from './pipeline';

export interface Env {
  DB: D1Database;
  AI: Ai;
  BATCH_SIZE?: string;
  AI_GATEWAY_ID?: string;
  NEIGHBORHOOD_GEOCODER_USER_AGENT?: string;
  NEIGHBORHOOD_GEOCODER_BUDGET?: string;
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

      const config: ProcessorConfig = {
        ai: env.AI as unknown as AiProvider,
        aiConfig: env.AI_GATEWAY_ID ? { gatewayId: env.AI_GATEWAY_ID } : undefined,
        geocoderConfig: env.NEIGHBORHOOD_GEOCODER_USER_AGENT
          ? {
              userAgent: env.NEIGHBORHOOD_GEOCODER_USER_AGENT,
              budget: env.NEIGHBORHOOD_GEOCODER_BUDGET
                ? parseInt(env.NEIGHBORHOOD_GEOCODER_BUDGET, 10)
                : 30,
            }
          : undefined,
      };

      const result = await processBatch(db, batchSize, config);
      console.log('Processor completed:', JSON.stringify(result));
    } catch (error) {
      console.error('Processor failed:', error);
    }
  },
};
