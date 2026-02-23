import type { DB, ListingRow, FilterRow, User } from '@rentifier/db';
import type { TelegramClient } from './telegram-client';
import type { MessageFormatter } from './message-formatter';

export interface NotificationResult {
  sent: number;
  failed: number;
  skipped: number;
  errors: NotificationError[];
  imageSuccess: number;
  imageFallback: number;
  noImage: number;
}

export interface NotificationError {
  userId: number;
  listingId: number;
  filterId: number;
  error: string;
}

function parseJsonArray(json: string | null): string[] {
  if (!json) return [];
  try {
    return JSON.parse(json) as string[];
  } catch {
    return [];
  }
}

function matchesFilter(listing: ListingRow, filter: FilterRow): boolean {
  // Price range check
  if (filter.min_price != null && (listing.price == null || listing.price < filter.min_price)) {
    return false;
  }
  if (filter.max_price != null && (listing.price == null || listing.price > filter.max_price)) {
    return false;
  }

  // Bedroom range check
  if (filter.min_bedrooms != null && (listing.bedrooms == null || listing.bedrooms < filter.min_bedrooms)) {
    return false;
  }
  if (filter.max_bedrooms != null && (listing.bedrooms == null || listing.bedrooms > filter.max_bedrooms)) {
    return false;
  }

  // City filter
  const cities = parseJsonArray(filter.cities_json);
  if (cities.length > 0 && (!listing.city || !cities.includes(listing.city))) {
    return false;
  }

  // Neighborhood filter
  const neighborhoods = parseJsonArray(filter.neighborhoods_json);
  if (neighborhoods.length > 0 && (!listing.neighborhood || !neighborhoods.includes(listing.neighborhood))) {
    return false;
  }

  // Keyword filter (any keyword must appear in title or description)
  const keywords = parseJsonArray(filter.keywords_json);
  if (keywords.length > 0) {
    const text = `${listing.title} ${listing.description || ''}`.toLowerCase();
    const hasKeyword = keywords.some((kw) => text.includes(kw.toLowerCase()));
    if (!hasKeyword) return false;
  }

  // Must-have tags (all must be present)
  const mustHaveTags = parseJsonArray(filter.must_have_tags_json);
  if (mustHaveTags.length > 0) {
    const listingTags = parseJsonArray(listing.tags_json);
    const hasAll = mustHaveTags.every((tag) => listingTags.includes(tag));
    if (!hasAll) return false;
  }

  // Exclude tags (none can be present)
  const excludeTags = parseJsonArray(filter.exclude_tags_json);
  if (excludeTags.length > 0) {
    const listingTags = parseJsonArray(listing.tags_json);
    const hasExcluded = excludeTags.some((tag) => listingTags.includes(tag));
    if (hasExcluded) return false;
  }

  return true;
}

export class NotificationService {
  constructor(
    private db: DB,
    private telegram: TelegramClient,
    private formatter: MessageFormatter
  ) {}

  async processNotifications(): Promise<NotificationResult> {
    const result: NotificationResult = {
      sent: 0,
      failed: 0,
      skipped: 0,
      errors: [],
      imageSuccess: 0,
      imageFallback: 0,
      noImage: 0
    };

    // Get last notification run timestamp
    const state = await this.db.getWorkerState('notify');
    const since = state.lastRunAt ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const currentRunTime = new Date().toISOString();

    const filtersWithUsers = await this.db.getActiveFilters();
    console.log(JSON.stringify({ event: 'notify_start', activeFilters: filtersWithUsers.length, since }));

    if (filtersWithUsers.length === 0) {
      await this.db.updateWorkerState('notify', currentRunTime, 'ok');
      return result;
    }

    const recentListings = await this.db.getNewListingsSince(since);

    if (recentListings.length === 0) {
      await this.db.updateWorkerState('notify', currentRunTime, 'ok');
      return result;
    }

    for (const filterWithUser of filtersWithUsers) {
      const { user, ...filter } = filterWithUser;

      // Match listings against this filter
      const matches = recentListings.filter((listing) => matchesFilter(listing, filter));
      console.log(JSON.stringify({ event: 'filter_processed', filterId: filter.id, matchCount: matches.length }));

      if (matches.length === 0) continue;

      for (const listing of matches) {
        try {
          // Check if already sent
          const alreadySent = await this.db.checkNotificationSent(user.id, listing.id);
          if (alreadySent) {
            result.skipped++;
            continue;
          }

          // Format message
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
              // Image failed with non-retryable error, fall back to text
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
            // Permanent failure (e.g., invalid chat_id)
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
          result.failed++;
          result.errors.push({
            userId: user.id,
            listingId: listing.id,
            filterId: filter.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    await this.db.updateWorkerState('notify', currentRunTime, 'ok');

    const totalImageAttempts = result.imageSuccess + result.imageFallback + result.noImage;
    const imageSuccessRate = totalImageAttempts > 0
      ? result.imageSuccess / totalImageAttempts
      : 0;

    console.log(JSON.stringify({
      event: 'notify_complete',
      ...result,
      imageSuccessRate
    }));
    return result;
  }
}
