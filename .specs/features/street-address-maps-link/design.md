# Design: Street Address with Google Maps Link

**Feature:** Street Address with Google Maps Link in Telegram Notifications
**Status:** Designed
**Updated:** 2026-02-22

## Architecture Overview

This feature adds street-level location data to the existing listing pipeline:

```
YAD2 API → Connector → Database → Notification Service → Telegram
   ↓           ↓           ↓              ↓                  ↓
street/     extract    store in      format with       clickable
house #     fields     new cols      Maps link         link
```

## Database Changes

### Migration: 0003_add_street_address.sql

```sql
-- Add street address columns to listings table
ALTER TABLE listings ADD COLUMN street TEXT;
ALTER TABLE listings ADD COLUMN house_number TEXT;
```

**Rationale:**
- Nullable columns for backward compatibility
- Separate columns for flexibility in querying and display
- No index needed initially (not used for filtering)

## Type Updates

### packages/core/src/types.ts

**Listing interface:**
```typescript
export interface Listing {
  // ... existing fields
  street: string | null;
  houseNumber: string | null;
  // ... rest of fields
}
```

**ListingDraft interface:**
```typescript
export interface ListingDraft {
  // ... existing fields
  street: string | null;
  houseNumber: string | null;
  // ... rest of fields
}
```

### packages/db/src/schema.ts

**ListingRow interface:**
```typescript
export interface ListingRow {
  // ... existing fields
  street: string | null;
  house_number: string | null;
  // ... rest of fields
}
```

## Connector Changes

### packages/connectors/src/yad2/index.ts

**Update `normalize()` method:**

```typescript
normalize(candidate: ListingCandidate): ListingDraft {
  const sd = candidate.sourceData as Partial<Yad2Marker>;

  return {
    // ... existing fields
    street: sd.address?.street?.text ?? null,
    houseNumber: sd.address?.house?.number ?? null,
    // ... rest of fields
  };
}
```

**Rationale:**
- Extract from existing API data (no new API calls)
- Use optional chaining for safety
- Store raw values (no normalization needed for Hebrew text)

## Message Formatter Changes

### apps/notify/src/message-formatter.ts

**New method: `formatAddress()`**

```typescript
private formatAddress(listing: ListingRow): { text: string; mapsUrl: string } | null {
  // Build address components
  const parts: string[] = [];

  if (listing.street) {
    let streetPart = listing.street;
    if (listing.house_number) {
      streetPart += ` ${listing.house_number}`;
    }
    parts.push(streetPart);
  }

  if (listing.neighborhood) {
    parts.push(listing.neighborhood);
  }

  if (listing.city) {
    parts.push(listing.city);
  }

  if (parts.length === 0) return null;

  const addressText = parts.join(', ');

  // Build Google Maps search URL
  const mapsUrl = this.buildMapsUrl(listing);

  return { text: addressText, mapsUrl };
}

private buildMapsUrl(listing: ListingRow): string {
  const parts: string[] = [];

  if (listing.street) parts.push(listing.street);
  if (listing.house_number) parts.push(listing.house_number);
  if (listing.city) parts.push(listing.city);

  const query = parts.join(' ');
  const encoded = encodeURIComponent(query);

  return `https://www.google.com/maps/search/?api=1&query=${encoded}`;
}
```

**Update `format()` method:**

```typescript
format(listing: ListingRow): string {
  const parts: string[] = [];

  parts.push(`<b>${this.escapeHtml(listing.title)}</b>`);

  if (listing.price != null && listing.currency) {
    parts.push(`💰 ${this.formatPrice(listing.price, listing.currency, listing.price_period)}`);
  }

  if (listing.bedrooms != null) {
    const roomsText = listing.bedrooms === 0 ? 'Studio' : `${listing.bedrooms} rooms`;
    parts.push(`🏠 ${roomsText}`);
  }

  // NEW: Address with Google Maps link
  const address = this.formatAddress(listing);
  if (address) {
    parts.push(`📍 <a href="${address.mapsUrl}">${this.escapeHtml(address.text)}</a>`);
  }

  parts.push(`\n<a href="${listing.url}">View Listing</a>`);

  return parts.join('\n');
}
```

**Rationale:**
- Separate method for address formatting (testability, clarity)
- Build address incrementally based on available data
- Always generate Maps URL if we have any location data
- HTML-escape address text to prevent injection
- Use Google Maps Search API (no key required)

## Test Updates

### packages/connectors/src/yad2/__tests__/connector.test.ts

**Add test case:**

```typescript
it('should extract street and house number', () => {
  const marker = createTestMarker({
    address: {
      city: { text: 'תל אביב' },
      area: { text: 'מרכז' },
      neighborhood: { text: 'פלורנטין' },
      street: { text: 'רוטשילד' },
      house: { number: '12', floor: 3 },
      coords: { lat: 32.06, lon: 34.77 },
    },
  });

  const candidate: ListingCandidate = {
    source: 'yad2',
    sourceItemId: marker.orderId,
    rawTitle: 'Test',
    rawDescription: 'Test',
    rawUrl: 'https://www.yad2.co.il/realestate/rent',
    rawPostedAt: null,
    sourceData: marker as unknown as Record<string, unknown>,
  };

  const draft = connector.normalize(candidate);

  expect(draft.street).toBe('רוטשילד');
  expect(draft.houseNumber).toBe('12');
});

it('should handle missing street data', () => {
  const marker = createTestMarker({
    address: {
      city: { text: 'תל אביב' },
      area: { text: 'מרכז' },
      neighborhood: { text: 'פלורנטין' },
      street: { text: '' },
      house: { number: null, floor: 3 },
      coords: { lat: 32.06, lon: 34.77 },
    },
  });

  const candidate: ListingCandidate = {
    source: 'yad2',
    sourceItemId: marker.orderId,
    rawTitle: 'Test',
    rawDescription: 'Test',
    rawUrl: 'https://www.yad2.co.il/realestate/rent',
    rawPostedAt: null,
    sourceData: marker as unknown as Record<string, unknown>,
  };

  const draft = connector.normalize(candidate);

  expect(draft.street).toBeNull();
  expect(draft.houseNumber).toBeNull();
});
```

### apps/notify/src/__tests__/message-formatter.test.ts

**Create new test file:**

```typescript
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
    expect(message).toContain('רוטשילד 12, פלורנטין, תל אביב');
    expect(message).toContain('https://www.google.com/maps/search/?api=1&query=');
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

    expect(message).toContain('רוטשילד, פלורנטין, תל אביב');
    expect(message).toContain('https://www.google.com/maps/search/?api=1&query=');
  });

  it('should fall back to city/neighborhood when street missing', () => {
    const listing = createTestListing({
      street: null,
      house_number: null,
      neighborhood: 'פלורנטין',
      city: 'תל אביב',
    });

    const message = formatter.format(listing);

    expect(message).toContain('פלורנטין, תל אביב');
    expect(message).toContain('https://www.google.com/maps/search/?api=1&query=');
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
    expect(message).toContain('https://www.google.com/maps/search/?api=1&query=');
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
});
```

## Data Flow

**New listing ingestion:**
```
1. YAD2 API returns marker with address.street and address.house
2. Connector.normalize() extracts street and house_number
3. Processor stores in listings.street and listings.house_number
4. NotificationService retrieves listing with street data
5. MessageFormatter generates message with Maps link
6. TelegramClient sends HTML message with clickable link
```

**Example Telegram message:**

```
דירה 3 חדרים בתל אביב

💰 ₪5,000/month
🏠 3 rooms
📍 [רוטשילד 12, פלורנטין, תל אביב](https://maps.google.com/...)

View Listing
```

## Deployment Sequence

1. **Database migration**: Run `0003_add_street_address.sql` on D1
2. **Code deployment**: Deploy all packages in single PR
3. **Verification**: Check new listings include Maps links
4. **Monitoring**: Observe notification success rates

## Rollback Plan

If issues occur:
1. Revert code changes (database columns remain, unused)
2. No data loss (nullable columns don't affect existing rows)
3. Re-deploy after fix

The nullable columns can be dropped later if feature is abandoned:
```sql
ALTER TABLE listings DROP COLUMN street;
ALTER TABLE listings DROP COLUMN house_number;
```

## Performance Impact

- **Database**: +2 TEXT columns per listing (~50 bytes each)
- **Memory**: Negligible (string fields already in use)
- **Network**: No additional API calls
- **CPU**: Minimal (string concatenation + URL encoding)

**Estimated impact:** <1% increase in notification processing time

## Security Considerations

- **XSS Prevention**: HTML-escape all address text before rendering
- **URL Safety**: Use `encodeURIComponent()` for Maps URL parameters
- **No PII**: Street address is public data from YAD2
- **Telegram Security**: Maps links open in Telegram's sandboxed browser

## Alternative Designs Considered

**Alt 1: Use geo: protocol with coordinates**
- Format: `geo:{lat},{lon}`
- Rejected: Doesn't show address context, less user-friendly

**Alt 2: Use Waze deep links**
- Format: `https://waze.com/ul?ll={lat},{lon}`
- Rejected: Not universally available, Google Maps more common

**Alt 3: Store full address as single field**
- Single `address` column instead of street + house_number
- Rejected: Less flexible for future filtering/sorting features

**Alt 4: Backfill existing listings**
- Re-fetch street data for existing listings
- Deferred: Can be done later if needed, not critical for new feature
