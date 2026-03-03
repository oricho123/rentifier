import type { Source, SourceState, ListingRaw, ListingRow, User, FilterRow, NotificationSent, WorkerState, MonitoredCity } from './schema';
import type { D1Database } from '@cloudflare/workers-types';
import { matchScore, DEDUP_THRESHOLD, type DedupFields } from '@rentifier/extraction';

export interface DuplicateCandidate {
  id: number;
  sourceId: number;
  street: string | null;
  house_number: string | null;
  neighborhood: string | null;
  latitude: number | null;
  longitude: number | null;
  price: number | null;
}

export interface FindDuplicateParams {
  city: string | null;
  bedrooms: number | null;
  price: number | null;
  street: string | null;
  house_number: string | null;
  neighborhood: string | null;
  latitude: number | null;
  longitude: number | null;
  source_id: number;
  source_item_id: string;
}

export interface DB {
  getEnabledSources(): Promise<Source[]>;
  getSourceById(sourceId: number): Promise<Source | null>;
  getSourceState(sourceId: number): Promise<SourceState | null>;
  updateSourceState(sourceId: number, state: Partial<Omit<SourceState, 'source_id'>>): Promise<void>;
  insertRawListings(listings: Omit<ListingRaw, 'id' | 'fetched_at' | 'processed_at'>[]): Promise<void>;
  getUnprocessedRawListings(limit: number): Promise<ListingRaw[]>;
  markRawListingProcessed(rawId: number): Promise<void>;
  upsertListing(listing: Omit<ListingRow, 'id' | 'ingested_at'>): Promise<number>;
  getNewListingsSince(since: string): Promise<ListingRow[]>;
  getActiveFilters(): Promise<(FilterRow & { user: User })[]>;
  getUserById(userId: number): Promise<User | null>;
  checkNotificationSent(userId: number, listingId: number): Promise<boolean>;
  recordNotificationSent(userId: number, listingId: number, filterId: number | null, channel: string): Promise<void>;
  getWorkerState(workerName: string): Promise<{ lastRunAt: string | null }>;
  updateWorkerState(workerName: string, lastRunAt: string, status: 'ok' | 'error', error?: string): Promise<void>;
  getEnabledCities(): Promise<MonitoredCity[]>;
  getCityByCode(cityCode: number): Promise<MonitoredCity | null>;
  addMonitoredCity(cityName: string, cityCode: number, priority?: number): Promise<number>;
  disableCity(cityCode: number): Promise<void>;
  enableCity(cityCode: number): Promise<void>;
  findDuplicate(params: FindDuplicateParams): Promise<DuplicateCandidate | null>;
  swapCanonical(newCanonicalId: number, oldCanonicalId: number): Promise<void>;
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

    async insertRawListings(listings: Omit<ListingRaw, 'id' | 'fetched_at' | 'processed_at'>[]): Promise<void> {
      if (listings.length === 0) return;

      const stmt = d1.prepare(
        'INSERT INTO listings_raw (source_id, source_item_id, url, raw_json) VALUES (?, ?, ?, ?)'
      );

      const batch = listings.map(l => stmt.bind(l.source_id, l.source_item_id, l.url, l.raw_json));
      await d1.batch(batch);
    },

    async getUnprocessedRawListings(limit: number): Promise<ListingRaw[]> {
      const result = await d1.prepare(
        `SELECT * FROM listings_raw
         WHERE processed_at IS NULL
         ORDER BY fetched_at ASC
         LIMIT ?`
      ).bind(limit).all<ListingRaw>();
      return result.results;
    },

    async markRawListingProcessed(rawId: number): Promise<void> {
      await d1.prepare(
        'UPDATE listings_raw SET processed_at = datetime(\'now\') WHERE id = ?'
      ).bind(rawId).run();
    },

    async upsertListing(listing: Omit<ListingRow, 'id' | 'ingested_at'>): Promise<number> {
      const result = await d1.prepare(
        `INSERT INTO listings (source_id, source_item_id, title, description, price, currency, price_period, bedrooms, city, neighborhood, street, house_number, area_text, url, posted_at, tags_json, relevance_score, floor, square_meters, property_type, latitude, longitude, image_url, entry_date, ai_extracted, duplicate_of)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(source_id, source_item_id) DO UPDATE SET
           title = excluded.title,
           description = excluded.description,
           price = excluded.price,
           currency = excluded.currency,
           price_period = excluded.price_period,
           bedrooms = excluded.bedrooms,
           city = excluded.city,
           neighborhood = excluded.neighborhood,
           street = excluded.street,
           house_number = excluded.house_number,
           area_text = excluded.area_text,
           url = excluded.url,
           posted_at = excluded.posted_at,
           tags_json = excluded.tags_json,
           relevance_score = excluded.relevance_score,
           floor = excluded.floor,
           square_meters = excluded.square_meters,
           property_type = excluded.property_type,
           latitude = excluded.latitude,
           longitude = excluded.longitude,
           image_url = excluded.image_url,
           entry_date = excluded.entry_date,
           ai_extracted = excluded.ai_extracted,
           duplicate_of = excluded.duplicate_of
         RETURNING id`
      ).bind(
        listing.source_id, listing.source_item_id, listing.title, listing.description,
        listing.price, listing.currency, listing.price_period, listing.bedrooms,
        listing.city, listing.neighborhood, listing.street, listing.house_number, listing.area_text, listing.url,
        listing.posted_at, listing.tags_json, listing.relevance_score,
        listing.floor, listing.square_meters, listing.property_type,
        listing.latitude, listing.longitude, listing.image_url,
        listing.entry_date, listing.ai_extracted, listing.duplicate_of
      ).first<{ id: number }>();
      return result!.id;
    },

    async getNewListingsSince(since: string): Promise<ListingRow[]> {
      const result = await d1.prepare(
        'SELECT * FROM listings WHERE datetime(ingested_at) > datetime(?) AND duplicate_of IS NULL ORDER BY ingested_at DESC'
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

      return result.results.map((row: any) => ({
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

    async getWorkerState(workerName: string): Promise<{ lastRunAt: string | null }> {
      const result = await d1.prepare(
        'SELECT last_run_at FROM worker_state WHERE worker_name = ?'
      ).bind(workerName).first<{ last_run_at: string }>();
      return { lastRunAt: result?.last_run_at ?? null };
    },

    async updateWorkerState(workerName: string, lastRunAt: string, status: 'ok' | 'error', error?: string): Promise<void> {
      await d1.prepare(
        `INSERT INTO worker_state (worker_name, last_run_at, last_status, last_error)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(worker_name) DO UPDATE SET
           last_run_at = excluded.last_run_at,
           last_status = excluded.last_status,
           last_error = excluded.last_error`
      ).bind(workerName, lastRunAt, status, error ?? null).run();
    },

    async getEnabledCities(): Promise<MonitoredCity[]> {
      const result = await d1.prepare(
        'SELECT * FROM monitored_cities WHERE enabled = 1 ORDER BY priority DESC, id ASC'
      ).all<MonitoredCity>();
      return result.results;
    },

    async getCityByCode(cityCode: number): Promise<MonitoredCity | null> {
      const result = await d1.prepare(
        'SELECT * FROM monitored_cities WHERE city_code = ?'
      ).bind(cityCode).first<MonitoredCity>();
      return result ?? null;
    },

    async addMonitoredCity(cityName: string, cityCode: number, priority: number = 0): Promise<number> {
      const result = await d1.prepare(
        'INSERT INTO monitored_cities (city_name, city_code, priority) VALUES (?, ?, ?) RETURNING id'
      ).bind(cityName, cityCode, priority).first<{ id: number }>();
      return result!.id;
    },

    async disableCity(cityCode: number): Promise<void> {
      await d1.prepare(
        'UPDATE monitored_cities SET enabled = 0 WHERE city_code = ?'
      ).bind(cityCode).run();
    },

    async enableCity(cityCode: number): Promise<void> {
      await d1.prepare(
        'UPDATE monitored_cities SET enabled = 1 WHERE city_code = ?'
      ).bind(cityCode).run();
    },

    async findDuplicate(params: FindDuplicateParams): Promise<DuplicateCandidate | null> {
      // Return null if required fields are missing
      if (params.city == null || params.bedrooms == null || params.price == null) {
        return null;
      }

      // Query canonical listings with matching city, bedrooms, and price within ±10%
      const priceMin = params.price * 0.9;
      const priceMax = params.price * 1.1;

      const result = await d1.prepare(
        `SELECT id, source_id as sourceId, street, house_number, neighborhood, latitude, longitude, price
         FROM listings
         WHERE city = ?
           AND bedrooms = ?
           AND price BETWEEN ? AND ?
           AND duplicate_of IS NULL
           AND NOT (source_id = ? AND source_item_id = ?)
         LIMIT 20`
      ).bind(params.city, params.bedrooms, priceMin, priceMax, params.source_id, params.source_item_id)
        .all<DuplicateCandidate>();

      if (result.results.length === 0) {
        return null;
      }

      // Build DedupFields for the incoming listing
      const incomingFields: DedupFields = {
        street: params.street,
        house_number: params.house_number,
        neighborhood: params.neighborhood,
        latitude: params.latitude,
        longitude: params.longitude,
        price: params.price,
      };

      // Score each candidate and find the first match above threshold
      for (const candidate of result.results) {
        const candidateFields: DedupFields = {
          street: candidate.street,
          house_number: candidate.house_number,
          neighborhood: candidate.neighborhood,
          latitude: candidate.latitude,
          longitude: candidate.longitude,
          price: candidate.price,
        };

        const score = matchScore(incomingFields, candidateFields);
        if (score >= DEDUP_THRESHOLD) {
          return {
            id: candidate.id,
            sourceId: candidate.sourceId,
            street: candidate.street,
            house_number: candidate.house_number,
            neighborhood: candidate.neighborhood,
            latitude: candidate.latitude,
            longitude: candidate.longitude,
            price: candidate.price,
          };
        }
      }

      return null;
    },

    async swapCanonical(newCanonicalId: number, oldCanonicalId: number): Promise<void> {
      // Point the old canonical to the new canonical
      await d1.prepare(
        'UPDATE listings SET duplicate_of = ? WHERE id = ?'
      ).bind(newCanonicalId, oldCanonicalId).run();

      // Point all listings that pointed to the old canonical to the new canonical
      await d1.prepare(
        'UPDATE listings SET duplicate_of = ? WHERE duplicate_of = ?'
      ).bind(newCanonicalId, oldCanonicalId).run();
    },
  };
}
