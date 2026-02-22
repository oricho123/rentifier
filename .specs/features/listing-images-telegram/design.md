# Design: Listing Images in Telegram Notifications

## Architecture Overview

This feature modifies the notification flow to send photo messages instead of text-only messages when images are available.

**Key Points**:
- ✅ **Connector-agnostic**: Works with any connector (YAD2, Facebook, future sources) that populates `image_url`
- ✅ **Single message**: Photo and text sent as ONE Telegram message (not separate messages)
- ✅ **Caption format**: The formatted text appears as the photo's caption (below the image)

```
┌─────────────────────────────────────────────────────────────┐
│                    Notification Service                      │
│                                                               │
│  ┌─────────────┐    ┌──────────────┐    ┌────────────────┐ │
│  │   Listing   │───▶│   Message    │───▶│    Telegram    │ │
│  │   (w/image) │    │   Formatter  │    │     Client     │ │
│  └─────────────┘    └──────────────┘    └────────────────┘ │
│                            │                      │          │
│                            │                      ▼          │
│                            │              ┌──────────────┐  │
│                            │              │  Has image?  │  │
│                            │              └──────────────┘  │
│                            │                 /          \    │
│                            │               Yes          No   │
│                            │                /            \   │
│                            │               ▼              ▼  │
│                            │         sendPhoto()    sendMessage()
│                            │         (with caption) (text only)│
│                            │                                   │
│                            └───────────────────────────────────┘
└─────────────────────────────────────────────────────────────┘
```

## Component Design

### 1. TelegramClient Updates

**File**: `apps/notify/src/telegram-client.ts`

Add new method `sendPhoto()` alongside existing `sendMessage()`:

```typescript
interface SendPhotoResult {
  success: boolean;
  messageId?: number;
  error?: string;
  retryable: boolean;
  imageAvailable: boolean; // Track if image was attempted
}

async sendPhoto(
  chatId: string,
  photoUrl: string,
  caption: string,
  parseMode: 'HTML' | 'Markdown'
): Promise<SendPhotoResult>
```

**Implementation Strategy**:
- Use Telegram Bot API `sendPhoto` method
- Pass image URL as `photo` parameter
- Pass formatted message as `caption` parameter
- Set `parse_mode: 'HTML'` for caption formatting
- Handle errors and fall back to text-only

**Error Handling**:
- Network errors → retryable
- Invalid image URL → not retryable, fall back to text
- Image too large → not retryable, fall back to text
- Rate limiting → retryable

### 2. NotificationService Updates

**File**: `apps/notify/src/notification-service.ts`

Modify notification sending logic to choose between photo and text:

```typescript
// Current flow (simplified)
for (const listing of matches) {
  const message = this.formatter.format(listing);
  const result = await this.telegram.sendMessage(chatId, message, 'HTML');
  // ... handle result
}

// New flow
for (const listing of matches) {
  const message = this.formatter.format(listing);

  let result;
  if (listing.image_url) {
    // Try sending with image
    result = await this.telegram.sendPhoto(
      chatId,
      listing.image_url,
      message,
      'HTML'
    );

    // Fall back to text if image fails
    if (!result.success && !result.retryable) {
      console.log(JSON.stringify({
        event: 'image_send_failed',
        listingId: listing.id,
        error: result.error,
        fallbackToText: true
      }));

      result = await this.telegram.sendMessage(chatId, message, 'HTML');
    }
  } else {
    // No image, send text-only
    result = await this.telegram.sendMessage(chatId, message, 'HTML');
  }

  // ... existing result handling
}
```

### 3. Message Formatter (No Changes)

**File**: `apps/notify/src/message-formatter.ts`

No changes needed! The formatter already produces HTML-formatted text that will work as photo captions.

Current output:
```
<b>1 חדרים בתל אביב - 1,000 ₪</b>
💰 ₪1,000/month
🏠 1 rooms
📍 Tel Aviv - גני שרונה, קרית הממשלה, <a href="...">גרציאני יצחק 4</a>

<a href="...">View Listing</a>
```

**In Telegram, this appears as**:
- Photo displays at the top
- Caption (the text above) appears below the photo
- All in ONE message (not separate messages)

### 4. Connector Support

**Current**: YAD2 connector already populates `image_url` field via:
```typescript
imageUrl: sd.metaData?.coverImage ?? null
```

**Future Connectors**: Any new connector (Facebook, etc.) just needs to populate the `image_url` field in the ListingDraft:
```typescript
export interface ListingDraft {
  // ... other fields
  imageUrl: string | null;  // ← Connector sets this
}
```

The notification service will automatically send photos for any listing with `image_url` set, regardless of which connector created it.

## Telegram API Integration

### sendPhoto Endpoint

```
POST https://api.telegram.org/bot{token}/sendPhoto

Parameters:
- chat_id: string (user's Telegram chat ID)
- photo: string (URL of the photo)
- caption: string (message text, max 1024 chars)
- parse_mode: string ('HTML')
- disable_notification: boolean (optional)
```

### Response Handling

Success response:
```json
{
  "ok": true,
  "result": {
    "message_id": 123,
    "chat": { ... },
    "photo": [ ... ]
  }
}
```

Error responses:
```json
// Invalid URL
{
  "ok": false,
  "error_code": 400,
  "description": "Bad Request: wrong file identifier/HTTP URL specified"
}

// File too large
{
  "ok": false,
  "error_code": 400,
  "description": "Bad Request: PHOTO_INVALID_DIMENSIONS"
}

// Network error
{
  "ok": false,
  "error_code": 502,
  "description": "Bad Gateway"
}
```

## Data Flow

```
1. NotificationService gets listings with matches
2. For each listing:
   a. MessageFormatter.format(listing) → HTML text
   b. If listing.image_url exists:
      i.  TelegramClient.sendPhoto(chatId, imageUrl, text)
      ii. If fails with non-retryable error:
          → TelegramClient.sendMessage(chatId, text) [fallback]
   c. Else:
      i.  TelegramClient.sendMessage(chatId, text) [no image]
   d. Record notification sent
   e. Log metrics (image success/failure)
```

## Error Handling Strategy

### Image Loading Failures

1. **Network errors** (502, 503, timeout)
   - Mark as retryable
   - Do NOT fall back to text immediately
   - Let notification service retry logic handle it

2. **Invalid URL** (400, wrong file identifier)
   - Mark as non-retryable
   - Log failure
   - Fall back to text-only notification immediately

3. **Image validation failures** (too large, wrong format)
   - Mark as non-retryable
   - Log failure
   - Fall back to text-only notification immediately

### Logging

Add structured logs:

```typescript
// Image send attempt
{
  event: 'image_send_attempt',
  listingId: number,
  userId: number,
  imageUrl: string
}

// Image send success
{
  event: 'image_send_success',
  listingId: number,
  userId: number,
  messageId: number
}

// Image send failure with fallback
{
  event: 'image_send_failed',
  listingId: number,
  userId: number,
  error: string,
  errorCode: number,
  fallbackToText: boolean
}
```

## Caption Length Limits

Telegram photo captions are limited to **1024 characters**.

Current message format is well under this limit (~200-300 chars), so no special handling needed.

If we add more fields in the future, we may need to truncate.

## Testing Strategy

### Unit Tests

1. **TelegramClient.sendPhoto()**
   - Test successful photo send
   - Test invalid URL handling
   - Test network error handling
   - Test rate limiting

2. **NotificationService**
   - Test photo send with valid image_url
   - Test fallback to text when image fails
   - Test text-only when no image_url
   - Test logging of image metrics

### Integration Tests

1. Send notification with real YAD2 image URL
2. Send notification with invalid image URL (verify fallback)
3. Send notification with no image_url (verify text-only)

### Manual Testing

1. Trigger notifications for listings with images
2. Verify image displays correctly in Telegram
3. Verify caption formatting (HTML, links)
4. Test with invalid image URLs
5. Test with no image URLs

## Monitoring & Metrics

Track the following metrics:

1. **Image success rate**: % of notifications sent with images successfully
2. **Image fallback rate**: % of image sends that fell back to text
3. **No image rate**: % of listings without image_url
4. **Common failure reasons**: Track error codes and messages

Log format:
```typescript
{
  event: 'notify_complete',
  sent: number,
  failed: number,
  imageSuccess: number,      // NEW
  imageFallback: number,     // NEW
  noImage: number            // NEW
}
```

## Performance Considerations

1. **Image Loading Time**
   - Telegram fetches the image from the URL asynchronously
   - sendPhoto call returns immediately after Telegram accepts the URL
   - No significant performance impact expected

2. **Rate Limiting**
   - Same rate limits as sendMessage apply
   - No additional throttling needed

3. **Error Handling Overhead**
   - Fallback to text adds one additional API call on image failure
   - Expected to be rare (<5% of cases)

## Security Considerations

1. **URL Validation**
   - Telegram validates URLs server-side
   - We trust YAD2 image URLs (from official API)
   - No additional validation needed

2. **Privacy**
   - Image URLs may contain tracking parameters
   - No sensitive data exposure risk
   - Users clicking images go to YAD2 directly

## Rollback Plan

If issues arise:

1. **Immediate**: Revert to text-only by commenting out image send logic
2. **Quick**: Add feature flag to disable images per user/globally
3. **Data**: No database changes, so rollback is code-only

## Future Enhancements

These are out of scope but documented for future consideration:

1. **Image Caching**: Host images ourselves to improve reliability
2. **Image Optimization**: Resize/compress before sending
3. **Multiple Images**: Send image galleries for listings with multiple photos
4. **User Preferences**: Allow users to disable images
5. **Placeholder Images**: Show default image for listings without photos
