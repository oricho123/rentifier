import type { CommandHandler } from './interface';
import type { TelegramMessage } from '../webhook/types';
import type { TelegramClient } from '../telegram-client';
import type { BotService, Filter } from '../bot-service';
import { t } from '../i18n';
import { KeyboardBuilder } from '../keyboards/builders';

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
        t('errors.user_not_found'),
        'HTML'
      );
      return;
    }

    const filters = await this.botService.getFilters(user.id);

    if (filters.length === 0) {
      await this.telegram.sendMessage(
        chatId,
        t('commands.list.no_filters'),
        'HTML'
      );
      return;
    }

    // Send each filter as a separate message with action buttons
    await this.telegram.sendMessage(
      chatId,
      t('commands.list.title'),
      'HTML'
    );

    for (const filter of filters) {
      const filterText = this.formatFilter(filter);
      await this.telegram.sendInlineKeyboard(
        chatId,
        filterText,
        KeyboardBuilder.filterActions(filter.id),
        'HTML'
      );
    }
  }

  private formatFilter(filter: Filter): string {
    const parts: string[] = [
      t('commands.list.filter_header', { id: String(filter.id), name: filter.name }),
      filter.enabled ? t('commands.list.filter_status_active') : t('commands.list.filter_status_paused'),
    ];

    const criteria: string[] = [];

    if (filter.cities_json) {
      const cities = JSON.parse(filter.cities_json) as string[];
      if (cities.length > 0) {
        criteria.push(t('commands.filter.summary_cities', { cities: cities.join(', ') }));
      }
    }

    if (filter.min_price || filter.max_price) {
      const min = filter.min_price ? filter.min_price.toLocaleString('he-IL') : '—';
      const max = filter.max_price ? filter.max_price.toLocaleString('he-IL') : '—';
      criteria.push(t('commands.filter.summary_price', { min, max }));
    }

    if (filter.min_bedrooms || filter.max_bedrooms) {
      const min = filter.min_bedrooms ? String(filter.min_bedrooms) : '—';
      const max = filter.max_bedrooms ? String(filter.max_bedrooms) : '—';
      criteria.push(t('commands.filter.summary_rooms', { min, max }));
    }

    if (filter.keywords_json) {
      const keywords = JSON.parse(filter.keywords_json) as string[];
      if (keywords.length > 0) {
        criteria.push(t('commands.filter.summary_keywords', { keywords: keywords.join(', ') }));
      }
    }

    if (criteria.length > 0) {
      parts.push(criteria.join('\n'));
    }

    return parts.join('\n');
  }
}
