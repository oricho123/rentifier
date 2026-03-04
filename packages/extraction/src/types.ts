export interface PriceResult {
  amount: number;
  currency: 'ILS' | 'USD' | 'EUR';
  period: 'month' | 'week' | 'day';
  confidence: number;
}

export interface LocationResult {
  city: string;
  neighborhood: string | null;
  confidence: number;
}

export interface ExtractionResult {
  price: PriceResult | null;
  bedrooms: number | null;
  street: string | null;
  tags: string[];
  location: LocationResult | null;
  isNonRental: boolean;
  overallConfidence: number;
  floor: number | null;
  squareMeters: number | null;
  entryDate: string | null;
}
