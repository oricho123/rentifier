# Feature Specification: Listing Images in Telegram Notifications

**Status**: ✅ IMPLEMENTED (2026-02-23)

## Overview

Add listing cover images to Telegram notifications to provide users with visual context when evaluating rental properties.

## Problem Statement

Current Telegram notifications are text-only, requiring users to click the listing URL to see property images. This adds friction to the user experience and makes it harder to quickly evaluate listings.

## Goals

- Display the listing's cover image alongside the notification text
- Maintain current message formatting and clickable links
- Handle cases where listings have no images gracefully
- Ensure images load reliably in Telegram

## Non-Goals

- Image galleries (multiple images per listing)
- Image optimization or resizing
- Image caching or hosting
- Image analysis or filtering

## Requirements

### Functional Requirements

1. **Image Display**
   - Send listing cover image with each Telegram notification
   - Use Telegram's photo message type with caption
   - Display the same formatted text as caption (price, rooms, location, etc.)
   - Photo and caption sent as **ONE message** (not separate messages)
   - Works with **all connectors** (YAD2, Facebook, future sources) that provide image URLs

2. **Fallback Behavior**
   - If a listing has no image URL, send text-only notification (current behavior)
   - If image URL fails to load, fall back to text-only notification
   - Log image loading failures for monitoring

3. **Image Source**
   - Use the `image_url` field from the listings table
   - Support both HTTP and HTTPS image URLs
   - No image format restrictions (Telegram handles validation)

### Non-Functional Requirements

1. **Performance**
   - Image sending should not significantly slow down notification delivery
   - Failed image loads should timeout quickly and fall back

2. **Reliability**
   - Image failures should not prevent text notifications from being sent
   - Track image success/failure rates for monitoring

3. **Compatibility**
   - Works with existing message formatter
   - Maintains HTML formatting in captions
   - Preserves clickable Google Maps links

## User Stories

### As a User
- I want to see property images in my Telegram notifications
- So that I can quickly evaluate listings without clicking through

### As a User
- I want text notifications to still work if images fail to load
- So that I don't miss listings due to image issues

## Acceptance Criteria

1. ✅ Listings with images show the cover photo in Telegram
2. ✅ Message text appears as the photo caption
3. ✅ HTML formatting works in captions (bold, links)
4. ✅ Listings without images still send text-only notifications
5. ✅ Image loading failures don't block text notifications
6. ✅ Image success/failure is logged for monitoring

## Implementation Status

**Status**: ✅ Complete (2026-02-23)

### Changes Made

1. **TelegramClient** (`apps/notify/src/telegram-client.ts`)
   - Added `SendPhotoResult` interface with retryable/imageAvailable tracking
   - Implemented `sendPhoto()` method using Telegram Bot API
   - Added `isRetryableError()` helper to distinguish network errors (429, 502, 503, 504) from permanent failures (400)

2. **NotificationService** (`apps/notify/src/notification-service.ts`)
   - Extended `NotificationResult` interface with `imageSuccess`, `imageFallback`, `noImage` metrics
   - Updated notification loop to use `sendPhoto()` when `listing.image_url` exists
   - Implemented fallback to `sendMessage()` on non-retryable image errors
   - Added structured logging for image events (attempt, success, failure)
   - Calculate and log `imageSuccessRate` in completion event

3. **Tests**
   - Created `apps/notify/src/__tests__/telegram-client.test.ts` with 7 test cases
   - Created `apps/notify/src/__tests__/notification-service.test.ts` with 8 test cases
   - All 15 new tests passing
   - TypeScript compilation clean (zero errors)

### Verification

- ✅ TypeScript: Zero type errors across all modified files
- ✅ Unit Tests: 15/15 new tests passing
- ✅ Code Coverage: >90% for new sendPhoto method
- ✅ Logging: Structured JSON logs for monitoring image success/failure
- ✅ Metrics: Image success rate calculated and logged

## Out of Scope

- Custom image hosting or CDN
- Image compression or optimization
- Multiple images per listing
- Image previews or thumbnails
- User preferences for images on/off

## Success Metrics

- Image success rate > 95%
- No increase in notification delivery time
- Zero text notifications blocked by image failures
- User feedback positive on visual improvements

## Dependencies

- Telegram Bot API `sendPhoto` method
- Existing `image_url` field in listings table (already populated by YAD2 connector)
- Existing message formatter for caption text

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Image URLs from YAD2 become invalid | Medium | Implement fallback to text-only |
| Telegram rejects image URLs | Low | Validate URLs before sending |
| Image loading slows notifications | Medium | Set timeout, fall back quickly |
| Some images too large | Low | Telegram handles validation |

## Open Questions

- Should we add image size validation before sending?
  - **Decision**: No, let Telegram handle validation
- Should we track which listings have vs don't have images?
  - **Decision**: Yes, log image availability in metrics
