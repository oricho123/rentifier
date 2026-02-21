import type { Source, SourceState, ListingRaw, ListingRow, User, FilterRow, NotificationSent } from './schema';

export interface DB {
  getEnabledSources(): Promise<Source[]>;
  getSourceById(sourceId: number): Promise<Source | null>;
  getSourceState(sourceId: number): Promise<SourceState | null>;
  updateSourceState(sourceId: number, state: Partial<Omit<SourceState, 'source_id'>>): Promise<void>;
  insertRawListings(listings: Omit<ListingRaw, 'id' | 'fetched_at'>[]): Promise<void>;
  getUnprocessedRawListings(limit: number): Promise<ListingRaw[]>;
  upsertListing(listing: Omit<ListingRow, 'id' | 'ingested_at'>): Promise<number>;
  getNewListingsSince(since: string): Promise<ListingRow[]>;
  getActiveFilters(): Promise<(FilterRow & { user: User })[]>;
  getUserById(userId: number): Promise<User | null>;
  checkNotificationSent(userId: number, listingId: number): Promise<boolean>;
  recordNotificationSent(userId: number, listingId: number, filterId: number | null, channel: string): Promise<void>;
}

export function createDB(d1: D1Database): DB {
  return {
    async getEnabledSources(): Promise<Source[]> {
      const result = await d1.prepare('SELECT * FROM sources WHERE enabled = 1').all<Source>();
      return result.results;
    },

    async getSourceById(sourceId: number): Promise<Source | null> {
      const result = await d1.prepare('SELECT * FROM sources WHERE id = ?').bind(sourceId).first<Source>();
      return result ?? null;
    },

    async getSourceState(sourceId: number): Promise<SourceState | null> {
      const result = await d1.prepare('SELECT * FROM source_state WHERE source_id = ?').bind(sourceId).first<SourceState>();
      return result ?? null;
    },

    async updateSourceState(sourceId: number, state: Partial<Omit<SourceState, 'source_id'>>): Promise<void> {
      const fields: string[] = [];
      const values: unknown[] = [];

      if (state.cursor !== undefined) { fields.push('cursor'); values.push(state.cursor); }
      if (state.last_run_at !== undefined) { fields.push('last_run_at'); values.push(state.last_run_at); }
      if (state.last_status !== undefined) { fields.push('last_status'); values.push(state.last_status); }
      if (state.last_error !== undefined) { fields.push('last_error'); values.push(state.last_error); }

      if (fields.length === 0) return;

      const placeholders = fields.map(f => `${f} = ?`).join(', ');
      const allPlaceholders = fields.map(() => '?').join(', ');

      await d1.prepare(
        `INSERT INTO source_state (source_id, ${fields.join(', ')}) VALUES (?, ${allPlaceholders})
         ON CONFLICT(source_id) DO UPDATE SET ${placeholders}`
      ).bind(sourceId, ...values, ...values).run();
    },

    async insertRawListings(listings: Omit<ListingRaw, 'id' | 'fetched_at'>[]): Promise<void> {
      if (listings.length === 0) return;

      const stmt = d1.prepare(
        'INSERT INTO listings_raw (source_id, source_item_id, url, raw_json) VALUES (?, ?, ?, ?)'
      );

      const batch = listings.map(l => stmt.bind(l.source_id, l.source_item_id, l.url, l.raw_json));
      await d1.batch(batch);
    },

    async getUnprocessedRawListings(limit: number): Promise<ListingRaw[]> {
      const result = await d1.prepare(
        `SELECT lr.* FROM listings_raw lr
         LEFT JOIN listings l ON lr.source_id = l.source_id AND lr.source_item_id = l.source_item_id
         WHERE l.id IS NULL
         LIMIT ?`
      ).bind(limit).all<ListingRaw>();
      return result.results;
    },

    async upsertListing(listing: Omit<ListingRow, 'id' | 'ingested_at'>): Promise<number> {
      const result = await d1.prepare(
        `INSERT INTO listings (source_id, source_item_id, title, description, price, currency, price_period, bedrooms, city, neighborhood, area_text, url, posted_at, tags_json, relevance_score, floor, square_meters, property_type, latitude, longitude, image_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING id`
      ).bind(
        listing.source_id, listing.source_item_id, listing.title, listing.description,
        listing.price, listing.currency, listing.price_period, listing.bedrooms,
        listing.city, listing.neighborhood, listing.area_text, listing.url,
        listing.posted_at, listing.tags_json, listing.relevance_score,
        listing.floor, listing.square_meters, listing.property_type,
        listing.latitude, listing.longitude, listing.image_url
      ).first<{ id: number }>();
      return result!.id;
    },

    async getNewListingsSince(since: string): Promise<ListingRow[]> {
      const result = await d1.prepare(
        'SELECT * FROM listings WHERE ingested_at > ? ORDER BY ingested_at DESC'
      ).bind(since).all<ListingRow>();
      return result.results;
    },

    async getActiveFilters(): Promise<(FilterRow & { user: User })[]> {
      const result = await d1.prepare(
        `SELECT f.*, u.id as user_id_join, u.telegram_chat_id, u.display_name, u.created_at as user_created_at
         FROM filters f
         JOIN users u ON f.user_id = u.id
         WHERE f.enabled = 1`
      ).all<FilterRow & { user_id_join: number; telegram_chat_id: string; display_name: string; user_created_at: string }>();

      return result.results.map(row => ({
        id: row.id,
        user_id: row.user_id,
        name: row.name,
        min_price: row.min_price,
        max_price: row.max_price,
        min_bedrooms: row.min_bedrooms,
        max_bedrooms: row.max_bedrooms,
        cities_json: row.cities_json,
        neighborhoods_json: row.neighborhoods_json,
        keywords_json: row.keywords_json,
        must_have_tags_json: row.must_have_tags_json,
        exclude_tags_json: row.exclude_tags_json,
        enabled: row.enabled,
        created_at: row.created_at,
        user: {
          id: row.user_id_join,
          telegram_chat_id: row.telegram_chat_id,
          display_name: row.display_name,
          created_at: row.user_created_at,
        },
      }));
    },

    async getUserById(userId: number): Promise<User | null> {
      const result = await d1.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first<User>();
      return result ?? null;
    },

    async checkNotificationSent(userId: number, listingId: number): Promise<boolean> {
      const result = await d1.prepare(
        'SELECT 1 FROM notifications_sent WHERE user_id = ? AND listing_id = ? LIMIT 1'
      ).bind(userId, listingId).first<{ 1: number }>();
      return result !== null;
    },

    async recordNotificationSent(userId: number, listingId: number, filterId: number | null, channel: string): Promise<void> {
      await d1.prepare(
        'INSERT OR IGNORE INTO notifications_sent (user_id, listing_id, filter_id, channel) VALUES (?, ?, ?, ?)'
      ).bind(userId, listingId, filterId, channel).run();
    },
  };
}
