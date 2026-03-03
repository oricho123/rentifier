import { describe, it, expect } from 'vitest';
import { matchScore, normalizeStreet, distanceMeters, DEDUP_THRESHOLD, type DedupFields } from '../dedup';

describe('Dedup Module', () => {
  describe('DEDUP_THRESHOLD', () => {
    it('should equal 2.0', () => {
      expect(DEDUP_THRESHOLD).toBe(2.0);
    });
  });

  describe('normalizeStreet', () => {
    it('should strip רחוב prefix', () => {
      expect(normalizeStreet('רחוב הרצל')).toBe('הרצל');
    });

    it('should strip רח\' prefix', () => {
      expect(normalizeStreet('רח\' דיזנגוף')).toBe('דיזנגוף');
    });

    it('should strip ברחוב prefix', () => {
      expect(normalizeStreet('ברחוב בן יהודה')).toBe('בן יהודה');
    });

    it('should strip רח׳ prefix (Hebrew geresh)', () => {
      expect(normalizeStreet('רח׳ אלנבי')).toBe('אלנבי');
    });

    it('should strip ברח\' prefix', () => {
      expect(normalizeStreet('ברח\' שינקין')).toBe('שינקין');
    });

    it('should lowercase the result', () => {
      expect(normalizeStreet('רחוב Herzl')).toBe('herzl');
    });

    it('should trim whitespace', () => {
      expect(normalizeStreet('  רחוב הרצל  ')).toBe('הרצל');
    });

    it('should handle street without prefix', () => {
      expect(normalizeStreet('Main Street')).toBe('main street');
    });
  });

  describe('distanceMeters', () => {
    it('should calculate distance for coordinates ~100m apart', () => {
      // Tel Aviv: Dizengoff & Gordon (32.0808, 34.7730) to ~100m north
      const lat1 = 32.0808;
      const lon1 = 34.7730;
      const lat2 = 32.0817; // ~100m north
      const lon2 = 34.7730;

      const distance = distanceMeters(lat1, lon1, lat2, lon2);
      expect(distance).toBeGreaterThan(90);
      expect(distance).toBeLessThan(110);
    });

    it('should return 0 for same coordinates', () => {
      const distance = distanceMeters(32.0808, 34.7730, 32.0808, 34.7730);
      expect(distance).toBe(0);
    });

    it('should calculate distance for coordinates ~50m apart', () => {
      const lat1 = 32.0808;
      const lon1 = 34.7730;
      const lat2 = 32.0812; // ~44m north
      const lon2 = 34.7730;

      const distance = distanceMeters(lat1, lon1, lat2, lon2);
      expect(distance).toBeGreaterThan(40);
      expect(distance).toBeLessThan(60);
    });
  });

  describe('matchScore', () => {
    describe('street matching', () => {
      it('should score 3.0 for same street and house number', () => {
        const a: DedupFields = {
          street: 'רחוב הרצל',
          house_number: '10',
          neighborhood: null,
          latitude: null,
          longitude: null,
          price: null,
        };
        const b: DedupFields = {
          street: 'הרצל',
          house_number: '10',
          neighborhood: null,
          latitude: null,
          longitude: null,
          price: null,
        };

        expect(matchScore(a, b)).toBe(3.0);
      });

      it('should score 1.5 for same street with missing house number', () => {
        const a: DedupFields = {
          street: 'רחוב דיזנגוף',
          house_number: null,
          neighborhood: null,
          latitude: null,
          longitude: null,
          price: null,
        };
        const b: DedupFields = {
          street: 'דיזנגוף',
          house_number: '50',
          neighborhood: null,
          latitude: null,
          longitude: null,
          price: null,
        };

        expect(matchScore(a, b)).toBe(1.5);
      });

      it('should score 0 for same street with different house numbers', () => {
        const a: DedupFields = {
          street: 'רחוב בן יהודה',
          house_number: '10',
          neighborhood: null,
          latitude: null,
          longitude: null,
          price: null,
        };
        const b: DedupFields = {
          street: 'בן יהודה',
          house_number: '20',
          neighborhood: null,
          latitude: null,
          longitude: null,
          price: null,
        };

        expect(matchScore(a, b)).toBe(0);
      });

      it('should score 0 for different streets', () => {
        const a: DedupFields = {
          street: 'רחוב הרצל',
          house_number: '10',
          neighborhood: null,
          latitude: null,
          longitude: null,
          price: null,
        };
        const b: DedupFields = {
          street: 'רחוב דיזנגוף',
          house_number: '10',
          neighborhood: null,
          latitude: null,
          longitude: null,
          price: null,
        };

        expect(matchScore(a, b)).toBe(0);
      });
    });

    describe('neighborhood matching', () => {
      it('should score 1.5 for same neighborhood with price within 5%', () => {
        const a: DedupFields = {
          street: null,
          house_number: null,
          neighborhood: 'Florentin',
          latitude: null,
          longitude: null,
          price: 5000,
        };
        const b: DedupFields = {
          street: null,
          house_number: null,
          neighborhood: 'Florentin',
          latitude: null,
          longitude: null,
          price: 5200, // 4% difference
        };

        expect(matchScore(a, b)).toBe(1.5);
      });

      it('should score 0.5 for same neighborhood with prices far apart', () => {
        const a: DedupFields = {
          street: null,
          house_number: null,
          neighborhood: 'Florentin',
          latitude: null,
          longitude: null,
          price: 5000,
        };
        const b: DedupFields = {
          street: null,
          house_number: null,
          neighborhood: 'Florentin',
          latitude: null,
          longitude: null,
          price: 7000, // 40% difference
        };

        expect(matchScore(a, b)).toBe(0.5);
      });

      it('should score 0.5 for same neighborhood with no prices', () => {
        const a: DedupFields = {
          street: null,
          house_number: null,
          neighborhood: 'Florentin',
          latitude: null,
          longitude: null,
          price: null,
        };
        const b: DedupFields = {
          street: null,
          house_number: null,
          neighborhood: 'Florentin',
          latitude: null,
          longitude: null,
          price: null,
        };

        expect(matchScore(a, b)).toBe(0.5);
      });

      it('should score 0 for different neighborhoods', () => {
        const a: DedupFields = {
          street: null,
          house_number: null,
          neighborhood: 'Florentin',
          latitude: null,
          longitude: null,
          price: 5000,
        };
        const b: DedupFields = {
          street: null,
          house_number: null,
          neighborhood: 'Neve Tzedek',
          latitude: null,
          longitude: null,
          price: 5000,
        };

        expect(matchScore(a, b)).toBe(0);
      });
    });

    describe('coordinate matching', () => {
      it('should score 2.0 for coordinates within 50m', () => {
        const a: DedupFields = {
          street: null,
          house_number: null,
          neighborhood: null,
          latitude: 32.0808,
          longitude: 34.7730,
          price: null,
        };
        const b: DedupFields = {
          street: null,
          house_number: null,
          neighborhood: null,
          latitude: 32.0812, // ~44m north
          longitude: 34.7730,
          price: null,
        };

        expect(matchScore(a, b)).toBe(2.0);
      });

      it('should score 0 for coordinates more than 50m apart', () => {
        const a: DedupFields = {
          street: null,
          house_number: null,
          neighborhood: null,
          latitude: 32.0808,
          longitude: 34.7730,
          price: null,
        };
        const b: DedupFields = {
          street: null,
          house_number: null,
          neighborhood: null,
          latitude: 32.0817, // ~100m north
          longitude: 34.7730,
          price: null,
        };

        expect(matchScore(a, b)).toBe(0);
      });
    });

    describe('price bonus', () => {
      it('should add 0.5 for price within 3%', () => {
        const a: DedupFields = {
          street: null,
          house_number: null,
          neighborhood: 'Florentin',
          latitude: null,
          longitude: null,
          price: 5000,
        };
        const b: DedupFields = {
          street: null,
          house_number: null,
          neighborhood: 'Florentin',
          latitude: null,
          longitude: null,
          price: 5100, // 2% difference
        };

        // 1.5 (neighborhood+price within 5%) + 0.5 (price bonus within 3%) = 2.0
        expect(matchScore(a, b)).toBe(2.0);
      });

      it('should not add bonus for price exactly at 3%', () => {
        const a: DedupFields = {
          street: null,
          house_number: null,
          neighborhood: 'Florentin',
          latitude: null,
          longitude: null,
          price: 5000,
        };
        const b: DedupFields = {
          street: null,
          house_number: null,
          neighborhood: 'Florentin',
          latitude: null,
          longitude: null,
          price: 5155, // 155/5155 = 3.006% difference (just over 3%)
        };

        // 1.5 for neighborhood+price (within 5%), no price bonus (>= 3%)
        expect(matchScore(a, b)).toBe(1.5);
      });
    });

    describe('combined signals', () => {
      it('should score high for street + house + coordinates + price', () => {
        const a: DedupFields = {
          street: 'רחוב הרצל',
          house_number: '10',
          neighborhood: 'City Center',
          latitude: 32.0808,
          longitude: 34.7730,
          price: 5000,
        };
        const b: DedupFields = {
          street: 'הרצל',
          house_number: '10',
          neighborhood: 'City Center',
          latitude: 32.0809,
          longitude: 34.7731,
          price: 5100,
        };

        // 3.0 (street+house) + 1.5 (neighborhood+price) + 2.0 (coords) + 0.5 (price bonus) = 7.0
        const score = matchScore(a, b);
        expect(score).toBeGreaterThanOrEqual(6.5);
        expect(score).toBeLessThanOrEqual(7.5);
      });

      it('should score above threshold for likely duplicate', () => {
        const a: DedupFields = {
          street: 'רחוב דיזנגוף',
          house_number: '50',
          neighborhood: null,
          latitude: null,
          longitude: null,
          price: null,
        };
        const b: DedupFields = {
          street: 'דיזנגוף',
          house_number: '50',
          neighborhood: null,
          latitude: null,
          longitude: null,
          price: null,
        };

        const score = matchScore(a, b);
        expect(score).toBeGreaterThanOrEqual(DEDUP_THRESHOLD);
      });
    });

    describe('edge cases', () => {
      it('should score 0 for all null fields', () => {
        const a: DedupFields = {
          street: null,
          house_number: null,
          neighborhood: null,
          latitude: null,
          longitude: null,
          price: null,
        };
        const b: DedupFields = {
          street: null,
          house_number: null,
          neighborhood: null,
          latitude: null,
          longitude: null,
          price: null,
        };

        expect(matchScore(a, b)).toBe(0);
      });

      it('should handle zero price gracefully', () => {
        const a: DedupFields = {
          street: null,
          house_number: null,
          neighborhood: 'Florentin',
          latitude: null,
          longitude: null,
          price: 0,
        };
        const b: DedupFields = {
          street: null,
          house_number: null,
          neighborhood: 'Florentin',
          latitude: null,
          longitude: null,
          price: 5000,
        };

        // Should only get neighborhood score (0.5), no price comparison
        expect(matchScore(a, b)).toBe(0.5);
      });

      it('should handle negative coordinates', () => {
        const a: DedupFields = {
          street: null,
          house_number: null,
          neighborhood: null,
          latitude: -33.8688,
          longitude: 151.2093,
          price: null,
        };
        const b: DedupFields = {
          street: null,
          house_number: null,
          neighborhood: null,
          latitude: -33.8689,
          longitude: 151.2093,
          price: null,
        };

        const score = matchScore(a, b);
        expect(score).toBeGreaterThanOrEqual(0);
      });
    });
  });
});
