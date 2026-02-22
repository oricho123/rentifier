# Tasks: Listing Images in Telegram Notifications

## Task Breakdown

### Phase 1: TelegramClient Updates

#### Task 1.1: Add sendPhoto method to TelegramClient
**Priority**: High
**Estimated Effort**: 2 hours
**Dependencies**: None

**Description**:
Implement a new `sendPhoto()` method in the TelegramClient class to send photos with captions using the Telegram Bot API.

**Implementation Details**:
- Add `SendPhotoResult` interface extending existing result pattern
- Implement `sendPhoto(chatId, photoUrl, caption, parseMode)` method
- Use Telegram Bot API `sendPhoto` endpoint
- Handle success/error responses
- Map Telegram error codes to retryable/non-retryable

**Files to Modify**:
- `apps/notify/src/telegram-client.ts`

**Code Changes**:
```typescript
interface SendPhotoResult {
  success: boolean;
  messageId?: number;
  error?: string;
  retryable: boolean;
  imageAvailable: boolean;
}

async sendPhoto(
  chatId: string,
  photoUrl: string,
  caption: string,
  parseMode: 'HTML' | 'Markdown'
): Promise<SendPhotoResult> {
  const url = `https://api.telegram.org/bot${this.token}/sendPhoto`;
  const payload = {
    chat_id: chatId,
    photo: photoUrl,
    caption: caption,
    parse_mode: parseMode,
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (data.ok) {
      return {
        success: true,
        messageId: data.result.message_id,
        retryable: false,
        imageAvailable: true,
      };
    } else {
      // Handle Telegram API errors
      const isRetryable = this.isRetryableError(data.error_code);
      return {
        success: false,
        error: data.description,
        retryable: isRetryable,
        imageAvailable: true,
      };
    }
  } catch (error) {
    // Network errors are retryable
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      retryable: true,
      imageAvailable: true,
    };
  }
}

private isRetryableError(errorCode: number): boolean {
  // Network errors: 502, 503, 504
  // Rate limiting: 429
  return [429, 502, 503, 504].includes(errorCode);
}
```

**Acceptance Criteria**:
- ✅ Method signature matches design
- ✅ Returns correct result structure
- ✅ Handles Telegram API success response
- ✅ Handles Telegram API error response
- ✅ Distinguishes retryable vs non-retryable errors
- ✅ Network errors marked as retryable
- ✅ Invalid URL errors marked as non-retryable

---

#### Task 1.2: Add unit tests for sendPhoto
**Priority**: High
**Estimated Effort**: 1 hour
**Dependencies**: Task 1.1

**Description**:
Write comprehensive unit tests for the new `sendPhoto()` method.

**Files to Create/Modify**:
- `apps/notify/src/__tests__/telegram-client.test.ts`

**Test Cases**:
1. ✅ Successful photo send returns success=true with messageId
2. ✅ Invalid image URL returns success=false, retryable=false
3. ✅ Network error returns success=false, retryable=true
4. ✅ Rate limiting (429) returns retryable=true
5. ✅ Image too large returns success=false, retryable=false
6. ✅ Correct request payload sent to Telegram API
7. ✅ HTML parse mode passed correctly

**Acceptance Criteria**:
- ✅ All test cases pass
- ✅ Code coverage > 90% for sendPhoto method
- ✅ Tests use mocked fetch responses

---

### Phase 2: NotificationService Integration

#### Task 2.1: Update NotificationService to send photos
**Priority**: High
**Estimated Effort**: 3 hours
**Dependencies**: Task 1.1

**Description**:
Modify the notification sending logic to use `sendPhoto()` when images are available, with fallback to text-only.

**Implementation Details**:
- Check if `listing.image_url` exists
- If yes, call `sendPhoto()` first
- If image send fails with non-retryable error, fall back to `sendMessage()`
- If no image_url, use `sendMessage()` directly
- Add logging for image success/failure
- Track image metrics in result object

**Files to Modify**:
- `apps/notify/src/notification-service.ts`

**Code Changes**:
```typescript
// Add to NotificationResult interface
export interface NotificationResult {
  sent: number;
  failed: number;
  skipped: number;
  errors: NotificationError[];
  imageSuccess: number;    // NEW
  imageFallback: number;   // NEW
  noImage: number;         // NEW
}

// Update notification loop
for (const listing of matches) {
  try {
    const alreadySent = await this.db.checkNotificationSent(user.id, listing.id);
    if (alreadySent) {
      result.skipped++;
      continue;
    }

    const message = this.formatter.format(listing);
    let sendResult;

    if (listing.image_url) {
      // Try sending with image
      console.log(JSON.stringify({
        event: 'image_send_attempt',
        listingId: listing.id,
        userId: user.id,
        imageUrl: listing.image_url
      }));

      sendResult = await this.telegram.sendPhoto(
        user.telegram_chat_id,
        listing.image_url,
        message,
        'HTML'
      );

      if (sendResult.success) {
        result.imageSuccess++;
        console.log(JSON.stringify({
          event: 'image_send_success',
          listingId: listing.id,
          userId: user.id,
          messageId: sendResult.messageId
        }));
      } else if (!sendResult.retryable) {
        // Image failed, fall back to text
        console.log(JSON.stringify({
          event: 'image_send_failed',
          listingId: listing.id,
          userId: user.id,
          error: sendResult.error,
          fallbackToText: true
        }));

        sendResult = await this.telegram.sendMessage(
          user.telegram_chat_id,
          message,
          'HTML'
        );

        if (sendResult.success) {
          result.imageFallback++;
        }
      }
    } else {
      // No image, send text-only
      result.noImage++;
      sendResult = await this.telegram.sendMessage(
        user.telegram_chat_id,
        message,
        'HTML'
      );
    }

    // Existing result handling
    if (sendResult.success) {
      await this.db.recordNotificationSent(user.id, listing.id, filter.id, 'telegram');
      result.sent++;
      console.log(JSON.stringify({
        event: 'notification_sent',
        userId: user.id,
        listingId: listing.id,
        messageId: sendResult.messageId,
      }));
    } else if (sendResult.retryable) {
      result.failed++;
      result.errors.push({
        userId: user.id,
        listingId: listing.id,
        filterId: filter.id,
        error: sendResult.error || 'Unknown error',
      });
    } else {
      result.failed++;
      result.errors.push({
        userId: user.id,
        listingId: listing.id,
        filterId: filter.id,
        error: sendResult.error || 'Permanent send failure',
      });
      break; // Skip remaining matches for this user
    }
  } catch (error) {
    // Existing error handling
  }
}

// Update final logging
console.log(JSON.stringify({
  event: 'notify_complete',
  ...result,
  imageSuccessRate: result.imageSuccess / (result.imageSuccess + result.imageFallback + result.noImage)
}));
```

**Acceptance Criteria**:
- ✅ Listings with image_url send photos
- ✅ Listings without image_url send text-only
- ✅ Image failures fall back to text
- ✅ Image success/failure logged correctly
- ✅ Metrics tracked in result object
- ✅ Existing error handling preserved

---

#### Task 2.2: Add tests for notification image flow
**Priority**: High
**Estimated Effort**: 2 hours
**Dependencies**: Task 2.1

**Description**:
Write tests for the updated notification service logic.

**Files to Create/Modify**:
- `apps/notify/src/__tests__/notification-service.test.ts`

**Test Cases**:
1. ✅ Listing with image_url calls sendPhoto
2. ✅ Successful photo send increments imageSuccess
3. ✅ Failed photo send (non-retryable) falls back to sendMessage
4. ✅ Fallback to text increments imageFallback
5. ✅ Listing without image_url calls sendMessage directly
6. ✅ No image increments noImage counter
7. ✅ Image success rate calculated correctly in final log

**Acceptance Criteria**:
- ✅ All test cases pass
- ✅ Tests mock both sendPhoto and sendMessage
- ✅ Tests verify fallback behavior
- ✅ Tests verify metrics tracking

---

### Phase 3: Testing & Validation

#### Task 3.1: Manual testing with real data
**Priority**: High
**Estimated Effort**: 1 hour
**Dependencies**: Task 2.1

**Description**:
Test the feature end-to-end with real YAD2 listings in development environment.

**Testing Steps**:
1. Clear local database
2. Fetch fresh listings from YAD2 (should have image_url)
3. Trigger notify worker
4. Verify in Telegram:
   - ✅ Image displays correctly
   - ✅ Caption shows formatted text
   - ✅ HTML links work (Google Maps, View Listing)
   - ✅ Bold text renders
5. Check logs for image metrics

**Test Scenarios**:
- **Scenario 1**: Listing with valid image
  - Expected: Photo sent with caption

- **Scenario 2**: Listing without image_url
  - Expected: Text-only message sent

- **Scenario 3**: Listing with invalid image URL
  - Expected: Photo send fails, fallback to text
  - Manual test: Update a listing's image_url to invalid URL

**Acceptance Criteria**:
- ✅ All scenarios tested
- ✅ Screenshots captured
- ✅ No errors in logs
- ✅ Image success rate > 90%

---

#### Task 3.2: Performance validation
**Priority**: Medium
**Estimated Effort**: 30 minutes
**Dependencies**: Task 3.1

**Description**:
Verify that adding images doesn't significantly slow down notifications.

**Validation Steps**:
1. Measure notification batch time before feature (baseline)
2. Measure notification batch time after feature
3. Compare timing
4. Check for any timeout errors

**Metrics to Track**:
- Average time per notification (before/after)
- Total batch processing time
- Any rate limiting issues
- Image load failures

**Acceptance Criteria**:
- ✅ No significant performance degradation (<10% slower)
- ✅ No new timeout errors
- ✅ No rate limiting issues

---

### Phase 4: Documentation & Deployment

#### Task 4.1: Update documentation
**Priority**: Low
**Estimated Effort**: 30 minutes
**Dependencies**: Task 3.1

**Description**:
Update project documentation to reflect the new image feature.

**Files to Update**:
- Update feature spec with implementation notes
- Add troubleshooting section for common image issues
- Document image metrics in monitoring section

**Acceptance Criteria**:
- ✅ Documentation updated
- ✅ Code comments added for complex logic
- ✅ README updated if needed

---

#### Task 4.2: Deploy to production
**Priority**: High
**Estimated Effort**: 30 minutes
**Dependencies**: All previous tasks

**Description**:
Deploy the feature to production with monitoring.

**Deployment Steps**:
1. Merge PR to main
2. Deploy notify worker to Cloudflare
3. Monitor logs for first hour
4. Check image success rate
5. Verify user feedback (if any)

**Monitoring Checklist**:
- ✅ Check image_send_success events
- ✅ Check image_send_failed events
- ✅ Check fallback rate
- ✅ Monitor notification delivery rate
- ✅ Check for any new errors

**Rollback Plan**:
- If image success rate < 80%, investigate issues
- If notifications significantly delayed, consider rollback
- Keep text-only fallback as safety net

**Acceptance Criteria**:
- ✅ Feature deployed successfully
- ✅ No critical errors in production
- ✅ Image success rate > 90%
- ✅ Users receiving notifications normally

---

## Summary

**Total Estimated Effort**: ~10-11 hours

**Task Dependencies**:
```
1.1 (sendPhoto) → 1.2 (tests)
                ↓
2.1 (integration) → 2.2 (tests)
                   ↓
3.1 (manual test) → 3.2 (performance)
                   ↓
4.1 (docs) → 4.2 (deploy)
```

**Critical Path**: 1.1 → 2.1 → 3.1 → 4.2

**Risk Areas**:
- Image URL reliability from YAD2
- Telegram API image validation
- Caption length limits (if we add more fields)

**Success Criteria**:
- ✅ All tests passing
- ✅ Image success rate > 90%
- ✅ No performance degradation
- ✅ Fallback working correctly
- ✅ Zero critical bugs in production
