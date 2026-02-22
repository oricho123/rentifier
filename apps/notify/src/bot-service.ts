export interface User {
  id: number;
  telegram_chat_id: string;
  display_name: string;
  created_at: string;
}

export interface Filter {
  id: number;
  user_id: number;
  name: string;
  min_price: number | null;
  max_price: number | null;
  min_bedrooms: number | null;
  max_bedrooms: number | null;
  cities_json: string | null;
  neighborhoods_json: string | null;
  keywords_json: string | null;
  must_have_tags_json: string | null;
  exclude_tags_json: string | null;
  enabled: number;
  created_at: string;
}

export interface FilterCreateData {
  name: string;
  minPrice?: number | null;
  maxPrice?: number | null;
  minBedrooms?: number | null;
  maxBedrooms?: number | null;
  cities?: string[] | null;
  neighborhoods?: string[] | null;
  keywords?: string[] | null;
  mustHaveTags?: string[] | null;
  excludeTags?: string[] | null;
}

export class BotService {
  constructor(private d1: D1Database) {}

  async getUserByChatId(chatId: string): Promise<User | null> {
    const result = await this.d1
      .prepare('SELECT * FROM users WHERE telegram_chat_id = ?')
      .bind(chatId)
      .first<User>();
    return result ?? null;
  }

  async createUser(chatId: string, displayName: string): Promise<User> {
    await this.d1
      .prepare('INSERT INTO users (telegram_chat_id, display_name) VALUES (?, ?)')
      .bind(chatId, displayName)
      .run();

    const user = await this.getUserByChatId(chatId);
    if (!user) {
      throw new Error('Failed to create user');
    }
    return user;
  }

  async getFilterCount(userId: number): Promise<number> {
    const result = await this.d1
      .prepare('SELECT COUNT(*) as count FROM filters WHERE user_id = ? AND enabled = 1')
      .bind(userId)
      .first<{ count: number }>();
    return result?.count || 0;
  }

  async getFilters(userId: number): Promise<Filter[]> {
    const result = await this.d1
      .prepare('SELECT * FROM filters WHERE user_id = ? ORDER BY created_at DESC')
      .bind(userId)
      .all<Filter>();
    return result.results;
  }

  async createFilter(userId: number, data: FilterCreateData): Promise<void> {
    await this.d1
      .prepare(
        `INSERT INTO filters (
          user_id, name, min_price, max_price, min_bedrooms, max_bedrooms,
          cities_json, neighborhoods_json, keywords_json, must_have_tags_json, exclude_tags_json, enabled
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
      )
      .bind(
        userId,
        data.name,
        data.minPrice ?? null,
        data.maxPrice ?? null,
        data.minBedrooms ?? null,
        data.maxBedrooms ?? null,
        data.cities ? JSON.stringify(data.cities) : null,
        data.neighborhoods ? JSON.stringify(data.neighborhoods) : null,
        data.keywords ? JSON.stringify(data.keywords) : null,
        data.mustHaveTags ? JSON.stringify(data.mustHaveTags) : null,
        data.excludeTags ? JSON.stringify(data.excludeTags) : null
      )
      .run();
  }

  async updateFilter(userId: number, filterId: number, data: FilterCreateData): Promise<boolean> {
    const result = await this.d1
      .prepare(
        `UPDATE filters SET
          name = ?,
          min_price = ?,
          max_price = ?,
          min_bedrooms = ?,
          max_bedrooms = ?,
          cities_json = ?,
          neighborhoods_json = ?,
          keywords_json = ?,
          must_have_tags_json = ?,
          exclude_tags_json = ?
        WHERE id = ? AND user_id = ?`
      )
      .bind(
        data.name,
        data.minPrice ?? null,
        data.maxPrice ?? null,
        data.minBedrooms ?? null,
        data.maxBedrooms ?? null,
        data.cities ? JSON.stringify(data.cities) : null,
        data.neighborhoods ? JSON.stringify(data.neighborhoods) : null,
        data.keywords ? JSON.stringify(data.keywords) : null,
        data.mustHaveTags ? JSON.stringify(data.mustHaveTags) : null,
        data.excludeTags ? JSON.stringify(data.excludeTags) : null,
        filterId,
        userId
      )
      .run();
    return result.meta.changes > 0;
  }

  async deleteFilter(userId: number, filterId: number): Promise<boolean> {
    const result = await this.d1
      .prepare('DELETE FROM filters WHERE id = ? AND user_id = ?')
      .bind(filterId, userId)
      .run();
    return result.meta.changes > 0;
  }

  async pauseAllFilters(userId: number): Promise<void> {
    await this.d1
      .prepare('UPDATE filters SET enabled = 0 WHERE user_id = ?')
      .bind(userId)
      .run();
  }

  async resumeAllFilters(userId: number): Promise<void> {
    await this.d1
      .prepare('UPDATE filters SET enabled = 1 WHERE user_id = ?')
      .bind(userId)
      .run();
  }
}
