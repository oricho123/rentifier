import { z } from 'zod';
import { ExtractionResult, PriceResult, LocationResult } from './types';
import { normalizeCity } from './cities';

// Generic AI provider interface (no Cloudflare-specific types)
export interface AiGatewayOptions {
  id: string;
  skipCache?: boolean;
  cacheTtl?: number;
}

export interface AiProvider {
  run(
    model: string,
    input: { messages: Array<{ role: string; content: string }> },
    options?: { gateway?: AiGatewayOptions }
  ): Promise<{ response?: string }>;
}

export interface AiExtractionResult {
  isRental: boolean;
  price: {
    amount: number;
    currency: 'ILS' | 'USD' | 'EUR';
    period: 'month' | 'week' | 'day';
  } | null;
  bedrooms: number | null;
  city: string | null;
  neighborhood: string | null;
  street: string | null;
  tags: string[];
  floor: number | null;
  squareMeters: number | null;
  entryDate: string | null;
}

export interface AiExtractorConfig {
  maxCallsPerBatch: number;
  timeoutMs: number;
  model: string;
  gatewayId?: string;
}

export const DEFAULT_AI_CONFIG: AiExtractorConfig = {
  maxCallsPerBatch: 10,
  timeoutMs: 5000,
  model: '@cf/meta/llama-3.1-8b-instruct',
};

export interface AiExtractorMetrics {
  called: number;
  succeeded: number;
  failed: number;
  skippedBudget: number;
  avgLatencyMs: number;
}

export type AiFailureReason =
  | 'timeout'
  | 'empty_response'
  | 'json_parse'
  | 'zod_validation'
  | 'non_rental';

export type AiExtractDetailedResult =
  | { ok: true; data: AiExtractionResult; latencyMs: number }
  | { ok: false; reason: AiFailureReason; latencyMs: number };

// Zod schema for validating AI JSON responses
const AiResponseSchema = z.object({
  is_rental: z.boolean(),
  price: z.number().nullable(),
  currency: z.enum(['ILS', 'USD', 'EUR']).nullable(),
  price_period: z.enum(['month', 'week', 'day']).nullable(),
  bedrooms: z.number().nullable(),
  city: z.string().nullable(),
  neighborhood: z.string().nullable(),
  street: z.string().nullable(),
  floor: z.number().nullable(),
  square_meters: z.number().nullable(),
  entry_date: z.string().nullable(),
  tags: z.array(z.string()),
});

type AiResponse = z.infer<typeof AiResponseSchema>;

/**
 * Gate function to decide whether to invoke AI extraction.
 *
 * Returns true when:
 * - Source is NOT 'yad2' (structured data doesn't need AI)
 * - AND post is not already flagged as non-rental (sale, service ad, search post)
 * - AND text is long enough (>= 100 chars — short posts don't contain extractable data)
 * - AND at least one high-value condition:
 *   - No location at all (city unknown even after group defaults)
 *   - Price is null (highest-value extraction — regex likely missed it)
 *   - 2+ fields missing from: neighborhood, street, price (worth the neuron cost)
 */
export function shouldInvokeAI(
  extraction: ExtractionResult,
  sourceName: string,
  textLength: number
): boolean {
  // Never invoke AI for yad2 (structured data)
  if (sourceName === 'yad2') {
    return false;
  }

  // Skip non-rental posts (sale, service ads, search posts) — AI call would be wasted
  if (extraction.isNonRental) {
    return false;
  }

  // Skip short posts — not enough text for AI to extract from
  if (textLength < 100) {
    return false;
  }

  // Always invoke if no location at all (highest value)
  if (extraction.location === null) {
    return true;
  }

  // Always invoke if price is missing (high value extraction)
  if (extraction.price === null) {
    return true;
  }

  // Count missing fields — only invoke if 2+ gaps exist
  let missingFields = 0;
  if (extraction.location?.neighborhood === null) missingFields++;
  if (extraction.street === null) missingFields++;

  return missingFields >= 2;
}

/**
 * Extract structured data from text using AI.
 *
 * @param text - The post text to extract from
 * @param ai - AI provider instance
 * @param config - Optional configuration overrides
 * @returns Detailed result with success/failure reason and latency
 */
export async function aiExtract(
  text: string,
  ai: AiProvider,
  config?: Partial<AiExtractorConfig>
): Promise<AiExtractDetailedResult> {
  const fullConfig = { ...DEFAULT_AI_CONFIG, ...config };
  const startTime = Date.now();

  const prompt = `You are a Hebrew real estate listing parser in Israel. Extract structured data from this post.

Rules:
- Respond with JSON only, no explanation
- Only extract values explicitly stated in the text — never guess or invent
- If a field is not mentioned, use null. Many posts omit street, price, or floor — that is normal
- is_rental: false for any of these: for-sale listings (למכירה), searching/wanted posts, service ads, community announcements, non-rental content
- Price: monthly rent amount only. Sale prices (typically 1M+₪) mean is_rental is false
- Street: extract only if a specific street name is mentioned. Neighborhood names are not streets
- City, neighborhood, street: strip Hebrew prefix letters (ב, ה, ל, מ, ש, כ, ו) from the result. Return the bare name, not the prefixed form
- Tags: only use these values: parking, balcony, pets, furnished, immediate, long-term, accessible, air-conditioning, elevator, storage, renovated

Post text:
"""
${text}
"""

JSON schema:
{
  "is_rental": boolean,
  "price": number | null,
  "currency": "ILS" | "USD" | "EUR" | null,
  "price_period": "month" | "week" | "day" | null,
  "bedrooms": number | null,
  "city": string | null,
  "neighborhood": string | null,
  "street": string | null,
  "floor": number | null,
  "square_meters": number | null,
  "entry_date": string | null,
  "tags": string[]
}`;

  try {
    // Call AI with timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('AI request timeout')), fullConfig.timeoutMs);
    });

    const gatewayOptions = fullConfig.gatewayId
      ? { gateway: { id: fullConfig.gatewayId } }
      : undefined;

    const aiPromise = ai.run(
      fullConfig.model,
      {
        messages: [{ role: 'user', content: prompt }],
      },
      gatewayOptions
    );

    const result = await Promise.race([aiPromise, timeoutPromise]);
    const latencyMs = Date.now() - startTime;

    // Parse response
    if (!result.response) {
      return { ok: false, reason: 'empty_response', latencyMs };
    }

    // Extract JSON from response (may have markdown code blocks)
    let jsonText = result.response.trim();
    if (jsonText.startsWith('```json')) {
      jsonText = jsonText.slice(7);
    }
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.slice(3);
    }
    if (jsonText.endsWith('```')) {
      jsonText = jsonText.slice(0, -3);
    }
    jsonText = jsonText.trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      return { ok: false, reason: 'json_parse', latencyMs };
    }

    let validated: AiResponse;
    try {
      validated = AiResponseSchema.parse(parsed);
    } catch {
      return { ok: false, reason: 'zod_validation', latencyMs };
    }

    // Return failure if this is not a rental listing
    if (!validated.is_rental) {
      return { ok: false, reason: 'non_rental', latencyMs };
    }

    // Build price object
    const price =
      validated.price !== null && validated.currency && validated.price_period
        ? {
            amount: validated.price,
            currency: validated.currency,
            period: validated.price_period,
          }
        : null;

    // Normalize city name
    const normalizedCity = normalizeCity(validated.city);

    return {
      ok: true,
      latencyMs,
      data: {
        isRental: validated.is_rental,
        price,
        bedrooms: validated.bedrooms,
        city: normalizedCity,
        neighborhood: validated.neighborhood,
        street: validated.street,
        tags: validated.tags,
        floor: validated.floor,
        squareMeters: validated.square_meters,
        entryDate: validated.entry_date,
      },
    };
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    const reason: AiFailureReason =
      error instanceof Error && error.message === 'AI request timeout' ? 'timeout' : 'json_parse';
    return { ok: false, reason, latencyMs };
  }
}

/**
 * Merge regex extraction results with AI extraction results.
 *
 * Merge rules:
 * - Price: Use regex if non-null, else AI (with confidence 0.6)
 * - Bedrooms: Use regex if non-null, else AI
 * - Location: Use regex city/neighborhood if non-null, else AI
 * - Street: Use regex if non-null, else AI
 * - Tags: Union of regex + AI tags (deduplicated)
 * - isNonRental: Regex true takes priority; AI isRental=false also sets it true
 * - Recalculate overallConfidence with AI fields getting 0.6
 */
export function mergeExtractionResults(
  regex: ExtractionResult,
  ai: AiExtractionResult
): ExtractionResult {
  // Price: regex takes priority
  const price: PriceResult | null =
    regex.price || (ai.price ? { ...ai.price, confidence: 0.6 } : null);

  // Bedrooms: regex takes priority
  const bedrooms = regex.bedrooms ?? ai.bedrooms;

  // Location: regex takes priority for both city and neighborhood
  let location: LocationResult | null = null;
  if (regex.location) {
    // Regex has location - use it, but fill in neighborhood from AI if missing
    location = {
      city: regex.location.city,
      neighborhood: regex.location.neighborhood ?? ai.neighborhood,
      confidence: regex.location.confidence,
    };
  } else if (ai.city) {
    // No regex location - use AI
    location = {
      city: ai.city,
      neighborhood: ai.neighborhood,
      confidence: 0.6,
    };
  }

  // Street: regex takes priority
  const street = regex.street ?? ai.street;

  // Tags: union and deduplicate
  const tags = Array.from(new Set([...regex.tags, ...ai.tags]));

  // isNonRental: regex true takes priority; AI isRental=false also sets it true
  const isNonRental = regex.isNonRental || !ai.isRental;

  // Weighted field coverage confidence (same formula as extractAll)
  let overallConfidence = 0;
  if (price) overallConfidence += 0.3 * price.confidence;
  if (location) overallConfidence += 0.25 * location.confidence;
  if (bedrooms !== null) overallConfidence += 0.2;
  if (location?.neighborhood) overallConfidence += 0.1;
  if (street) overallConfidence += 0.05;
  if (tags.length > 0) overallConfidence += 0.05;
  if (!isNonRental) overallConfidence += 0.05;
  overallConfidence = Math.round(overallConfidence * 100) / 100;

  return {
    price,
    bedrooms,
    street,
    tags,
    location,
    isNonRental,
    overallConfidence,
    floor: ai.floor,
    squareMeters: ai.squareMeters,
    entryDate: ai.entryDate,
  };
}
