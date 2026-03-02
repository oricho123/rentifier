# Sublet vs Rent Classification

## Problem

Facebook rental posts mix long-term rentals and short-term sublets. Users want to filter by type — some only want long-term, others are looking for sublets. Currently all posts are treated the same.

## Goals

1. Classify each listing as `rent` or `sublet`
2. Store the classification in the DB
3. Allow Telegram filter by listing type
4. Show listing type in Telegram notification messages

## Detection

### Regex-based (phase 1)

Sublet keywords:
- Hebrew: `סאבלט`, `סבלט`, `סאב-לט`, `לתקופה קצרה`, `לחודש`, `לחודשיים`, `לשלושה חודשים`
- English: `sublet`, `sub-let`, `short-term`, `temporary`

Rent keywords (default — if no sublet keyword found):
- Hebrew: `להשכרה`, `לטווח ארוך`, `השכרה`
- English: `for rent`, `long-term`

### AI-enhanced (phase 2, with AI extraction feature)

LLM classifies based on full context — mentions of travel, specific date ranges, "while I'm abroad", etc.

## Schema Changes

### `listings` table
```sql
ALTER TABLE listings ADD COLUMN listing_type TEXT DEFAULT 'rent';
-- Values: 'rent', 'sublet'
```

### `ExtractionResult` type
```ts
listingType: 'rent' | 'sublet';
```

## Telegram Integration

### Message format
Add listing type badge to notification:
```
[Sublet] 2 rooms in Tel Aviv - Florentin
7,300 ILS/month
...
```

Or in Hebrew:
```
[סאבלט] 2 חדרים בתל אביב - פלורנטין
```

### Filter support
Add `listing_type` to Telegram bot filter commands:
```
/filter type rent        — only long-term rentals
/filter type sublet      — only sublets
/filter type all         — both (default)
```

## Implementation Plan

1. Add `listing_type` column to D1 schema migration
2. Add sublet detection to `packages/extraction/src/patterns.ts`
3. Add `extractListingType()` to extractors
4. Wire into processor pipeline
5. Update Telegram message formatter to show type badge
6. Add filter support to Telegram bot commands
7. Tests for detection and filtering

## Dependencies

- None (can be implemented independently)
- Enhanced by AI extraction feature when available
