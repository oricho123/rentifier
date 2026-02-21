export const SUPPORTED_CITIES = [
  'Tel Aviv',
  'Jerusalem',
  'Haifa',
  'Herzliya',
  'Ramat Gan',
  'Netanya',
  'Beer Sheva',
] as const;

export const LISTING_TAGS = [
  'parking',
  'balcony',
  'pets',
  'furnished',
  'immediate',
  'long-term',
  'accessible',
  'air-conditioning',
] as const;

export const CURRENCIES = ['ILS', 'USD', 'EUR'] as const;
export const PRICE_PERIODS = ['month', 'week', 'day'] as const;

export type City = typeof SUPPORTED_CITIES[number];
export type ListingTag = typeof LISTING_TAGS[number];
export type Currency = typeof CURRENCIES[number];
export type PricePeriod = typeof PRICE_PERIODS[number];
