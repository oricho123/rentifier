import { describe, it, expect } from 'vitest';
import { MessageFormatter } from '../message-formatter';
import type { ListingRow } from '@rentifier/db';

function createTestListing(overrides: Partial<ListingRow> = {}): ListingRow {
  return {
    id: 1,
    source_id: 1,
    source_item_id: 'test-123',
    title: 'דירה בתל אביב',
    description: null,
    price: 5000,
    currency: 'ILS',
    price_period: 'month',
    bedrooms: 3,
    city: 'תל אביב',
    neighborhood: 'פלורנטין',
    area_text: null,
    street: null,
    house_number: null,
    url: 'https://www.yad2.co.il/item/test',
    posted_at: null,
    ingested_at: '2026-02-22T10:00:00Z',
    tags_json: null,
    relevance_score: null,
    floor: null,
    square_meters: null,
    property_type: null,
    latitude: null,
    longitude: null,
    image_url: null,
    ...overrides,
  };
}

describe('MessageFormatter', () => {
  const formatter = new MessageFormatter();

  it('should include street address with Google Maps link', () => {
    const listing = createTestListing({
      street: 'רוטשילד',
      house_number: '12',
      neighborhood: 'פלורנטין',
      city: 'תל אביב',
    });

    const message = formatter.format(listing);

    expect(message).toContain('📍');
    expect(message).toContain('תל אביב - פלורנטין');
    expect(message).toContain('רוטשילד 12');
    // URL is HTML-encoded, so & becomes &amp;
    expect(message).toContain('https://www.google.com/maps/search/?api=1&amp;query=');
    expect(message).toContain(encodeURIComponent('רוטשילד 12 תל אביב'));
  });

  it('should handle missing house number', () => {
    const listing = createTestListing({
      street: 'רוטשילד',
      house_number: null,
      neighborhood: 'פלורנטין',
      city: 'תל אביב',
    });

    const message = formatter.format(listing);

    expect(message).toContain('תל אביב - פלורנטין');
    expect(message).toContain('רוטשילד');
    // URL is HTML-encoded, so & becomes &amp;
    expect(message).toContain('https://www.google.com/maps/search/?api=1&amp;query=');
  });

  it('should fall back to city/neighborhood when street missing', () => {
    const listing = createTestListing({
      street: null,
      house_number: null,
      neighborhood: 'פלורנטין',
      city: 'תל אביב',
    });

    const message = formatter.format(listing);

    expect(message).toContain('תל אביב - פלורנטין');
    expect(message).not.toContain('https://www.google.com/maps/search/?api=1&query=');
  });

  it('should handle only city available', () => {
    const listing = createTestListing({
      street: null,
      house_number: null,
      neighborhood: null,
      city: 'תל אביב',
    });

    const message = formatter.format(listing);

    expect(message).toContain('תל אביב');
    expect(message).not.toContain('https://www.google.com/maps/search/?api=1&query=');
  });

  it('should escape HTML in address text', () => {
    const listing = createTestListing({
      street: '<script>alert("xss")</script>',
      city: 'תל אביב',
    });

    const message = formatter.format(listing);

    expect(message).not.toContain('<script>');
    expect(message).toContain('&lt;script&gt;');
  });

  it('should format complete message with all fields', () => {
    const listing = createTestListing({
      title: 'דירת 3 חדרים מרווחת',
      price: 6000,
      currency: 'ILS',
      price_period: 'month',
      bedrooms: 3,
      street: 'דיזנגוף',
      house_number: '50',
      neighborhood: 'צפון תל אביב',
      city: 'תל אביב',
    });

    const message = formatter.format(listing);

    expect(message).toContain('<b>דירת 3 חדרים מרווחת</b>');
    expect(message).toContain('💰 ₪6,000/month');
    expect(message).toContain('🏠 3 rooms');
    expect(message).toContain('📍');
    expect(message).toContain('תל אביב - צפון תל אביב');
    expect(message).toContain('דיזנגוף 50');
    expect(message).toContain('View Listing');
  });
});
