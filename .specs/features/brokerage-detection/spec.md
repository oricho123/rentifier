# Brokerage Detection

## Problem

Many Facebook rental posts are from real estate brokers (תיווך/מתווך), not direct landlords. Users often prefer dealing directly with owners to avoid brokerage fees. Currently there's no way to distinguish or filter by this.

## Goals

1. Detect whether a listing is from a broker or direct owner
2. Always show brokerage status in Telegram notifications
3. Allow filtering by brokerage status in Telegram bot

## Detection

### Regex-based (phase 1)

Broker indicators:
- Hebrew: `תיווך`, `מתווך`, `מתווכת`, `סוכן`, `סוכנות`, `נכסים`, `נדל"ן`, `תיווך אבי`, `דמי תיווך`
- English: `broker`, `brokerage`, `agent`, `real estate`, `realty`
- Patterns: phone with `תיאום` (scheduling), company names like `X נכסים`, `X נדל"ן`

No-broker indicators:
- Hebrew: `ללא תיווך`, `בלי תיווך`, `ללא מתווכים`, `ישירות מבעלים`, `ללא דמי תיווך`
- English: `no broker`, `no agent`, `direct from owner`

### AI-enhanced (phase 2)

LLM analyzes full context — company signatures, multiple listings from same poster, professional formatting patterns.

## Schema Changes

### `listings` table
```sql
ALTER TABLE listings ADD COLUMN is_brokerage BOOLEAN DEFAULT NULL;
-- NULL = unknown, true = broker, false = direct/no-broker
```

### `ExtractionResult` type
```ts
isBrokerage: boolean | null;
```

## Telegram Integration

### Message format (always shown)
```
[Broker] 2 rooms in Tel Aviv - Florentin
8,250 ILS/month
...
```

Or when confirmed direct:
```
[Direct] 2 rooms in Tel Aviv - Florentin
```

Or in Hebrew:
```
[תיווך] 2 חדרים בתל אביב - פלורנטין
[ישיר] 2 חדרים בתל אביב - פלורנטין
```

When unknown (no indicators found), omit the badge.

### Filter support
```
/filter broker no         — exclude broker listings
/filter broker yes        — only broker listings
/filter broker all        — both (default)
```

## Implementation Plan

1. Add `is_brokerage` column to D1 schema migration
2. Add broker/no-broker patterns to `packages/extraction/src/patterns.ts`
3. Add `extractBrokerage()` to extractors
4. Wire into processor pipeline
5. Update Telegram message formatter to always show badge when detected
6. Add filter support to Telegram bot commands
7. Tests

## Dependencies

- None (can be implemented independently)
- Enhanced by AI extraction feature when available

## Examples from real posts

- `תיווך אבי&דן נכסים` → is_brokerage: true
- `ללא תיווך` → is_brokerage: false
- `לתיאום 050-3277215` + company name → is_brokerage: true
- No indicators → is_brokerage: null
