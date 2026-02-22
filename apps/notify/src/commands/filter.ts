import type { StatefulCommandHandler } from './interface';
import type { TelegramMessage } from '../webhook/types';
import type { TelegramClient } from '../telegram-client';
import type { BotService } from '../bot-service';
import type { ConversationState, ConversationStateManager } from '../conversation-state';

export class FilterCommand implements StatefulCommandHandler {
  constructor(
    private telegram: TelegramClient,
    private botService: BotService,
    private stateManager: ConversationStateManager
  ) {}

  async execute(message: TelegramMessage): Promise<void> {
    const chatId = String(message.chat.id);

    // Initialize conversation state
    await this.stateManager.setState(chatId, {
      command: '/filter',
      step: 'name',
      data: {},
    });

    await this.telegram.sendMessage(
      chatId,
      "Let's create a new filter! 📝\n\nFirst, give it a name (e.g., 'Tel Aviv 2BR'):",
      'HTML'
    );
  }

  async handleStateReply(message: TelegramMessage, state: ConversationState): Promise<void> {
    const chatId = String(message.chat.id);
    const text = message.text?.trim() || '';

    switch (state.step) {
      case 'name':
        await this.handleNameStep(chatId, text, state);
        break;

      case 'cities':
        await this.handleCitiesStep(chatId, text, state);
        break;

      case 'price_min':
        await this.handlePriceMinStep(chatId, text, state);
        break;

      case 'price_max':
        await this.handlePriceMaxStep(chatId, text, state);
        break;

      case 'rooms_min':
        await this.handleRoomsMinStep(chatId, text, state);
        break;

      case 'rooms_max':
        await this.handleRoomsMaxStep(chatId, text, state);
        break;

      case 'keywords':
        await this.handleKeywordsStep(chatId, text, state);
        break;
    }
  }

  private async handleNameStep(chatId: string, text: string, state: ConversationState): Promise<void> {
    state.data.name = text;
    state.step = 'cities';
    await this.stateManager.setState(chatId, state);

    await this.telegram.sendMessage(
      chatId,
      `Great! Filter name: <b>${text}</b>\n\n` +
        `Now, which cities? (comma-separated)\n\n` +
        `Examples: Tel Aviv, Jerusalem, Haifa\n` +
        `Or type 'skip' to search all cities.`,
      'HTML'
    );
  }

  private async handleCitiesStep(chatId: string, text: string, state: ConversationState): Promise<void> {
    if (text.toLowerCase() !== 'skip') {
      state.data.cities = text.split(',').map((c) => c.trim()).filter(Boolean);
    }

    state.step = 'price_min';
    await this.stateManager.setState(chatId, state);

    await this.telegram.sendMessage(
      chatId,
      `Minimum price (ILS/month)?\n\nType a number or 'skip':`,
      'HTML'
    );
  }

  private async handlePriceMinStep(chatId: string, text: string, state: ConversationState): Promise<void> {
    if (text.toLowerCase() !== 'skip') {
      const price = parseFloat(text);
      if (isNaN(price) || price < 0) {
        await this.telegram.sendMessage(
          chatId,
          '❌ Invalid price. Please enter a positive number or type \'skip\'.',
          'HTML'
        );
        return;
      }
      state.data.minPrice = price;
    }

    state.step = 'price_max';
    await this.stateManager.setState(chatId, state);

    await this.telegram.sendMessage(
      chatId,
      `Maximum price (ILS/month)?\n\nType a number or 'skip':`,
      'HTML'
    );
  }

  private async handlePriceMaxStep(chatId: string, text: string, state: ConversationState): Promise<void> {
    if (text.toLowerCase() !== 'skip') {
      const price = parseFloat(text);
      if (isNaN(price) || price < 0) {
        await this.telegram.sendMessage(
          chatId,
          '❌ Invalid price. Please enter a positive number or type \'skip\'.',
          'HTML'
        );
        return;
      }
      state.data.maxPrice = price;
    }

    state.step = 'rooms_min';
    await this.stateManager.setState(chatId, state);

    await this.telegram.sendMessage(
      chatId,
      `Minimum bedrooms?\n\nType a number or 'skip':`,
      'HTML'
    );
  }

  private async handleRoomsMinStep(chatId: string, text: string, state: ConversationState): Promise<void> {
    if (text.toLowerCase() !== 'skip') {
      const rooms = parseInt(text, 10);
      if (isNaN(rooms) || rooms < 0) {
        await this.telegram.sendMessage(
          chatId,
          '❌ Invalid number. Please enter a positive integer or type \'skip\'.',
          'HTML'
        );
        return;
      }
      state.data.minBedrooms = rooms;
    }

    state.step = 'rooms_max';
    await this.stateManager.setState(chatId, state);

    await this.telegram.sendMessage(
      chatId,
      `Maximum bedrooms?\n\nType a number or 'skip':`,
      'HTML'
    );
  }

  private async handleRoomsMaxStep(chatId: string, text: string, state: ConversationState): Promise<void> {
    if (text.toLowerCase() !== 'skip') {
      const rooms = parseInt(text, 10);
      if (isNaN(rooms) || rooms < 0) {
        await this.telegram.sendMessage(
          chatId,
          '❌ Invalid number. Please enter a positive integer or type \'skip\'.',
          'HTML'
        );
        return;
      }
      state.data.maxBedrooms = rooms;
    }

    state.step = 'keywords';
    await this.stateManager.setState(chatId, state);

    await this.telegram.sendMessage(
      chatId,
      `Keywords to search for? (comma-separated)\n\n` +
        `Examples: balcony, parking, furnished\n` +
        `Or type 'skip':`,
      'HTML'
    );
  }

  private async handleKeywordsStep(chatId: string, text: string, state: ConversationState): Promise<void> {
    if (text.toLowerCase() !== 'skip') {
      state.data.keywords = text.split(',').map((k) => k.trim()).filter(Boolean);
    }

    // Save filter
    const user = await this.botService.getUserByChatId(chatId);
    if (!user) {
      await this.telegram.sendMessage(
        chatId,
        '❌ Error: User not found. Please /start first.',
        'HTML'
      );
      await this.stateManager.clearState(chatId);
      return;
    }

    await this.botService.createFilter(user.id, {
      name: state.data.name,
      minPrice: state.data.minPrice,
      maxPrice: state.data.maxPrice,
      minBedrooms: state.data.minBedrooms,
      maxBedrooms: state.data.maxBedrooms,
      cities: state.data.cities,
      keywords: state.data.keywords,
    });

    await this.stateManager.clearState(chatId);

    const summary = this.formatFilterSummary(state.data);
    await this.telegram.sendMessage(
      chatId,
      `✅ <b>Filter "${state.data.name}" created!</b>\n\n${summary}\n\n` +
        `You'll receive notifications when new listings match this filter.`,
      'HTML'
    );
  }

  private formatFilterSummary(data: any): string {
    const parts: string[] = [];

    if (data.cities && data.cities.length > 0) {
      parts.push(`📍 Cities: ${data.cities.join(', ')}`);
    }

    if (data.minPrice || data.maxPrice) {
      const min = data.minPrice ? `${data.minPrice}` : '—';
      const max = data.maxPrice ? `${data.maxPrice}` : '—';
      parts.push(`💰 Price: ${min} - ${max} ILS/month`);
    }

    if (data.minBedrooms || data.maxBedrooms) {
      const min = data.minBedrooms ? `${data.minBedrooms}` : '—';
      const max = data.maxBedrooms ? `${data.maxBedrooms}` : '—';
      parts.push(`🛏️ Rooms: ${min} - ${max}`);
    }

    if (data.keywords && data.keywords.length > 0) {
      parts.push(`🔍 Keywords: ${data.keywords.join(', ')}`);
    }

    return parts.length > 0 ? parts.join('\n') : 'No specific criteria set';
  }
}
