import type { CommandHandler } from './interface';
import type { TelegramMessage } from '../webhook/types';
import type { TelegramClient } from '../telegram-client';
import type { BotService, Filter } from '../bot-service';

export class ListCommand implements CommandHandler {
  constructor(
    private telegram: TelegramClient,
    private botService: BotService
  ) {}

  async execute(message: TelegramMessage): Promise<void> {
    const chatId = String(message.chat.id);

    const user = await this.botService.getUserByChatId(chatId);
    if (!user) {
      await this.telegram.sendMessage(
        chatId,
        'Please /start first to register.',
        'HTML'
      );
      return;
    }

    const filters = await this.botService.getFilters(user.id);

    if (filters.length === 0) {
      await this.telegram.sendMessage(
        chatId,
        `You don't have any filters yet.\n\nUse /filter to create your first search filter!`,
        'HTML'
      );
      return;
    }

    const filterList = filters
      .map((f) => this.formatFilter(f))
      .join('\n\n');

    await this.telegram.sendMessage(
      chatId,
      `<b>Your Filters:</b>\n\n${filterList}`,
      'HTML'
    );
  }

  private formatFilter(filter: Filter): string {
    const parts: string[] = [
      `<b>${filter.name}</b> (ID: ${filter.id})`,
      filter.enabled ? '✅ Active' : '⏸️ Paused',
    ];

    const criteria: string[] = [];

    if (filter.cities_json) {
      const cities = JSON.parse(filter.cities_json) as string[];
      if (cities.length > 0) {
        criteria.push(`Cities: ${cities.join(', ')}`);
      }
    }

    if (filter.min_price || filter.max_price) {
      const min = filter.min_price ? `${filter.min_price}` : '—';
      const max = filter.max_price ? `${filter.max_price}` : '—';
      criteria.push(`Price: ${min} - ${max} ILS/month`);
    }

    if (filter.min_bedrooms || filter.max_bedrooms) {
      const min = filter.min_bedrooms ? `${filter.min_bedrooms}` : '—';
      const max = filter.max_bedrooms ? `${filter.max_bedrooms}` : '—';
      criteria.push(`Rooms: ${min} - ${max}`);
    }

    if (filter.keywords_json) {
      const keywords = JSON.parse(filter.keywords_json) as string[];
      if (keywords.length > 0) {
        criteria.push(`Keywords: ${keywords.join(', ')}`);
      }
    }

    if (criteria.length > 0) {
      parts.push(criteria.join('\n'));
    }

    return parts.join('\n');
  }
}
