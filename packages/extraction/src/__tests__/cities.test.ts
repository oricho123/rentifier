import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { normalizeCity, CANONICAL_CITY_NAMES, CITY_VARIANTS } from '../cities';

describe('City Normalization', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  describe('normalizeCity', () => {
    describe('Hebrew canonical names', () => {
      it('should return Tel Aviv for תל אביב', () => {
        expect(normalizeCity('תל אביב')).toBe('תל אביב');
      });

      it('should return Jerusalem for ירושלים', () => {
        expect(normalizeCity('ירושלים')).toBe('ירושלים');
      });

      it('should return Haifa for חיפה', () => {
        expect(normalizeCity('חיפה')).toBe('חיפה');
      });

      it('should return all canonical names unchanged', () => {
        Object.keys(CANONICAL_CITY_NAMES).forEach(city => {
          expect(normalizeCity(city)).toBe(city);
        });
      });
    });

    describe('Hebrew variants', () => {
      it('should normalize תל-אביב to תל אביב', () => {
        expect(normalizeCity('תל-אביב')).toBe('תל אביב');
      });

      it('should normalize רמת-גן to רמת גן', () => {
        expect(normalizeCity('רמת-גן')).toBe('רמת גן');
      });

      it('should normalize באר-שבע to באר שבע', () => {
        expect(normalizeCity('באר-שבע')).toBe('באר שבע');
      });

      it('should normalize פתח-תקווה to פתח תקווה', () => {
        expect(normalizeCity('פתח-תקווה')).toBe('פתח תקווה');
      });

      it('should normalize abbreviation ת"א to תל אביב', () => {
        expect(normalizeCity('ת"א')).toBe('תל אביב');
      });

      it('should normalize abbreviation רמ"ג to רמת גן', () => {
        expect(normalizeCity('רמ"ג')).toBe('רמת גן');
      });

      it('should normalize ראשון to ראשון לציון', () => {
        expect(normalizeCity('ראשון')).toBe('ראשון לציון');
      });
    });

    describe('English variants', () => {
      it('should normalize "tel aviv" to תל אביב', () => {
        expect(normalizeCity('tel aviv')).toBe('תל אביב');
      });

      it('should normalize "Tel Aviv" to תל אביב', () => {
        expect(normalizeCity('Tel Aviv')).toBe('תל אביב');
      });

      it('should normalize "TEL AVIV" to תל אביב', () => {
        expect(normalizeCity('TEL AVIV')).toBe('תל אביב');
      });

      it('should normalize "tlv" to תל אביב', () => {
        expect(normalizeCity('tlv')).toBe('תל אביב');
      });

      it('should normalize "jerusalem" to ירושלים', () => {
        expect(normalizeCity('jerusalem')).toBe('ירושלים');
      });

      it('should normalize "haifa" to חיפה', () => {
        expect(normalizeCity('haifa')).toBe('חיפה');
      });

      it('should normalize "herzliya" to הרצליה', () => {
        expect(normalizeCity('herzliya')).toBe('הרצליה');
      });

      it('should normalize "ramat gan" to רמת גן', () => {
        expect(normalizeCity('ramat gan')).toBe('רמת גן');
      });

      it('should normalize "beer sheva" to באר שבע', () => {
        expect(normalizeCity('beer sheva')).toBe('באר שבע');
      });

      it('should normalize "netanya" to נתניה', () => {
        expect(normalizeCity('netanya')).toBe('נתניה');
      });

      it('should normalize "rishon lezion" to ראשון לציון', () => {
        expect(normalizeCity('rishon lezion')).toBe('ראשון לציון');
      });

      it('should normalize "petah tikva" to פתח תקווה', () => {
        expect(normalizeCity('petah tikva')).toBe('פתח תקווה');
      });
    });

    describe('edge cases', () => {
      it('should return null for unknown city', () => {
        expect(normalizeCity('Unknown City')).toBeNull();
      });

      it('should log warning for unknown city', () => {
        normalizeCity('Unknown City');
        expect(consoleLogSpy).toHaveBeenCalledWith(
          expect.stringContaining('unknown_city')
        );
      });

      it('should return null for null input', () => {
        expect(normalizeCity(null)).toBeNull();
      });

      it('should return null for undefined input', () => {
        expect(normalizeCity(undefined)).toBeNull();
      });

      it('should return null for empty string', () => {
        expect(normalizeCity('')).toBeNull();
      });

      it('should return null for whitespace-only string', () => {
        expect(normalizeCity('   ')).toBeNull();
      });

      it('should trim whitespace before matching', () => {
        expect(normalizeCity('  תל אביב  ')).toBe('תל אביב');
      });

      it('should trim whitespace for English variants', () => {
        expect(normalizeCity('  tel aviv  ')).toBe('תל אביב');
      });
    });

    describe('all variants mapped correctly', () => {
      it('should have every variant map to a canonical Hebrew name', () => {
        Object.values(CITY_VARIANTS).forEach(canonical => {
          expect(Object.keys(CANONICAL_CITY_NAMES)).toContain(canonical);
        });
      });

      it('should normalize all defined variants without errors', () => {
        Object.keys(CITY_VARIANTS).forEach(variant => {
          const result = normalizeCity(variant);
          expect(result).toBeTruthy();
          expect(typeof result).toBe('string');
        });
      });
    });
  });
});
