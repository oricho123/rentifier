import { z } from 'zod';

export const listingSchema = z.object({
  id: z.number().int().positive(),
  sourceId: z.string().min(1),
  sourceItemId: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  price: z.number().positive(),
  currency: z.enum(['ILS', 'USD', 'EUR']),
  pricePeriod: z.enum(['month', 'week', 'day']),
  bedrooms: z.number().int().min(0),
  city: z.string().min(1),
  neighborhood: z.string().nullable(),
  tags: z.array(z.string()),
  url: z.string().url(),
  postedAt: z.date(),
  ingestedAt: z.date(),
});

export const listingCandidateSchema = z.object({
  source: z.string().min(1),
  sourceItemId: z.string().min(1),
  rawTitle: z.string(),
  rawDescription: z.string(),
  rawUrl: z.string().url(),
  rawPostedAt: z.string().nullable(),
  sourceData: z.record(z.unknown()),
});

export const filterSchema = z.object({
  id: z.number().int().positive(),
  userId: z.number().int().positive(),
  name: z.string().min(1),
  minPrice: z.number().positive().nullable(),
  maxPrice: z.number().positive().nullable(),
  minBedrooms: z.number().int().min(0).nullable(),
  maxBedrooms: z.number().int().min(0).nullable(),
  cities: z.array(z.string()),
  neighborhoods: z.array(z.string()),
  keywords: z.array(z.string()),
  mustHaveTags: z.array(z.string()),
  excludeTags: z.array(z.string()),
  createdAt: z.date(),
});

export const listingDraftSchema = z.object({
  sourceId: z.string().min(1),
  sourceItemId: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  price: z.number().positive().nullable(),
  currency: z.enum(['ILS', 'USD', 'EUR']).nullable(),
  pricePeriod: z.enum(['month', 'week', 'day']).nullable(),
  bedrooms: z.number().int().min(0).nullable(),
  city: z.string().nullable(),
  neighborhood: z.string().nullable(),
  tags: z.array(z.string()),
  url: z.string().url(),
  postedAt: z.date().nullable(),
});
