// Fully normalized listing
export interface Listing {
  id: number;                      // Auto-increment PK from D1
  sourceId: string;                // e.g., "yad2", "facebook"
  sourceItemId: string;            // Original listing ID from source
  title: string;
  description: string;
  price: number;
  currency: 'ILS' | 'USD' | 'EUR';
  pricePeriod: 'month' | 'week' | 'day';
  bedrooms: number;                // 0 = studio
  city: string;
  neighborhood: string | null;
  floor: number | null;
  squareMeters: number | null;
  propertyType: string | null;
  latitude: number | null;
  longitude: number | null;
  imageUrl: string | null;
  tags: string[];                  // e.g., ["parking", "balcony", "pets"]
  url: string;
  postedAt: Date;
  ingestedAt: Date;
}

// Raw listing before normalization
export interface ListingCandidate {
  source: string;
  sourceItemId: string;
  rawTitle: string;
  rawDescription: string;
  rawUrl: string;
  rawPostedAt: string | null;      // ISO date string or null
  sourceData: Record<string, unknown>; // Source-specific fields
}

// Partially normalized (after extraction, before DB insert)
export interface ListingDraft {
  sourceId: string;
  sourceItemId: string;
  title: string;
  description: string;
  price: number | null;
  currency: 'ILS' | 'USD' | 'EUR' | null;
  pricePeriod: 'month' | 'week' | 'day' | null;
  bedrooms: number | null;
  city: string | null;
  neighborhood: string | null;
  tags: string[];
  url: string;
  postedAt: Date | null;
  floor: number | null;
  squareMeters: number | null;
  propertyType: string | null;
  latitude: number | null;
  longitude: number | null;
  imageUrl: string | null;
}

// User filter criteria
export interface Filter {
  id: number;
  userId: number;
  name: string;
  minPrice: number | null;
  maxPrice: number | null;
  minBedrooms: number | null;
  maxBedrooms: number | null;
  cities: string[];
  neighborhoods: string[];
  keywords: string[];              // Must appear in title or description
  mustHaveTags: string[];
  excludeTags: string[];
  createdAt: Date;
}
