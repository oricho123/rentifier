import { z } from 'zod';
import { ExtractionResult, PriceResult, LocationResult } from './types';
import { normalizeCity } from './cities';

// Generic AI provider interface (no Cloudflare-specific types)
export interface AiProvider {
  run(model: string, input: { messages: Array<{ role: string; content: string }> }): Promise<{ response?: string }>;
}

export interface AiExtractionResult {
  isRental: boolean;
  price: { amount: number; currency: 'ILS' | 'USD' | 'EUR'; period: 'month' | 'week' | 'day' } | null;
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
}

export const DEFAULT_AI_CONFIG: AiExtractorConfig = {
  maxCallsPerBatch: 20,
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
 * - AND at least one of:
 *   - extraction.location?.neighborhood is null (12% gap — biggest value)
 *   - extraction.street is null (15% gap)
 *   - extraction.price is null AND textLength > 50 (likely has price but regex missed it)
 *   - extraction.location is null (no city even after group default)
 */
export function shouldInvokeAI(
  extraction: ExtractionResult,
  sourceName: string,
  textLength: number,
): boolean {
  // Never invoke AI for yad2 (structured data)
  if (sourceName === 'yad2') {
    return false;
  }

  // Invoke AI if any of these conditions are met
  return (
    extraction.location?.neighborhood === null ||
    extraction.street === null ||
    (extraction.price === null && textLength > 50) ||
    extraction.location === null
  );
}

/**
 * Extract structured data from text using AI.
 *
 * @param text - The post text to extract from
 * @param ai - AI provider instance
 * @param config - Optional configuration overrides
 * @returns Extracted data or null on failure
 */
export async function aiExtract(
  text: string,
  ai: AiProvider,
  config?: Partial<AiExtractorConfig>,
): Promise<AiExtractionResult | null> {
  const fullConfig = { ...DEFAULT_AI_CONFIG, ...config };

  const prompt = `You are a Hebrew real estate listing parser. Extract structured data from this Facebook group post.

Rules:
- Respond with JSON only, no explanation
- If a field is not mentioned or cannot be determined, use null
- Do NOT guess or invent values — only extract what is explicitly stated
- Some listings intentionally hide the price — if no price is mentioned, return null
- Price is monthly rent unless stated otherwise
- Street names: extract even without "רחוב" prefix (e.g., "באברבנאל" → "אברבנאל", "דיזנגוף 5" → "דיזנגוף")
- City names in Hebrew (e.g., תל אביב, not Tel Aviv)
- Tags: only use these values: parking, balcony, pets, furnished, immediate, long-term, accessible, air-conditioning, elevator, storage, renovated
- is_rental: false for searching/wanted posts, ads, community announcements, non-rental content

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

    const aiPromise = ai.run(fullConfig.model, {
      messages: [
        { role: 'user', content: prompt },
      ],
    });

    const result = await Promise.race([aiPromise, timeoutPromise]);

    // Parse response
    if (!result.response) {
      return null;
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

    const parsed = JSON.parse(jsonText);
    const validated = AiResponseSchema.parse(parsed);

    // Return null if this is not a rental listing
    if (!validated.is_rental) {
      return null;
    }

    // Build price object
    const price = validated.price !== null && validated.currency && validated.price_period
      ? {
          amount: validated.price,
          currency: validated.currency,
          period: validated.price_period,
        }
      : null;

    // Normalize city name
    const normalizedCity = normalizeCity(validated.city);

    return {
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
    };
  } catch (error) {
    // Return null on any error (timeout, parse failure, validation error)
    return null;
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
 * - isSearchPost: Regex true takes priority; AI isRental=false also sets it true
 * - Recalculate overallConfidence with AI fields getting 0.6
 */
export function mergeExtractionResults(
  regex: ExtractionResult,
  ai: AiExtractionResult,
): ExtractionResult {
  // Price: regex takes priority
  const price: PriceResult | null = regex.price || (ai.price ? { ...ai.price, confidence: 0.6 } : null);

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

  // isSearchPost: regex true takes priority; AI isRental=false also sets it true
  const isSearchPost = regex.isSearchPost || !ai.isRental;

  // Recalculate overallConfidence
  const confidences: number[] = [];
  if (price) {
    confidences.push(price.confidence);
  }
  if (location) {
    confidences.push(location.confidence);
  }
  const overallConfidence = confidences.length > 0 ? Math.min(...confidences) : 0;

  return {
    price,
    bedrooms,
    street,
    tags,
    location,
    isSearchPost,
    overallConfidence,
    floor: ai.floor,
    squareMeters: ai.squareMeters,
    entryDate: ai.entryDate,
  };
}
