import { describe, it, expect, vi } from 'vitest';
import {
  shouldInvokeAI,
  mergeExtractionResults,
  aiExtract,
  AiProvider,
  AiExtractionResult,
} from '../ai-extractor';
import { ExtractionResult } from '../types';

describe('shouldInvokeAI', () => {
  it('should return false for yad2 source regardless of missing fields', () => {
    const extraction: ExtractionResult = {
      price: null,
      bedrooms: null,
      street: null,
      tags: [],
      location: null,
      isNonRental: false,
      overallConfidence: 0,
      floor: null,
      squareMeters: null,
      entryDate: null,
    };

    expect(shouldInvokeAI(extraction, 'yad2', 200)).toBe(false);
  });

  it('should return false when text is too short (< 100 chars)', () => {
    const extraction: ExtractionResult = {
      price: null,
      bedrooms: null,
      street: null,
      tags: [],
      location: null,
      isNonRental: false,
      overallConfidence: 0,
      floor: null,
      squareMeters: null,
      entryDate: null,
    };

    expect(shouldInvokeAI(extraction, 'facebook', 50)).toBe(false);
    expect(shouldInvokeAI(extraction, 'facebook', 99)).toBe(false);
  });

  it('should return false when only neighborhood is null (single missing field)', () => {
    const extraction: ExtractionResult = {
      price: { amount: 5000, currency: 'ILS', period: 'month', confidence: 0.9 },
      bedrooms: 3,
      street: 'דיזנגוף',
      tags: [],
      location: { city: 'תל אביב', neighborhood: null, confidence: 0.8 },
      isNonRental: false,
      overallConfidence: 0.8,
      floor: null,
      squareMeters: null,
      entryDate: null,
    };

    expect(shouldInvokeAI(extraction, 'facebook', 200)).toBe(false);
  });

  it('should return false when only street is null (single missing field)', () => {
    const extraction: ExtractionResult = {
      price: { amount: 5000, currency: 'ILS', period: 'month', confidence: 0.9 },
      bedrooms: 3,
      street: null,
      tags: [],
      location: { city: 'תל אביב', neighborhood: 'פלורנטין', confidence: 0.9 },
      isNonRental: false,
      overallConfidence: 0.9,
      floor: null,
      squareMeters: null,
      entryDate: null,
    };

    expect(shouldInvokeAI(extraction, 'facebook', 200)).toBe(false);
  });

  it('should return true when both neighborhood and street are null (2 missing fields)', () => {
    const extraction: ExtractionResult = {
      price: { amount: 5000, currency: 'ILS', period: 'month', confidence: 0.9 },
      bedrooms: 3,
      street: null,
      tags: [],
      location: { city: 'תל אביב', neighborhood: null, confidence: 0.8 },
      isNonRental: false,
      overallConfidence: 0.8,
      floor: null,
      squareMeters: null,
      entryDate: null,
    };

    expect(shouldInvokeAI(extraction, 'facebook', 200)).toBe(true);
  });

  it('should return true when price is null (high-value extraction)', () => {
    const extraction: ExtractionResult = {
      price: null,
      bedrooms: 3,
      street: 'דיזנגוף',
      tags: [],
      location: { city: 'תל אביב', neighborhood: 'פלורנטין', confidence: 0.9 },
      isNonRental: false,
      overallConfidence: 0,
      floor: null,
      squareMeters: null,
      entryDate: null,
    };

    expect(shouldInvokeAI(extraction, 'facebook', 200)).toBe(true);
  });

  it('should return true when location is completely null', () => {
    const extraction: ExtractionResult = {
      price: { amount: 5000, currency: 'ILS', period: 'month', confidence: 0.9 },
      bedrooms: 3,
      street: 'דיזנגוף',
      tags: [],
      location: null,
      isNonRental: false,
      overallConfidence: 0.9,
      floor: null,
      squareMeters: null,
      entryDate: null,
    };

    expect(shouldInvokeAI(extraction, 'facebook', 200)).toBe(true);
  });

  it('should return false when all fields are present', () => {
    const extraction: ExtractionResult = {
      price: { amount: 5000, currency: 'ILS', period: 'month', confidence: 0.9 },
      bedrooms: 3,
      street: 'דיזנגוף',
      tags: ['parking'],
      location: { city: 'תל אביב', neighborhood: 'פלורנטין', confidence: 0.9 },
      isNonRental: false,
      overallConfidence: 0.9,
      floor: null,
      squareMeters: null,
      entryDate: null,
    };

    expect(shouldInvokeAI(extraction, 'facebook', 200)).toBe(false);
  });
});

describe('mergeExtractionResults', () => {
  it('should use regex price when present', () => {
    const regex: ExtractionResult = {
      price: { amount: 5000, currency: 'ILS', period: 'month', confidence: 0.9 },
      bedrooms: null,
      street: null,
      tags: [],
      location: null,
      isNonRental: false,
      overallConfidence: 0.9,
      floor: null,
      squareMeters: null,
      entryDate: null,
    };

    const ai: AiExtractionResult = {
      isRental: true,
      price: { amount: 4500, currency: 'ILS', period: 'month' },
      bedrooms: null,
      city: null,
      neighborhood: null,
      street: null,
      tags: [],
      floor: null,
      squareMeters: null,
      entryDate: null,
    };

    const result = mergeExtractionResults(regex, ai);
    expect(result.price?.amount).toBe(5000);
    expect(result.price?.confidence).toBe(0.9);
  });

  it('should use AI price with confidence 0.6 when regex price is null', () => {
    const regex: ExtractionResult = {
      price: null,
      bedrooms: null,
      street: null,
      tags: [],
      location: null,
      isNonRental: false,
      overallConfidence: 0,
      floor: null,
      squareMeters: null,
      entryDate: null,
    };

    const ai: AiExtractionResult = {
      isRental: true,
      price: { amount: 4500, currency: 'ILS', period: 'month' },
      bedrooms: null,
      city: null,
      neighborhood: null,
      street: null,
      tags: [],
      floor: null,
      squareMeters: null,
      entryDate: null,
    };

    const result = mergeExtractionResults(regex, ai);
    expect(result.price?.amount).toBe(4500);
    expect(result.price?.confidence).toBe(0.6);
  });

  it('should use regex bedrooms when present', () => {
    const regex: ExtractionResult = {
      price: null,
      bedrooms: 3,
      street: null,
      tags: [],
      location: null,
      isNonRental: false,
      overallConfidence: 0,
      floor: null,
      squareMeters: null,
      entryDate: null,
    };

    const ai: AiExtractionResult = {
      isRental: true,
      price: null,
      bedrooms: 2,
      city: null,
      neighborhood: null,
      street: null,
      tags: [],
      floor: null,
      squareMeters: null,
      entryDate: null,
    };

    const result = mergeExtractionResults(regex, ai);
    expect(result.bedrooms).toBe(3);
  });

  it('should use AI bedrooms when regex is null', () => {
    const regex: ExtractionResult = {
      price: null,
      bedrooms: null,
      street: null,
      tags: [],
      location: null,
      isNonRental: false,
      overallConfidence: 0,
      floor: null,
      squareMeters: null,
      entryDate: null,
    };

    const ai: AiExtractionResult = {
      isRental: true,
      price: null,
      bedrooms: 2,
      city: null,
      neighborhood: null,
      street: null,
      tags: [],
      floor: null,
      squareMeters: null,
      entryDate: null,
    };

    const result = mergeExtractionResults(regex, ai);
    expect(result.bedrooms).toBe(2);
  });

  it('should use regex city and neighborhood when present', () => {
    const regex: ExtractionResult = {
      price: null,
      bedrooms: null,
      street: null,
      tags: [],
      location: { city: 'תל אביב', neighborhood: 'פלורנטין', confidence: 0.9 },
      isNonRental: false,
      overallConfidence: 0.9,
      floor: null,
      squareMeters: null,
      entryDate: null,
    };

    const ai: AiExtractionResult = {
      isRental: true,
      price: null,
      bedrooms: null,
      city: 'חיפה',
      neighborhood: 'כרמל',
      street: null,
      tags: [],
      floor: null,
      squareMeters: null,
      entryDate: null,
    };

    const result = mergeExtractionResults(regex, ai);
    expect(result.location?.city).toBe('תל אביב');
    expect(result.location?.neighborhood).toBe('פלורנטין');
    expect(result.location?.confidence).toBe(0.9);
  });

  it('should use AI city when regex location is null', () => {
    const regex: ExtractionResult = {
      price: null,
      bedrooms: null,
      street: null,
      tags: [],
      location: null,
      isNonRental: false,
      overallConfidence: 0,
      floor: null,
      squareMeters: null,
      entryDate: null,
    };

    const ai: AiExtractionResult = {
      isRental: true,
      price: null,
      bedrooms: null,
      city: 'תל אביב',
      neighborhood: 'פלורנטין',
      street: null,
      tags: [],
      floor: null,
      squareMeters: null,
      entryDate: null,
    };

    const result = mergeExtractionResults(regex, ai);
    expect(result.location?.city).toBe('תל אביב');
    expect(result.location?.neighborhood).toBe('פלורנטין');
    expect(result.location?.confidence).toBe(0.6);
  });

  it('should fill regex neighborhood from AI when regex has city but no neighborhood', () => {
    const regex: ExtractionResult = {
      price: null,
      bedrooms: null,
      street: null,
      tags: [],
      location: { city: 'תל אביב', neighborhood: null, confidence: 0.8 },
      isNonRental: false,
      overallConfidence: 0.8,
      floor: null,
      squareMeters: null,
      entryDate: null,
    };

    const ai: AiExtractionResult = {
      isRental: true,
      price: null,
      bedrooms: null,
      city: null,
      neighborhood: 'פלורנטין',
      street: null,
      tags: [],
      floor: null,
      squareMeters: null,
      entryDate: null,
    };

    const result = mergeExtractionResults(regex, ai);
    expect(result.location?.city).toBe('תל אביב');
    expect(result.location?.neighborhood).toBe('פלורנטין');
    expect(result.location?.confidence).toBe(0.8); // Keeps regex confidence
  });

  it('should use regex street when present', () => {
    const regex: ExtractionResult = {
      price: null,
      bedrooms: null,
      street: 'דיזנגוף',
      tags: [],
      location: null,
      isNonRental: false,
      overallConfidence: 0,
      floor: null,
      squareMeters: null,
      entryDate: null,
    };

    const ai: AiExtractionResult = {
      isRental: true,
      price: null,
      bedrooms: null,
      city: null,
      neighborhood: null,
      street: 'אלנבי',
      tags: [],
      floor: null,
      squareMeters: null,
      entryDate: null,
    };

    const result = mergeExtractionResults(regex, ai);
    expect(result.street).toBe('דיזנגוף');
  });

  it('should use AI street when regex is null', () => {
    const regex: ExtractionResult = {
      price: null,
      bedrooms: null,
      street: null,
      tags: [],
      location: null,
      isNonRental: false,
      overallConfidence: 0,
      floor: null,
      squareMeters: null,
      entryDate: null,
    };

    const ai: AiExtractionResult = {
      isRental: true,
      price: null,
      bedrooms: null,
      city: null,
      neighborhood: null,
      street: 'אלנבי',
      tags: [],
      floor: null,
      squareMeters: null,
      entryDate: null,
    };

    const result = mergeExtractionResults(regex, ai);
    expect(result.street).toBe('אלנבי');
  });

  it('should union and deduplicate tags from regex and AI', () => {
    const regex: ExtractionResult = {
      price: null,
      bedrooms: null,
      street: null,
      tags: ['parking', 'balcony'],
      location: null,
      isNonRental: false,
      overallConfidence: 0,
      floor: null,
      squareMeters: null,
      entryDate: null,
    };

    const ai: AiExtractionResult = {
      isRental: true,
      price: null,
      bedrooms: null,
      city: null,
      neighborhood: null,
      street: null,
      tags: ['balcony', 'elevator', 'furnished'],
      floor: null,
      squareMeters: null,
      entryDate: null,
    };

    const result = mergeExtractionResults(regex, ai);
    expect(result.tags).toHaveLength(4);
    expect(result.tags).toContain('parking');
    expect(result.tags).toContain('balcony');
    expect(result.tags).toContain('elevator');
    expect(result.tags).toContain('furnished');
  });

  it('should set isNonRental to true when regex isNonRental is true', () => {
    const regex: ExtractionResult = {
      price: null,
      bedrooms: null,
      street: null,
      tags: [],
      location: null,
      isNonRental: true,
      overallConfidence: 0,
      floor: null,
      squareMeters: null,
      entryDate: null,
    };

    const ai: AiExtractionResult = {
      isRental: true,
      price: null,
      bedrooms: null,
      city: null,
      neighborhood: null,
      street: null,
      tags: [],
      floor: null,
      squareMeters: null,
      entryDate: null,
    };

    const result = mergeExtractionResults(regex, ai);
    expect(result.isNonRental).toBe(true);
  });

  it('should set isNonRental to true when AI isRental is false', () => {
    const regex: ExtractionResult = {
      price: null,
      bedrooms: null,
      street: null,
      tags: [],
      location: null,
      isNonRental: false,
      overallConfidence: 0,
      floor: null,
      squareMeters: null,
      entryDate: null,
    };

    const ai: AiExtractionResult = {
      isRental: false,
      price: null,
      bedrooms: null,
      city: null,
      neighborhood: null,
      street: null,
      tags: [],
      floor: null,
      squareMeters: null,
      entryDate: null,
    };

    const result = mergeExtractionResults(regex, ai);
    expect(result.isNonRental).toBe(true);
  });

  it('should recalculate overallConfidence with AI fields at 0.6', () => {
    const regex: ExtractionResult = {
      price: null,
      bedrooms: null,
      street: null,
      tags: [],
      location: null,
      isNonRental: false,
      overallConfidence: 0,
      floor: null,
      squareMeters: null,
      entryDate: null,
    };

    const ai: AiExtractionResult = {
      isRental: true,
      price: { amount: 5000, currency: 'ILS', period: 'month' },
      bedrooms: null,
      city: 'תל אביב',
      neighborhood: null,
      street: null,
      tags: [],
      floor: null,
      squareMeters: null,
      entryDate: null,
    };

    const result = mergeExtractionResults(regex, ai);
    // price(0.30×0.6) + city(0.25×0.6) + notSearchPost(0.05) = 0.38
    expect(result.overallConfidence).toBe(0.38);
  });
});

describe('aiExtract', () => {
  it('should parse valid JSON response correctly', async () => {
    const mockAi: AiProvider = {
      run: vi.fn().mockResolvedValue({
        response: JSON.stringify({
          is_rental: true,
          price: 5000,
          currency: 'ILS',
          price_period: 'month',
          bedrooms: 3,
          city: 'תל אביב',
          neighborhood: 'פלורנטין',
          street: 'דיזנגוף',
          floor: 2,
          square_meters: 75,
          entry_date: '2024-01-15',
          tags: ['parking', 'balcony'],
        }),
      }),
    };

    const result = await aiExtract('דירת 3 חדרים בפלורנטין', mockAi);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.isRental).toBe(true);
    expect(result.data.price?.amount).toBe(5000);
    expect(result.data.bedrooms).toBe(3);
    expect(result.data.city).toBe('תל אביב');
    expect(result.data.neighborhood).toBe('פלורנטין');
    expect(result.data.street).toBe('דיזנגוף');
    expect(result.data.floor).toBe(2);
    expect(result.data.squareMeters).toBe(75);
    expect(result.data.tags).toEqual(['parking', 'balcony']);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('should handle JSON wrapped in markdown code blocks', async () => {
    const mockAi: AiProvider = {
      run: vi.fn().mockResolvedValue({
        response: '```json\n' + JSON.stringify({
          is_rental: true,
          price: 5000,
          currency: 'ILS',
          price_period: 'month',
          bedrooms: 3,
          city: 'תל אביב',
          neighborhood: null,
          street: null,
          floor: null,
          square_meters: null,
          entry_date: null,
          tags: [],
        }) + '\n```',
      }),
    };

    const result = await aiExtract('דירת 3 חדרים', mockAi);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.price?.amount).toBe(5000);
  });

  it('should return json_parse failure for malformed JSON', async () => {
    const mockAi: AiProvider = {
      run: vi.fn().mockResolvedValue({
        response: 'This is not valid JSON',
      }),
    };

    const result = await aiExtract('דירת 3 חדרים', mockAi);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('json_parse');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('should return empty_response failure when response is missing', async () => {
    const mockAi: AiProvider = {
      run: vi.fn().mockResolvedValue({}),
    };

    const result = await aiExtract('דירת 3 חדרים', mockAi);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('empty_response');
  });

  it('should handle missing fields by setting them to null', async () => {
    const mockAi: AiProvider = {
      run: vi.fn().mockResolvedValue({
        response: JSON.stringify({
          is_rental: true,
          price: null,
          currency: null,
          price_period: null,
          bedrooms: null,
          city: 'תל אביב',
          neighborhood: null,
          street: null,
          floor: null,
          square_meters: null,
          entry_date: null,
          tags: [],
        }),
      }),
    };

    const result = await aiExtract('דירה בתל אביב', mockAi);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.price).toBeNull();
    expect(result.data.bedrooms).toBeNull();
    expect(result.data.city).toBe('תל אביב');
  });

  it('should return non_rental failure when isRental is false', async () => {
    const mockAi: AiProvider = {
      run: vi.fn().mockResolvedValue({
        response: JSON.stringify({
          is_rental: false,
          price: null,
          currency: null,
          price_period: null,
          bedrooms: null,
          city: null,
          neighborhood: null,
          street: null,
          floor: null,
          square_meters: null,
          entry_date: null,
          tags: [],
        }),
      }),
    };

    const result = await aiExtract('מחפש דירה', mockAi);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('non_rental');
  });

  it('should normalize city name via normalizeCity', async () => {
    const mockAi: AiProvider = {
      run: vi.fn().mockResolvedValue({
        response: JSON.stringify({
          is_rental: true,
          price: null,
          currency: null,
          price_period: null,
          bedrooms: null,
          city: 'Tel Aviv', // English variant
          neighborhood: null,
          street: null,
          floor: null,
          square_meters: null,
          entry_date: null,
          tags: [],
        }),
      }),
    };

    const result = await aiExtract('apartment in tel aviv', mockAi);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.city).toBe('תל אביב'); // Normalized to Hebrew
  });

  it('should return timeout failure on timeout', async () => {
    const mockAi: AiProvider = {
      run: vi.fn().mockImplementation(() => new Promise((resolve) => {
        setTimeout(() => resolve({ response: '{}' }), 10000); // 10 seconds
      })),
    };

    const result = await aiExtract('דירת 3 חדרים', mockAi, { timeoutMs: 100 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('timeout');
  });

  it('should return failure on error/exception', async () => {
    const mockAi: AiProvider = {
      run: vi.fn().mockRejectedValue(new Error('AI service error')),
    };

    const result = await aiExtract('דירת 3 חדרים', mockAi);
    expect(result.ok).toBe(false);
  });

  it('should handle missing optional fields by defaulting to null', async () => {
    const mockAi: AiProvider = {
      run: vi.fn().mockResolvedValue({
        response: JSON.stringify({
          is_rental: true,
          price: 5000,
          currency: 'ILS',
          price_period: 'month',
          bedrooms: 3,
          city: 'תל אביב',
          // floor, square_meters, entry_date, neighborhood, street, tags all omitted
        }),
      }),
    };

    const result = await aiExtract('דירת 3 חדרים בתל אביב', mockAi);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.price?.amount).toBe(5000);
    expect(result.data.bedrooms).toBe(3);
    expect(result.data.floor).toBeNull();
    expect(result.data.squareMeters).toBeNull();
    expect(result.data.entryDate).toBeNull();
    expect(result.data.neighborhood).toBeNull();
    expect(result.data.street).toBeNull();
    expect(result.data.tags).toEqual([]);
  });

  it('should coerce string-typed numeric fields to null', async () => {
    const mockAi: AiProvider = {
      run: vi.fn().mockResolvedValue({
        response: JSON.stringify({
          is_rental: true,
          price: 5000,
          currency: 'ILS',
          price_period: 'month',
          bedrooms: 'שלושה', // Hebrew string instead of number
          city: 'תל אביב',
          neighborhood: null,
          street: null,
          floor: 'גבוהה', // Hebrew string instead of number
          square_meters: 'large',
          entry_date: null,
          tags: [],
        }),
      }),
    };

    const result = await aiExtract('דירה בתל אביב', mockAi);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.floor).toBeNull();
    expect(result.data.bedrooms).toBeNull();
    expect(result.data.squareMeters).toBeNull();
    expect(result.data.price?.amount).toBe(5000);
  });

  it('should handle OpenAI-compatible response format (choices)', async () => {
    const mockAi: AiProvider = {
      run: vi.fn().mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify({
              is_rental: true,
              price: 4000,
              currency: 'ILS',
              price_period: 'month',
              bedrooms: 2,
              city: 'חיפה',
              neighborhood: null,
              street: null,
              floor: 1,
              square_meters: 60,
              entry_date: null,
              tags: ['parking'],
            }),
          },
        }],
      }),
    };

    const result = await aiExtract('דירת 2 חדרים בחיפה', mockAi);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.price?.amount).toBe(4000);
    expect(result.data.city).toBe('חיפה');
    expect(result.data.bedrooms).toBe(2);
  });

  it('should use custom config when provided', async () => {
    const mockAi: AiProvider = {
      run: vi.fn().mockResolvedValue({
        response: JSON.stringify({
          is_rental: true,
          price: null,
          currency: null,
          price_period: null,
          bedrooms: null,
          city: null,
          neighborhood: null,
          street: null,
          floor: null,
          square_meters: null,
          entry_date: null,
          tags: [],
        }),
      }),
    };

    await aiExtract('דירת 3 חדרים', mockAi, {
      model: '@cf/meta/llama-3.3-70b-instruct',
      timeoutMs: 3000,
    });

    expect(mockAi.run).toHaveBeenCalledWith(
      '@cf/meta/llama-3.3-70b-instruct',
      expect.any(Object),
      undefined,
    );
  });
});
